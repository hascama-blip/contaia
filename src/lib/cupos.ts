// ============================================================
//  Cupos por plan
// ============================================================
// 1) GENERACIONES por EMPRESA y por PASO, por MES (zona Lima; se reinician el
//    día 1). Un "paso" es cada procedimiento que entra a SUNAT (buzón, deudas,
//    rentas, ITF, estado SIRE, montos SIRE, 4ta categoría). Solo cuenta una
//    generación EXITOSA: si falla (clave errada, SUNAT caído, error) no consume.
//    Se cuenta por RUC (no por id), así borrar y volver a crear la empresa no
//    reinicia el cupo.
// 2) COMPROBANTES de la Descarga masiva por MES y por estudio (facturas XML/PDF
//    + recibos por honorarios).
//
// Valores por defecto (ajustables por variables de entorno; 0 = sin límite):
//   Básico  3 generaciones · Regular 5 · Premium sin límite · Empresas sin límite
//   Premium 500 comprobantes/mes · Empresas sin límite.
// El Plan Empresas (a cotizar) puede tener límites propios que fija el supremo.

import type { PlanId } from "./modulos";
import type { Usuario } from "./types";
import { getCurrentUser, studioId, esSupremo, planEfectivo } from "./auth";
import { getUserById, getCuposMes, sumarCupo, sumarComprobantesMes, mesLima } from "./db";

export type Paso = "buzon" | "deudas-generar" | "deudas-extraer" | "rentas" | "itf" | "sire-estado" | "sire" | "cuarta";

export const PASOS: Record<Paso, string> = {
  buzon: "Buzón electrónico",
  "deudas-generar": "Deudas · generar reporte",
  "deudas-extraer": "Deudas · extraer",
  rentas: "Rentas 4ta/5ta",
  itf: "ITF",
  "sire-estado": "Estado SIRE",
  sire: "Montos SIRE",
  cuarta: "4ta categoría",
};

const envNum = (k: string, def: number) => {
  const v = Number(process.env[k]);
  return Number.isFinite(v) && process.env[k] !== undefined && process.env[k] !== "" ? v : def;
};
const sinLimite = (n: number | undefined | null) => (n == null || n <= 0 ? null : n);

/** Generaciones por empresa y paso al mes (null = sin límite). */
export function limiteGeneraciones(plan: PlanId, admin?: Usuario | null): number | null {
  if (plan === "equipo" && admin?.limitesCotizados?.generaciones !== undefined) return sinLimite(admin.limitesCotizados.generaciones);
  const def: Record<PlanId, number> = {
    basico: envNum("CUPO_BASICO", 3),
    regular: envNum("CUPO_REGULAR", 5),
    premium: envNum("CUPO_PREMIUM", 0),
    equipo: envNum("CUPO_EMPRESAS", 0),
  };
  return sinLimite(def[plan]);
}

/** Comprobantes de la Descarga masiva al mes (null = sin límite). */
export function topeComprobantes(plan: PlanId, admin?: Usuario | null): number | null {
  if (plan === "equipo" && admin?.limitesCotizados?.comprobantes !== undefined) return sinLimite(admin.limitesCotizados.comprobantes);
  if (plan === "equipo") return sinLimite(envNum("TOPE_COMPROBANTES_EMPRESAS", 0));
  return sinLimite(envNum("TOPE_COMPROBANTES_PREMIUM", 500));
}

const NOMBRE_PLAN: Record<PlanId, string> = { basico: "Plan Básico", regular: "Plan Regular", premium: "Plan Premium", equipo: "Plan Empresas" };

/** Fecha legible del 1 del mes siguiente (renovación de los cupos). */
export function renuevaEl(): string {
  const [y, m] = mesLima().split("-").map(Number);
  const d = new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1, 12));
  return d.toLocaleDateString("es-PE", { day: "numeric", month: "long", timeZone: "UTC" });
}

async function contexto() {
  const u = await getCurrentUser();
  if (!u) return null;
  if (esSupremo(u)) return { adminId: u.id, admin: u, plan: "equipo" as PlanId, supremo: true };
  const adminId = studioId(u);
  const admin = u.parentId ? await getUserById(adminId) : u;
  return { adminId, admin, plan: planEfectivo(admin), supremo: false };
}

export interface TicketCupo {
  adminId: string;
  clave: string;
  lote?: string;
  limite: number | null;
  usados: number;
}

const normRuc = (ruc: string) => String(ruc || "").replace(/\D/g, "");

/** Verifica (SIN consumir) si el estudio puede generar el `paso` para el RUC.
 *  `lote` agrupa varias llamadas como UNA sola generación (p. ej. SIRE por
 *  periodos): si esa tanda ya se contó, se deja pasar aunque el cupo esté lleno. */
/** Una tanda (lote) ya contada sirve para seguir extrayendo durante 60 minutos; después
 *  cuenta como una generación nueva (si no, repetir el mismo lote daba cupo ilimitado). */
export const LOTE_VIGENCIA_MS = 60 * 60 * 1000;
export function loteVigente(contadoAt: string | undefined): boolean {
  const t = contadoAt ? Date.parse(contadoAt) : NaN;
  return Number.isFinite(t) && Date.now() - t < LOTE_VIGENCIA_MS;
}

export async function verificarCupo(ruc: string, paso: Paso, lote?: string): Promise<
  { ok: true; ticket: TicketCupo } | { ok: false; mensaje: string; limite: number; usados: number }
> {
  const ctx = await contexto();
  if (!ctx) return { ok: false, mensaje: "Sesión no válida.", limite: 0, usados: 0 };
  const clave = `${normRuc(ruc)}:${paso}`;
  const limite = ctx.supremo ? null : limiteGeneraciones(ctx.plan, ctx.admin);
  const lot = lote ? String(lote).slice(0, 64) : undefined;
  if (limite === null) return { ok: true, ticket: { adminId: ctx.adminId, clave, lote: lot, limite: null, usados: 0 } };
  const cupos = await getCuposMes(ctx.adminId);
  const usados = cupos.usos[clave] ?? 0;
  if (lot && loteVigente(cupos.lotes[`${clave}:${lot}`])) return { ok: true, ticket: { adminId: ctx.adminId, clave, lote: lot, limite, usados } };
  if (usados >= limite) {
    return {
      ok: false,
      limite,
      usados,
      mensaje:
        `Ya usaste las ${limite} generaciones de «${PASOS[paso]}» para esta empresa este mes (${NOMBRE_PLAN[ctx.plan]}). ` +
        `Se renuevan el ${renuevaEl()}, o mejora tu plan en «Adquirir módulos».`,
    };
  }
  return { ok: true, ticket: { adminId: ctx.adminId, clave, lote: lot, limite, usados } };
}

/** Consume 1 generación (llamar SOLO tras un resultado exitoso). */
export async function consumirCupo(t: TicketCupo): Promise<{ usados: number; limite: number | null; restantes: number | null }> {
  if (t.limite === null) return { usados: 0, limite: null, restantes: null };
  const usados = await sumarCupo(t.adminId, t.clave, t.lote);
  return { usados, limite: t.limite, restantes: Math.max(0, t.limite - usados) };
}

/** Respuesta estándar cuando se agotó el cupo (HTTP 429). */
export function cupoAgotado(v: { mensaje: string; limite: number; usados: number }) {
  return { error: v.mensaje, sinCupo: true, cupo: { usados: v.usados, limite: v.limite, restantes: 0 } };
}

/** Estado de los cupos de una empresa (para mostrarlos en pantalla). */
export async function estadoCuposEmpresa(ruc: string): Promise<{
  plan: PlanId; limite: number | null; renueva: string; pasos: { paso: Paso; nombre: string; usados: number }[];
}> {
  const ctx = await contexto();
  const plan = ctx?.plan ?? "basico";
  const limite = !ctx || ctx.supremo ? null : limiteGeneraciones(plan, ctx.admin);
  const cupos = ctx ? await getCuposMes(ctx.adminId) : { usos: {} as Record<string, number> };
  const r = normRuc(ruc);
  return {
    plan,
    limite,
    renueva: renuevaEl(),
    pasos: (Object.keys(PASOS) as Paso[]).map((p) => ({ paso: p, nombre: PASOS[p], usados: cupos.usos[`${r}:${p}`] ?? 0 })),
  };
}

// ---- Comprobantes de la Descarga masiva ------------------------------------

/** Cuántos comprobantes puede descargar aún el estudio este mes. */
export async function comprobantesDisponibles(): Promise<{ adminId: string; tope: number | null; usados: number; disponibles: number | null; plan: PlanId } | null> {
  const ctx = await contexto();
  if (!ctx) return null;
  const tope = ctx.supremo ? null : topeComprobantes(ctx.plan, ctx.admin);
  const usados = (await getCuposMes(ctx.adminId)).comprobantes;
  return { adminId: ctx.adminId, tope, usados, disponibles: tope === null ? null : Math.max(0, tope - usados), plan: ctx.plan };
}

export async function sumarComprobantes(adminId: string, n: number): Promise<number> {
  return sumarComprobantesMes(adminId, n);
}

export function mensajeTopeComprobantes(tope: number): string {
  return `Llegaste al máximo de ${tope} comprobantes de la Descarga masiva este mes. Se renueva el ${renuevaEl()}. ` +
    `Si necesitas más, el Plan Empresas se cotiza a tu medida.`;
}
