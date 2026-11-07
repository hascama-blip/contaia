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
      setIzipay(false); // vuelve a mostrar el botón para reintentar
      setBusy(false);
    }
  }

  if (listo) {
    return (
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="bg-brand-800 px-6 py-8 text-center text-white">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-accent-400 text-2xl text-brand-900 shadow">✓</div>
          <h2 className="mt-4 text-2xl font-bold">¡{NOMBRE[plan]} activado!</h2>
          <p className="mt-1 text-sm text-brand-200">
            Tus módulos ya están desbloqueados{listo.vigenteHasta ? <> hasta el <b className="text-white">{fecha(listo.vigenteHasta)}</b></> : null}.
          </p>
        </div>
        <div className="p-6 text-center">
          <p className="text-sm text-slate-500">Te enviamos la constancia del pago por correo.</p>
          {/* Recarga completa: el menú y los módulos se vuelven a calcular con el plan nuevo. */}
          <a href="/" className="btn-primary mt-4 inline-flex">Ir al inicio</a>
        </div>
      </div>
    );
  }

  if (!cfg) {
    return (
      <div className="grid animate-pulse overflow-hidden rounded-2xl border border-slate-200 bg-white lg:grid-cols-[5fr_7fr]">
        <div className="h-72 bg-brand-800/90" />
        <div className="space-y-3 p-8">
          <div className="h-4 w-40 rounded bg-slate-200" />
          <div className="h-12 rounded-xl bg-slate-100" />
          <div className="h-12 rounded-xl bg-slate-100" />
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      </div>
    );
  }
  const precio = cfg.precios[plan];
  const renueva = cfg.plan === plan && !!cfg.planVence && cfg.planVence >= new Date().toISOString().slice(0, 10);
  const venceNuevo = (() => {
    const base = renueva ? new Date(`${cfg.planVence}T12:00:00Z`) : new Date();
    base.setUTCDate(base.getUTCDate() + 30);
    return base.toISOString().slice(0, 10);
  })();
  const bloqueo =
    cfg.plan === "equipo" ? "empresas" : !cfg.puedePagar ? "operador" : !cfg.configurada ? "sin-pasarela" : null;
  const nombrePasarela = cfg.pasarela === "culqi" ? "Culqi" : cfg.pasarela === "mercadopago" ? "Mercado Pago" : "Izipay";

  return (
    <div className="grid overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm lg:grid-cols-[5fr_7fr]">
      {/* ── Resumen de la compra ── */}
      <aside className="relative overflow-hidden bg-brand-800 p-6 text-white sm:p-8">
        <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-accent-400/10" />
        <div className="pointer-events-none absolute -bottom-20 -left-10 h-56 w-56 rounded-full bg-white/5" />
        <div className="relative">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-accent-300">{renueva ? "Renovación" : "Tu compra"}</p>
          <h2 className="mt-2 text-2xl font-bold">{NOMBRE[plan]}</h2>
          <p className="text-sm text-brand-200">Acceso completo por 30 días</p>

          <div className="mt-6 flex items-end gap-2">
            <span className="text-4xl font-extrabold tracking-tight">{soles(precio.centimos)}</span>
            <span className="pb-1.5 text-sm text-brand-200">/ mes</span>
          </div>
          {precio.lanzamiento && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-sm text-brand-300 line-through">{soles(precio.antes)}</span>
              <span className="rounded-full bg-accent-400 px-2 py-0.5 text-[11px] font-bold text-brand-900">Lanzamiento −50 %</span>
            </div>
          )}

          <dl className="mt-6 space-y-2.5 border-t border-white/10 pt-5 text-sm">
            <div className="flex justify-between gap-3"><dt className="text-brand-200">Plan</dt><dd className="font-medium">{NOMBRE[plan]}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-brand-200">Vigente hasta</dt><dd className="font-medium">{fecha(venceNuevo)}{renueva ? " · se suma" : ""}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-brand-200">Renovación</dt><dd className="font-medium">Manual, te avisamos</dd></div>
            <div className="flex items-center justify-between gap-3 border-t border-white/10 pt-3">
              <dt className="font-semibold">Total a pagar hoy</dt>
              <dd className="text-lg font-extrabold text-accent-300">{soles(precio.centimos)}</dd>
            </div>
          </dl>

          {precio.lanzamiento && cfg.lanzamiento.restantes > 0 && (
            <p className="mt-5 rounded-xl bg-white/5 px-3 py-2 text-xs text-brand-100">
              🎉 Precio para las primeras {cfg.lanzamiento.cupos} personas · quedan <b className="text-accent-300">{cfg.lanzamiento.restantes}</b> cupos. Lo conservas al renovar.
            </p>
          )}
        </div>
      </aside>

      {/* ── Pago ── */}
      <section className="flex flex-col p-6 sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-slate-800">Pago con tarjeta</h3>
            <p className="text-xs text-slate-500">Débito o crédito · pago único de {soles(precio.centimos)}</p>
          </div>
          <div className="flex gap-1.5">
            {["VISA", "Mastercard", "Amex", "Diners"].map((m) => (
              <span key={m} className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">{m}</span>
            ))}
          </div>
        </div>

        {cfg.modoPrueba && !bloqueo && (
          <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            🧪 <b>Modo prueba:</b> usa una tarjeta de prueba de la pasarela. No se cobra dinero real.
          </p>
        )}

        <div className="mt-5 flex-1">
          {bloqueo === "empresas" ? (
            <p className="rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-800">
              Tu cuenta tiene el <b>Plan Empresas</b>, que ya incluye todo lo de este plan. Para renovarlo o cambiarlo, escríbenos.
            </p>
          ) : bloqueo === "operador" ? (
            <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Solo el líder del estudio puede pagar el plan. Los operadores heredan el plan de su líder.
            </p>
          ) : bloqueo === "sin-pasarela" ? (
            <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
              El pago en línea aún no está activo.{" "}
              <a href={whatsapp} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand-600 hover:underline">Solicítalo por WhatsApp →</a>
            </div>
          ) : (
            <>
              {!izipay && (
                <button
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent-400 px-5 py-3.5 text-base font-bold text-brand-900 shadow-sm transition hover:bg-accent-300 disabled:opacity-60"
                  onClick={pagar}
                  disabled={busy}
                >
                  {busy ? "Preparando el pago seguro…" : <>🔒 Continuar al pago · {soles(precio.centimos)}</>}
                </button>
              )}
              {izipay && busy && (
                <div className="space-y-3">
                  <div className="h-12 animate-pulse rounded-xl bg-slate-100" />
                  <div className="h-12 animate-pulse rounded-xl bg-slate-100" />
                  <p className="text-center text-xs text-slate-400">Cargando el formulario seguro de Izipay…</p>
                </div>
              )}
              {/* Contenedor del formulario de Izipay (KR.attachForm lo dibuja aquí; estilos en globals.css). */}
              {izipay && <div id="izipay-form" ref={izipayRef} className="radar-kr" />}
            </>
          )}
          {error && <div className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-4 text-[11px] text-slate-400">
          <span>🔒 Pago cifrado y procesado por {nombrePasarela}. Radar no ve ni guarda tu tarjeta.</span>
          <Link href="/planes" className="text-brand-600 hover:underline">← Ver planes</Link>
        </div>
      </section>
    </div>
  );
}
