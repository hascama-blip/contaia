// ============================================================
//  Pagos de planes por pasarela (Culqi · Mercado Pago · Izipay)
// ============================================================
// Se elige la pasarela con la variable PASARELA y sus llaves (ver .env.example).
// Flujo común:
//   1) El líder del estudio elige el plan → se crea un Pago "pendiente" con el
//      monto que corresponde (precio de lanzamiento si aún hay cupo).
//   2) Paga en la pasarela (Culqi: ventana sobre la web · Mercado Pago: redirige
//      a su checkout · Izipay: formulario incrustado).
//   3) El pago se CONFIRMA en el servidor, nunca por lo que diga el navegador:
//      Culqi = cargo creado aquí con la llave secreta · Mercado Pago = consulta
//      del pago a su API (webhook o retorno) · Izipay = firma HMAC (retorno o IPN).
//   4) `acreditarPago` (idempotente) activa el plan por 30 días. Al vencer, la
//      cuenta vuelve sola al Plan Básico (planEfectivo).

import crypto from "crypto";
import type { Pago, Usuario } from "./types";
import { contarLanzamiento, crearPago, acreditarPago, getUserById, marcarPago } from "./db";
import { enviarCorreo } from "./email";
import { enviarAlerta } from "./alertas";

export type PlanPago = "regular" | "premium";
export type Pasarela = "culqi" | "mercadopago" | "izipay";

const env = (k: string) => (process.env[k] ?? "").trim();

export function appUrl(): string {
  return (env("APP_URL") || "https://www.radartributaria.com").replace(/\/$/, "");
}

// ---- Precios -----------------------------------------------------------------
/** Precio regular (sin descuento) y de lanzamiento (−50 %), en céntimos. */
export const PRECIOS: Record<PlanPago, { normal: number; lanzamiento: number; nombre: string }> = {
  regular: { normal: 1998, lanzamiento: 999, nombre: "Plan Regular" },
  premium: { normal: 3998, lanzamiento: 1999, nombre: "Plan Premium" },
};

/** Personas con precio de lanzamiento (por defecto las primeras 100). */
export function cuposLanzamiento(): number {
  const n = Number(env("LANZAMIENTO_CUPOS") || "100");
  return Number.isFinite(n) && n >= 0 ? n : 100;
}

export async function estadoLanzamiento(): Promise<{ cupos: number; usados: number; restantes: number }> {
  const cupos = cuposLanzamiento();
  const usados = await contarLanzamiento();
  return { cupos, usados, restantes: Math.max(0, cupos - usados) };
}

/** Precio que le toca a este estudio: quien ya compró con lanzamiento lo
 *  conserva al renovar; los demás lo tienen mientras queden cupos. */
export async function precioPara(admin: Usuario, plan: PlanPago): Promise<{ centimos: number; antes: number; lanzamiento: boolean }> {
  const p = PRECIOS[plan];
  const lanz = admin.precioLanzamiento === true || (await estadoLanzamiento()).restantes > 0;
  return { centimos: lanz ? p.lanzamiento : p.normal, antes: p.normal, lanzamiento: lanz };
}

export const soles = (c: number) => `S/ ${(c / 100).toFixed(2)}`;

// ---- Configuración de la pasarela ---------------------------------------------
/** Pasarela activa y si tiene sus llaves completas. */
export function pasarelaActiva(): { pasarela: Pasarela | null; publicKey: string; falta: string[] } {
  const p = env("PASARELA").toLowerCase() as Pasarela;
  const req: Record<Pasarela, string[]> = {
    culqi: ["CULQI_PUBLIC_KEY", "CULQI_SECRET_KEY"],
    mercadopago: ["MP_ACCESS_TOKEN"],
    izipay: ["IZIPAY_SHOP_ID", "IZIPAY_PASSWORD", "IZIPAY_PUBLIC_KEY", "IZIPAY_HMAC_KEY"],
  };
  if (!req[p]) return { pasarela: null, publicKey: "", falta: ["PASARELA"] };
  const falta = req[p].filter((k) => !env(k));
  const publicKey = p === "culqi" ? env("CULQI_PUBLIC_KEY") : p === "izipay" ? env("IZIPAY_PUBLIC_KEY") : env("MP_PUBLIC_KEY");
  return { pasarela: falta.length ? null : p, publicKey, falta };
}

/** ¿La pasarela está con claves de TEST? (los pagos no son dinero real). */
export function modoPrueba(p: Pasarela | null = pasarelaActiva().pasarela): boolean {
  if (p === "izipay") return env("IZIPAY_PASSWORD").startsWith("testpassword_");
  if (p === "culqi") return env("CULQI_SECRET_KEY").startsWith("sk_test");
  if (p === "mercadopago") return env("MP_ACCESS_TOKEN").startsWith("TEST-");
  return false;
}

// ---- Inicio del pago ------------------------------------------------------------
export type InicioPago =
  | { proveedor: "culqi"; pagoId: string; publicKey: string; montoCentimos: number; email: string; descripcion: string }
  | { proveedor: "mercadopago"; pagoId: string; redirect: string }
  | { proveedor: "izipay"; pagoId: string; publicKey: string; formToken: string; montoCentimos: number };

export async function iniciarPago(admin: Usuario, plan: PlanPago): Promise<InicioPago> {
  const cfg = pasarelaActiva();
  if (!cfg.pasarela) throw new Error(`La pasarela de pago aún no está configurada (falta ${cfg.falta.join(", ")}).`);
  const precio = await precioPara(admin, plan);
  const prueba = modoPrueba(cfg.pasarela);
  const pago = await crearPago({
    userId: admin.id,
    userEmail: admin.email,
    userNombre: admin.nombre,
    plan,
    montoCentimos: precio.centimos,
    moneda: "PEN",
    // Un pago de prueba no ocupa cupo de lanzamiento ni lo deja asegurado.
    lanzamiento: precio.lanzamiento && !prueba,
    ...(prueba ? { prueba: true } : {}),
    proveedor: cfg.pasarela,
  });
  const descripcion = `${PRECIOS[plan].nombre} · 30 días · Radar Tributario`;

  if (cfg.pasarela === "culqi") {
    return { proveedor: "culqi", pagoId: pago.id, publicKey: cfg.publicKey, montoCentimos: pago.montoCentimos, email: admin.email, descripcion };
  }
  if (cfg.pasarela === "mercadopago") {
    const pref = await mpCrearPreferencia(pago, descripcion);
    await marcarPago(pago.id, { detalle: `preferencia ${pref.id}` });
    return { proveedor: "mercadopago", pagoId: pago.id, redirect: pref.url };
  }
  const formToken = await izipayFormToken(pago);
  return { proveedor: "izipay", pagoId: pago.id, publicKey: cfg.publicKey, formToken, montoCentimos: pago.montoCentimos };
}

// ---- Culqi (Checkout Custom + cargo con llave secreta) -------------------------
/** Crea el cargo en Culqi con el token (tarjeta o Yape) que devolvió el checkout. */
export async function culqiCargo(pago: Pago, token: string, email: string): Promise<{ ok: boolean; referencia?: string; error?: string }> {
  const api = (env("CULQI_API_URL") || "https://api.culqi.com").replace(/\/$/, "");
  const res = await fetch(`${api}/v2/charges`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env("CULQI_SECRET_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      amount: pago.montoCentimos,
      currency_code: pago.moneda,
      email: email || pago.userEmail,
      source_id: token,
      description: `${PRECIOS[pago.plan].nombre} Radar`.slice(0, 80),
      metadata: { pago_id: pago.id, user_id: pago.userId, plan: pago.plan },
    }),
  }).catch((e) => ({ ok: false, status: 0, json: async () => ({ user_message: String(e) }) } as any));
  const d: any = await res.json().catch(() => ({}));
  // 3DS: Culqi pide autenticación adicional (no soportada en este flujo).
  if (d?.action_code === "REVIEW") return { ok: false, error: "Tu banco pide una verificación adicional (3D Secure). Intenta con otra tarjeta o con Yape." };
  if (!res.ok || d?.object === "error") return { ok: false, error: d?.user_message || d?.merchant_message || "Culqi rechazó el pago." };
  const exitoso = d?.object === "charge" && (d?.outcome?.type === "venta_exitosa" || !d?.outcome?.type);
  if (!exitoso) return { ok: false, error: d?.outcome?.user_message || "El pago no fue aprobado." };
  if (Number(d.amount) && Number(d.amount) < pago.montoCentimos) return { ok: false, error: "El monto cobrado no coincide." };
  return { ok: true, referencia: String(d.id) };
}

// ---- Mercado Pago (Checkout Pro) ------------------------------------------------
// MP_API_URL / CULQI_API_URL solo existen para pruebas contra un servidor simulado.
const mpApi = () => (env("MP_API_URL") || "https://api.mercadopago.com").replace(/\/$/, "");
async function mpCrearPreferencia(pago: Pago, descripcion: string): Promise<{ id: string; url: string }> {
  const base = appUrl();
  const res = await fetch(`${mpApi()}/checkout/preferences`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env("MP_ACCESS_TOKEN")}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      items: [{ id: pago.plan, title: descripcion, quantity: 1, unit_price: pago.montoCentimos / 100, currency_id: pago.moneda }],
      payer: { email: pago.userEmail },
      external_reference: pago.id,
      back_urls: {
        success: `${base}/pagar/resultado?pago=${pago.id}`,
        pending: `${base}/pagar/resultado?pago=${pago.id}`,
        failure: `${base}/pagar/resultado?pago=${pago.id}`,
      },
      auto_return: "approved",
      notification_url: `${base}/api/webhooks/pagos/mercadopago`,
      statement_descriptor: "RADAR TRIBUTARIO",
      metadata: { pago_id: pago.id, plan: pago.plan },
    }),
  });
  const d: any = await res.json().catch(() => ({}));
  if (!res.ok || !d?.init_point) throw new Error(d?.message || "Mercado Pago no creó la preferencia de pago.");
  return { id: String(d.id), url: String(d.init_point) };
}

/** Consulta un pago en la API de Mercado Pago (fuente de verdad). */
export async function mpConsultarPago(paymentId: string): Promise<{ aprobado: boolean; pagoId: string; montoCentimos: number; estado: string; referencia: string } | null> {
  if (!/^\d+$/.test(paymentId)) return null;
  const res = await fetch(`${mpApi()}/v1/payments/${paymentId}`, {
    headers: { Authorization: `Bearer ${env("MP_ACCESS_TOKEN")}` },
  }).catch(() => null);
  if (!res || !res.ok) return null;
  const d: any = await res.json().catch(() => null);
  if (!d) return null;
  return {
    aprobado: d.status === "approved",
    pagoId: String(d.external_reference ?? ""),
    montoCentimos: Math.round(Number(d.transaction_amount ?? 0) * 100),
    estado: String(d.status ?? ""),
    referencia: String(d.id),
  };
}

// ---- Izipay (formulario incrustado REST V4, plataforma micuentaweb) ---------------
async function izipayFormToken(pago: Pago): Promise<string> {
  const api = (env("IZIPAY_API_URL") || "https://api.micuentaweb.pe").replace(/\/$/, "");
  const auth = Buffer.from(`${env("IZIPAY_SHOP_ID")}:${env("IZIPAY_PASSWORD")}`).toString("base64");
  const res = await fetch(`${api}/api-payment/V4/Charge/CreatePayment`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      amount: pago.montoCentimos,
      currency: pago.moneda,
      orderId: pago.id,
      customer: { email: pago.userEmail, reference: pago.userId },
      ipnTargetUrl: `${appUrl()}/api/webhooks/pagos/izipay`,
    }),
  });
  const d: any = await res.json().catch(() => ({}));
  if (!res.ok || d?.status !== "SUCCESS" || !d?.answer?.formToken) {
    throw new Error(d?.answer?.errorMessage || "Izipay no generó el formulario de pago.");
  }
  return String(d.answer.formToken);
}

/** Verifica la firma de Izipay (HMAC-SHA256 en hex de kr-answer). Izipay indica
 *  con qué clave firmó en `kr-hash-key`: "sha256_hmac" (retorno al navegador,
 *  clave HMAC-SHA-256) o "password" (IPN, contraseña REST). Si no lo indica, se
 *  usa la del canal. */
export function izipayFirmaValida(krAnswer: string, krHash: string, origen: "navegador" | "ipn", krHashKey?: string): boolean {
  const usarPassword = krHashKey === "password" || (krHashKey !== "sha256_hmac" && origen === "ipn");
  const clave = usarPassword ? env("IZIPAY_PASSWORD") : env("IZIPAY_HMAC_KEY");
  if (!clave || !krAnswer || !krHash) return false;
  const calc = crypto.createHmac("sha256", clave).update(krAnswer, "utf8").digest("hex");
  const a = Buffer.from(calc), b = Buffer.from(String(krHash).toLowerCase());
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Lee la respuesta de Izipay ya verificada: ¿pagado?, pagoId y monto. */
export function izipayLeerRespuesta(krAnswer: string): { pagado: boolean; pagoId: string; montoCentimos: number; referencia: string } | null {
  try {
    const a = JSON.parse(krAnswer);
    const tx = Array.isArray(a?.transactions) ? a.transactions[0] : null;
    return {
      pagado: a?.orderStatus === "PAID",
      pagoId: String(a?.orderDetails?.orderId ?? ""),
      montoCentimos: Number(a?.orderDetails?.orderTotalAmount ?? tx?.amount ?? 0),
      referencia: String(tx?.uuid ?? a?.orderDetails?.orderId ?? ""),
    };
  } catch {
    return null;
  }
}

// ---- Acreditación + avisos --------------------------------------------------------
/** Acredita el pago y avisa al cliente (correo/Telegram) y al supremo. */
export async function confirmarPago(
  pagoId: string,
  datos: { referencia?: string; montoCentimos?: number; detalle?: string },
): Promise<{ ok: boolean; pago: Pago | null; error?: string }> {
  const r = await acreditarPago(pagoId, datos);
  if (!r.pago || r.error) return { ok: false, pago: r.pago, error: r.error };
  if (r.nuevo) void avisarPago(r.pago).catch(() => {});
  return { ok: true, pago: r.pago };
}

/** Escapa texto que va dentro de HTML de correo (nombres, correos, referencias). */
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

async function avisarPago(p: Pago) {
  const nombre = PRECIOS[p.plan].nombre;
  const vence = p.vigenteHasta ? new Date(`${p.vigenteHasta}T12:00:00Z`).toLocaleDateString("es-PE", { timeZone: "UTC" }) : "";
  const u = await getUserById(p.userId);
  if (u) {
    await enviarAlerta(u, {
      tipo: "plan",
      titulo: `✅ ${nombre} activado`,
      texto: `Recibimos tu pago de ${soles(p.montoCentimos)}. Tu ${nombre} está activo hasta el ${vence}.`,
      href: "/",
    }).catch(() => null);
    // La constancia de pago llega por correo aunque haya apagado los avisos por correo.
    if (u.alertas?.email === false) {
      await enviarCorreo(
        u.email,
        `${nombre} activado — Radar Tributario`,
        `<p>Hola ${esc(u.nombre)},</p><p>Recibimos tu pago de <b>${soles(p.montoCentimos)}</b>. Tu <b>${nombre}</b> está activo hasta el <b>${vence}</b>.</p><p><a href="${appUrl()}">Entrar a Radar Tributario</a></p>`,
      ).catch(() => null);
    }
  }
  const supremo = env("SUPREMO_EMAIL");
  if (supremo) {
    await enviarCorreo(
      supremo,
      `${p.prueba ? "[PRUEBA] " : ""}Nuevo pago: ${nombre} · ${soles(p.montoCentimos)}`,
      `<p><b>${esc(p.userNombre)}</b> (${esc(p.userEmail)}) pagó <b>${soles(p.montoCentimos)}</b> por el ${nombre}${p.lanzamiento ? " con precio de lanzamiento" : ""}.</p>` +
        `<p>Pasarela: ${esc(p.proveedor)} · Ref: ${esc(p.referencia ?? "-")} · Vigente hasta ${esc(vence)}.</p>`,
    ).catch(() => null);
  }
}
