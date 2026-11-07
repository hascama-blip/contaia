"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

type PlanPago = "regular" | "premium";
interface Precio { centimos: number; antes: number; lanzamiento: boolean }
interface Config {
  pasarela: "culqi" | "mercadopago" | "izipay" | null;
  configurada: boolean;
  modoPrueba?: boolean;
  puedePagar: boolean;
  plan: string;
  planVence: string | null;
  precios: Record<PlanPago, Precio>;
  lanzamiento: { cupos: number; usados: number; restantes: number };
}

const NOMBRE: Record<PlanPago, string> = { regular: "Plan Regular", premium: "Plan Premium" };
const soles = (c: number) => `S/ ${(c / 100).toFixed(2)}`;
const fecha = (iso?: string | null) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString("es-PE", { timeZone: "UTC" }) : "");

/** Carga un <script> externo una sola vez (con atributos opcionales). */
function cargarScript(src: string, attrs: Record<string, string> = {}): Promise<void> {
  return new Promise((ok, mal) => {
    if (document.querySelector(`script[src="${src}"]`)) return ok();
    const s = document.createElement("script");
    s.src = src; s.async = true;
    Object.entries(attrs).forEach(([k, v]) => s.setAttribute(k, v));
    s.onload = () => ok(); s.onerror = () => mal(new Error(`No se pudo cargar ${src}`));
    document.head.appendChild(s);
  });
}
function cargarCss(href: string) {
  if (document.querySelector(`link[href="${href}"]`)) return;
  const l = document.createElement("link");
  l.rel = "stylesheet"; l.href = href;
  document.head.appendChild(l);
}

// Pantalla de pago de un plan. Según la pasarela configurada en el servidor:
//  · Culqi: abre su ventana (tarjeta o Yape) y el cargo se crea en el servidor.
//  · Mercado Pago: redirige a su checkout y vuelve a /pagar/resultado.
//  · Izipay: muestra su formulario incrustado; la firma se valida en el servidor.
export default function PagarPlan({ plan, whatsapp }: { plan: PlanPago; whatsapp: string }) {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState<{ vigenteHasta?: string } | null>(null);
  const [izipay, setIzipay] = useState(false);
  const izipayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/pagos", { cache: "no-store" }).then((r) => r.json()).then(setCfg).catch(() => setError("No se pudo cargar la información de pago."));
  }, []);

  async function confirmar(url: string, body: any) {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error ?? "No se pudo confirmar el pago.");
    setListo({ vigenteHasta: d.pago?.vigenteHasta });
  }

  async function pagar() {
    setError(null); setBusy(true);
    try {
      const res = await fetch("/api/pagos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plan }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? "No se pudo iniciar el pago.");

      if (d.proveedor === "mercadopago") { window.location.href = d.redirect; return; }

      if (d.proveedor === "culqi") {
        await cargarScript("https://js.culqi.com/checkout-js");
        const CulqiCheckout = (window as any).CulqiCheckout;
        if (!CulqiCheckout) throw new Error("No cargó el checkout de Culqi.");
        const paymentMethods = { tarjeta: true, yape: true, billetera: false, bancaMovil: false, agente: false, cuotealo: false };
        const culqi = new CulqiCheckout(d.publicKey, {
          settings: { title: "Radar Tributario", currency: "PEN", amount: d.montoCentimos },
          client: { email: d.email },
          options: { lang: "auto", installments: false, modal: true, paymentMethods, paymentMethodsSort: Object.keys(paymentMethods) },
          appearance: { theme: "default", menuType: "sidebar", buttonCardPayText: `Pagar ${soles(d.montoCentimos)}` },
        });
        culqi.culqi = async () => {
          if (culqi.token) {
            culqi.close?.();
            setBusy(true);
            try { await confirmar("/api/pagos/culqi", { pagoId: d.pagoId, token: culqi.token.id, email: culqi.token.email ?? d.email }); }
            catch (e: any) { setError(e.message); }
            finally { setBusy(false); }
          } else if (culqi.error) {
            setError(culqi.error.user_message ?? "Culqi no pudo procesar el pago.");
            setBusy(false);
          }
        };
        culqi.open();
        setBusy(false);
        return;
      }

      if (d.proveedor === "izipay") {
        const base = "https://static.micuentaweb.pe/static/js/krypton-client/V4.0";
        cargarCss(`${base}/ext/neon-reset.min.css`);
        await cargarScript(`${base}/stable/kr-payment-form.min.js`, { "kr-public-key": d.publicKey, "kr-language": "es-ES" });
        await cargarScript(`${base}/ext/neon.js`);
        setIzipay(true);
        const KR = (window as any).KR;
        if (!KR) throw new Error("No cargó el formulario de Izipay.");
        await new Promise((r) => setTimeout(r, 50)); // que exista el contenedor
        const { KR: kr } = await KR.setFormConfig({ formToken: d.formToken, "kr-language": "es-ES" });
        const { result } = await kr.attachForm("#izipay-form");
        await kr.showForm(result.formId);
        kr.onSubmit(async (resp: any) => {
          try { await confirmar("/api/pagos/izipay", { krAnswer: resp.rawClientAnswer, krHash: resp.hash, krHashKey: resp.hashKey }); setIzipay(false); }
          catch (e: any) { setError(e.message); }
          return false; // no redirigir: ya confirmamos en el servidor
        });
        setBusy(false);
        return;
      }
      throw new Error("Pasarela no reconocida.");
    } catch (e: any) {
      setError(e?.message ?? "Error al iniciar el pago.");
      setBusy(false);
    }
  }

  if (listo) {
    return (
      <div className="card p-6 text-center">
        <p className="text-3xl">✅</p>
        <h2 className="mt-2 text-xl font-bold text-slate-800">¡{NOMBRE[plan]} activado!</h2>
        <p className="mt-1 text-sm text-slate-500">
          Tus módulos ya están desbloqueados{listo.vigenteHasta ? <> hasta el <b>{fecha(listo.vigenteHasta)}</b></> : null}. Te enviamos la constancia por correo.
        </p>
        {/* Recarga completa: el menú y los módulos se vuelven a calcular con el plan nuevo. */}
        <a href="/" className="btn-primary mt-4 inline-flex">Ir al inicio</a>
      </div>
    );
  }

  if (!cfg) return <div className="card p-6 text-sm text-slate-500">{error ?? "Cargando…"}</div>;
  const precio = cfg.precios[plan];
  const renueva = cfg.plan === plan && cfg.planVence;

  return (
    <div className="card p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{renueva ? "Renovar" : "Activar"}</p>
          <h2 className="text-xl font-bold text-slate-800">{NOMBRE[plan]}</h2>
          <p className="text-sm text-slate-500">30 días desde hoy{renueva ? `, sumados a tu vencimiento actual (${fecha(cfg.planVence)})` : ""}.</p>
        </div>
        <div className="text-right">
          <div className="flex items-end justify-end gap-2">
            {precio.lanzamiento && <span className="pb-1 text-sm text-slate-400 line-through">{soles(precio.antes)}</span>}
            <span className="text-3xl font-extrabold text-slate-900">{soles(precio.centimos)}</span>
          </div>
          {precio.lanzamiento && (
            <span className="mt-1 inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
              Lanzamiento −50 % · quedan {cfg.lanzamiento.restantes} de {cfg.lanzamiento.cupos} cupos
            </span>
          )}
        </div>
      </div>

      {!cfg.puedePagar ? (
        <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Solo el líder del estudio puede pagar el plan. Los operadores heredan el plan de su líder.
        </p>
      ) : !cfg.configurada ? (
        <div className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
          El pago en línea aún no está activo.{" "}
          <a href={whatsapp} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand-600 hover:underline">Solicítalo por WhatsApp →</a>
        </div>
      ) : (
        <>
          <button className="btn-accent mt-5 w-full sm:w-auto" onClick={pagar} disabled={busy}>
            {busy ? "Procesando…" : `💳 Pagar ${soles(precio.centimos)}`}
          </button>
          <p className="mt-2 text-[11px] text-slate-400">
            Pago seguro con {cfg.pasarela === "culqi" ? "Culqi (tarjeta o Yape)" : cfg.pasarela === "mercadopago" ? "Mercado Pago" : "Izipay"}.
            Radar no ve ni guarda los datos de tu tarjeta. El plan se activa en cuanto la pasarela confirma el pago.
          </p>
          {cfg.modoPrueba && (
            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              🧪 Modo prueba: usa una tarjeta de prueba de la pasarela. No se cobra dinero real.
            </p>
          )}
        </>
      )}

      {/* Contenedor del formulario de Izipay (KR.attachForm lo dibuja aquí). */}
      {izipay && <div id="izipay-form" ref={izipayRef} className="mt-5 flex justify-center" />}
      {error && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
      <p className="mt-4 text-xs text-slate-400">
        <Link href="/planes" className="text-brand-600 hover:underline">← Ver todos los planes</Link>
      </p>
    </div>
  );
}
