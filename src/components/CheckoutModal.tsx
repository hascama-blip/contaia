"use client";

import { useEffect, useRef, useState } from "react";

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

// Ventana flotante de pago. Al abrirse crea el pago en el servidor y muestra el
// formulario de la pasarela (Izipay incrustado; Culqi abre su propia ventana;
// Mercado Pago redirige). La confirmación siempre se valida en el servidor.
export default function CheckoutModal({
  plan, abierto, onCerrar, whatsapp,
}: { plan: PlanPago; abierto: boolean; onCerrar: () => void; whatsapp?: string }) {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [cargando, setCargando] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState<{ vigenteHasta?: string } | null>(null);
  const [formListo, setFormListo] = useState(false);
  const [botonPropio, setBotonPropio] = useState(false);
  const krRef = useRef<any>(null);
  const iniciado = useRef(false);

  // Bloquea el scroll de fondo y cierra con Escape.
  useEffect(() => {
    if (!abierto) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape" && !enviando) onCerrar(); };
    window.addEventListener("keydown", esc);
    return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", esc); };
  }, [abierto, enviando, onCerrar]);

  useEffect(() => {
    if (!abierto || iniciado.current) return;
    iniciado.current = true;
    (async () => {
      try {
        const c: Config = await fetch("/api/pagos", { cache: "no-store" }).then((r) => r.json());
        setCfg(c);
        const bloqueado = c.plan === "equipo" || !c.puedePagar || !c.configurada;
        if (bloqueado) { setCargando(false); return; }
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
          });
          culqi.culqi = async () => {
            if (culqi.token) {
              culqi.close?.(); setEnviando(true);
              try { await confirmar("/api/pagos/culqi", { pagoId: d.pagoId, token: culqi.token.id, email: culqi.token.email ?? d.email }); }
              catch (e: any) { setError(e.message); }
              finally { setEnviando(false); }
            } else if (culqi.error) setError(culqi.error.user_message ?? "Culqi no pudo procesar el pago.");
          };
          setCargando(false);
          culqi.open();
          return;
        }

        if (d.proveedor === "izipay") {
          const base = "https://static.micuentaweb.pe/static/js/krypton-client/V4.0";
          cargarCss(`${base}/ext/neon-reset.min.css`);
          await cargarScript(`${base}/stable/kr-payment-form.min.js`, { "kr-public-key": d.publicKey, "kr-language": "es-ES" });
          await cargarScript(`${base}/ext/neon.js`);
          const KR = (window as any).KR;
          if (!KR) throw new Error("No cargó el formulario de Izipay.");
          const { KR: kr } = await KR.setFormConfig({ formToken: d.formToken, "kr-language": "es-ES" });
          krRef.current = kr;
          const { result } = await kr.attachForm("#izipay-form");
          await kr.showForm(result.formId);
          // Si la librería permite enviar por código, usamos NUESTRO botón y
          // ocultamos el de Izipay (así el diseño es el de Radar).
          setBotonPropio(typeof kr.submit === "function");
          kr.onSubmit(async (resp: any) => {
            setEnviando(true);
            try { await confirmar("/api/pagos/izipay", { krAnswer: resp.rawClientAnswer, krHash: resp.hash, krHashKey: resp.hashKey }); }
            catch (e: any) { setError(e.message); }
            finally { setEnviando(false); }
            return false; // no redirigir: ya confirmamos en el servidor
          });
          kr.onError?.((e: any) => { setEnviando(false); if (e?.errorMessage) setError(String(e.errorMessage)); });
          setFormListo(true);
          setCargando(false);
          return;
        }
        throw new Error("Pasarela no reconocida.");
      } catch (e: any) {
        setError(e?.message ?? "Error al iniciar el pago.");
        setCargando(false);
      }
    })();
  }, [abierto, plan]);

  async function confirmar(url: string, body: any) {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error ?? "No se pudo confirmar el pago.");
    setListo({ vigenteHasta: d.pago?.vigenteHasta });
  }

  function pagarAhora() {
    setError(null);
    const kr = krRef.current;
    if (kr && typeof kr.submit === "function") { setEnviando(true); kr.submit(); }
  }

  if (!abierto) return null;
  const precio = cfg?.precios[plan];
  const hoyLima = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const renueva = !!cfg && cfg.plan === plan && !!cfg.planVence && cfg.planVence >= hoyLima;
  const venceNuevo = (() => {
    const base = new Date(`${renueva ? cfg!.planVence : hoyLima}T12:00:00Z`);
    base.setUTCDate(base.getUTCDate() + 30);
    return base.toISOString().slice(0, 10);
  })();
  const bloqueo = !cfg ? null : cfg.plan === "equipo" ? "empresas" : !cfg.puedePagar ? "operador" : !cfg.configurada ? "sin-pasarela" : null;

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-brand-900/70 p-0 backdrop-blur-sm sm:items-center sm:p-4" onClick={() => !enviando && onCerrar()}>
      <div
        className="modal-in flex max-h-[95vh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog" aria-modal="true" aria-label={`Pagar ${NOMBRE[plan]}`}
      >
        {listo ? (
          <div className="px-8 py-10 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-3xl text-emerald-600">✓</div>
            <h2 className="mt-5 text-2xl font-bold text-slate-900">{NOMBRE[plan]} activado</h2>
            <p className="mt-2 text-sm text-slate-500">
              Tus módulos ya están desbloqueados{listo.vigenteHasta ? <> hasta el <b className="text-slate-800">{fecha(listo.vigenteHasta)}</b></> : null}. Te enviamos la constancia por correo.
            </p>
            {/* Recarga completa: el menú y los módulos se recalculan con el plan nuevo. */}
            <a href="/" className="mt-6 inline-flex w-full items-center justify-center rounded-2xl bg-brand-800 px-5 py-3.5 text-sm font-bold text-white hover:bg-brand-700">Ir al inicio</a>
          </div>
        ) : (
          <>
            {/* Cabecera */}
            <div className="flex items-start justify-between gap-4 px-6 pt-6 sm:px-7">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{renueva ? "Renovar" : "Activar"}</p>
                <h2 className="mt-0.5 text-xl font-bold text-slate-900">{NOMBRE[plan]}</h2>
              </div>
              <button
                onClick={onCerrar} disabled={enviando}
                className="-mr-2 -mt-2 flex h-9 w-9 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"
                aria-label="Cerrar"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </div>

            {/* Precio */}
            <div className="mt-4 px-6 sm:px-7">
              <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3">
                <div>
                  <p className="text-xs text-slate-500">Total a pagar hoy</p>
                  <p className="text-[11px] text-slate-400">30 días · vigente hasta {cfg ? fecha(venceNuevo) : "…"}</p>
                </div>
                <div className="text-right">
                  {precio ? (
                    <>
                      <p className="text-2xl font-extrabold tracking-tight text-slate-900">{soles(precio.centimos)}</p>
                      {precio.lanzamiento && (
                        <p className="text-[11px]"><span className="text-slate-400 line-through">{soles(precio.antes)}</span> <span className="ml-1 rounded-full bg-accent-100 px-1.5 py-0.5 font-bold text-accent-800">−50 %</span></p>
                      )}
                    </>
                  ) : <div className="h-8 w-24 animate-pulse rounded bg-slate-200" />}
                </div>
              </div>
            </div>

            {/* Cuerpo: formulario */}
            <div className="sin-barra flex-1 overflow-y-auto px-6 py-5 sm:px-7">
              {cfg?.modoPrueba && !bloqueo && (
                <p className="mb-4 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">Modo prueba: usa una tarjeta de prueba. No se cobra dinero real.</p>
              )}
              {bloqueo === "empresas" && (
                <p className="rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-800">Tu cuenta tiene el <b>Plan Empresas</b>, que ya incluye todo lo de este plan. Para renovarlo o cambiarlo, escríbenos.</p>
              )}
              {bloqueo === "operador" && (
                <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">Solo el líder del estudio puede pagar el plan. Los operadores heredan el plan de su líder.</p>
              )}
              {bloqueo === "sin-pasarela" && (
                <p className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
                  El pago en línea aún no está activo.{" "}
                  {whatsapp && <a href={whatsapp} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand-600 hover:underline">Solicítalo por WhatsApp →</a>}
                </p>
              )}
              {!bloqueo && cargando && (
                <div className="space-y-3">
                  <div className="h-[52px] animate-pulse rounded-2xl bg-slate-100" />
                  <div className="grid grid-cols-2 gap-3"><div className="h-[52px] animate-pulse rounded-2xl bg-slate-100" /><div className="h-[52px] animate-pulse rounded-2xl bg-slate-100" /></div>
                  <div className="h-[52px] animate-pulse rounded-2xl bg-slate-100" />
                  <p className="pt-1 text-center text-xs text-slate-400">Abriendo el pago seguro…</p>
                </div>
              )}
              {/* Contenedor del formulario de Izipay (estilos en globals.css). */}
              {!bloqueo && <div id="izipay-form" className={`radar-kr ${botonPropio ? "sin-boton" : ""} ${formListo ? "" : "hidden"}`} />}
              {error && <div className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
            </div>

            {/* Pie: botón propio + seguridad */}
            <div className="border-t border-slate-100 px-6 pb-6 pt-4 sm:px-7">
              {formListo && botonPropio && (
                <button
                  onClick={pagarAhora} disabled={enviando}
                  className="flex w-full items-center justify-center rounded-2xl bg-brand-800 px-5 py-3.5 text-sm font-bold text-white shadow-sm transition hover:bg-brand-700 disabled:opacity-60"
                >
                  {enviando ? "Procesando el pago…" : `Pagar ${precio ? soles(precio.centimos) : ""}`}
                </button>
              )}
              <p className="mt-3 text-center text-[11px] text-slate-400">
                Pago cifrado y procesado por {cfg?.pasarela === "culqi" ? "Culqi" : cfg?.pasarela === "mercadopago" ? "Mercado Pago" : "Izipay"}. Radar no ve ni guarda los datos de tu tarjeta.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
