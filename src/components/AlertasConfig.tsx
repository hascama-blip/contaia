"use client";

import { useCallback, useEffect, useState } from "react";

interface Estado {
  telegramDisponible: boolean; bot: string; telegramVinculado: boolean; telegramNombre: string;
  codigo: string | null; enlace: string | null; email: boolean; emailDisponible: boolean; correo: string; cronograma: boolean;
  mensaje?: string;
}

// ---- Íconos de trazo (heredan el color del texto) ----
const Ico = ({ d, className = "h-5 w-5" }: { d: string; className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
    <path d={d} />
  </svg>
);
const I = {
  telegram: "M21.5 3.5 2.8 10.7c-.9.4-.9 1.6.1 1.9l4.6 1.4 1.8 5.6c.3.8 1.3 1 1.9.4l2.6-2.5 4.9 3.6c.7.5 1.7.1 1.9-.7l3-15.4c.2-1-.8-1.8-1.7-1.5ZM7.5 14l10-7.5L10 15.2",
  correo: "M3.5 6.5h17v11h-17zM3.5 7l8.5 6.5L20.5 7",
  buzon: "M3.5 13.5 6 5.5h12l2.5 8M3.5 13.5v5h17v-5M3.5 13.5h5l1.5 2.5h4l1.5-2.5h5",
  calendario: "M4.5 6.5h15v13h-15zM4.5 10.5h15M8.5 4v4M15.5 4v4",
  plan: "M3.5 7.5h17v10h-17zM3.5 11h17M7 14.5h3",
  enviar: "M5 12h13M13 6l6 6-6 6",
  check: "M5 12.5l4.5 4.5L19 7.5",
};

function Estado({ ok, si, no }: { ok: boolean; si: string; no: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${ok ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-emerald-500" : "bg-slate-400"}`} />
      {ok ? si : no}
    </span>
  );
}

function Interruptor({ on, onChange, disabled, label }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${on ? "bg-brand-700" : "bg-slate-300"}`}
    >
      <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${on ? "translate-x-5" : "translate-x-0.5"}`} />
    </button>
  );
}

function Tarjeta({ icono, titulo, sub, derecha, children }: { icono: string; titulo: string; sub?: string; derecha?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
      <div className="flex items-start gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
          <Ico d={icono} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-[15px] font-semibold text-slate-900">{titulo}</h2>
              {sub && <p className="mt-0.5 text-sm text-slate-500">{sub}</p>}
            </div>
            {derecha && <div className="shrink-0">{derecha}</div>}
          </div>
        </div>
      </div>
      {/* En celular el contenido usa todo el ancho; en pantallas grandes se alinea con el título. */}
      {children && <div className="mt-4 sm:pl-14">{children}</div>}
    </section>
  );
}

// Configuración de alertas: vincular Telegram (sin Meta), correo de respaldo,
// qué se avisa (buzón, cronograma, plan) y envío de prueba.
export default function AlertasConfig() {
  const [e, setE] = useState<Estado | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ texto: string; ok: boolean } | null>(null);
  const [copiado, setCopiado] = useState(false);

  const cargar = useCallback(async () => {
    const r = await fetch("/api/alertas", { cache: "no-store" });
    if (r.ok) setE(await r.json());
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  async function accion(accion: string, extra: Record<string, unknown> = {}) {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/alertas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accion, ...extra }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg({ texto: d.error ?? "No se pudo completar.", ok: false }); return; }
      if (d.mensaje) setMsg({ texto: d.mensaje, ok: true });
      if (d.telegramDisponible !== undefined) setE(d); else await cargar();
    } finally { setBusy(false); }
  }

  async function copiar(codigo: string) {
    try { await navigator.clipboard.writeText(codigo); setCopiado(true); setTimeout(() => setCopiado(false), 1500); } catch { /* */ }
  }

  if (!e) {
    return (
      <div className="space-y-4">
        {[0, 1, 2].map((i) => <div key={i} className="h-28 animate-pulse rounded-2xl border border-slate-200 bg-white" />)}
      </div>
    );
  }

  const bot = e.bot || "RadarTributarIA_bot";
  const pasos = [
    { t: "Genera tu código", d: "Es único y vence en 15 minutos." },
    { t: "Ábrelo en Telegram", d: `El bot @${bot} se abre con el código listo; pulsa Iniciar.` },
    { t: "Verifica aquí", d: "Confirmamos el vínculo y te llega un mensaje." },
  ];
  const paso = e.codigo ? 2 : 1;

  return (
    <div className="space-y-4">
      {/* Resumen de canales */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm">
        <span className="font-medium text-slate-700">Canales activos</span>
        <span className="flex items-center gap-2 text-slate-600">Telegram <Estado ok={e.telegramVinculado} si="Vinculado" no="Sin vincular" /></span>
        <span className="flex items-center gap-2 text-slate-600">Correo <Estado ok={e.email && e.emailDisponible} si="Activo" no="Apagado" /></span>
      </div>

      {msg && (
        <div className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${msg.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-700"}`} role="status">
          {msg.ok && <Ico d={I.check} className="mt-0.5 h-4 w-4 shrink-0" />}
          <span>{msg.texto}</span>
        </div>
      )}

      {/* Telegram */}
      <Tarjeta
        icono={I.telegram}
        titulo="Telegram"
        sub="Avisos al instante en tu celular. Gratis y sin verificación de empresa."
        derecha={<Estado ok={e.telegramVinculado} si={e.telegramNombre ? `Vinculado · ${e.telegramNombre}` : "Vinculado"} no="Sin vincular" />}
      >
        {!e.telegramDisponible ? (
          <p className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
            El canal de Telegram aún no está habilitado en la plataforma. Mientras tanto, las alertas llegan por correo.
          </p>
        ) : e.telegramVinculado ? (
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn-ghost text-sm" onClick={() => accion("prueba")} disabled={busy}>Enviar mensaje de prueba</button>
            <button className="rounded-lg px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50" onClick={() => accion("desvincular")} disabled={busy}>Desvincular</button>
          </div>
        ) : (
          <div className="space-y-4">
            <ol className="grid gap-3 sm:grid-cols-3">
              {pasos.map((p, i) => {
                const n = i + 1;
                const hecho = n < paso;
                const actual = n === paso;
                return (
                  <li key={n} className={`rounded-xl border p-3 ${actual ? "border-brand-200 bg-brand-50/60" : "border-slate-200"}`}>
                    <div className="flex items-center gap-2">
                      <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${hecho ? "bg-emerald-500 text-white" : actual ? "bg-brand-700 text-white" : "bg-slate-200 text-slate-500"}`}>
                        {hecho ? <Ico d={I.check} className="h-3.5 w-3.5" /> : n}
                      </span>
                      <span className={`text-sm font-medium ${actual ? "text-slate-900" : "text-slate-600"}`}>{p.t}</span>
                    </div>
                    <p className="mt-1.5 text-xs leading-relaxed text-slate-500">{p.d}</p>
                  </li>
                );
              })}
            </ol>

            {!e.codigo ? (
              <button className="btn-primary text-sm" onClick={() => accion("codigo")} disabled={busy}>
                {busy ? "Generando…" : "Generar código"}
              </button>
            ) : (
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <button
                  type="button" onClick={() => copiar(e.codigo!)} title="Copiar código"
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 font-mono text-lg font-semibold tracking-[0.35em] text-slate-900 hover:border-brand-300"
                >
                  {e.codigo}
                </button>
                <span className="text-xs text-slate-400">{copiado ? "Copiado" : "Toca para copiar"}</span>
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  {e.enlace && (
                    <a href={e.enlace} target="_blank" rel="noreferrer" className="btn-ghost inline-flex items-center gap-1.5 text-sm">
                      Abrir Telegram <Ico d={I.enviar} className="h-4 w-4" />
                    </a>
                  )}
                  <button className="btn-primary text-sm" onClick={() => accion("verificar")} disabled={busy}>{busy ? "Verificando…" : "Verificar"}</button>
                </div>
                <button className="w-full text-left text-xs text-slate-500 underline-offset-2 hover:underline sm:w-auto" onClick={() => accion("codigo")} disabled={busy}>
                  Generar otro código
                </button>
              </div>
            )}
          </div>
        )}
      </Tarjeta>

      {/* Correo */}
      <Tarjeta
        icono={I.correo}
        titulo="Correo electrónico"
        sub={e.emailDisponible ? `Respaldo a ${e.correo}: llega aunque no tengas Telegram vinculado.` : "El envío de correo no está configurado en la plataforma."}
        derecha={<Interruptor on={e.email && e.emailDisponible} disabled={busy || !e.emailDisponible} onChange={(v) => accion("email", { valor: v })} label="Recibir alertas por correo" />}
      />

      {/* Qué se avisa */}
      <section className="rounded-2xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-4 sm:px-6">
          <div>
            <h2 className="text-[15px] font-semibold text-slate-900">Qué te avisamos</h2>
            <p className="text-sm text-slate-500">Por los canales activos de arriba.</p>
          </div>
          <button className="btn-ghost text-sm" onClick={() => accion("prueba")} disabled={busy}>Enviar alerta de prueba</button>
        </div>
        <ul className="divide-y divide-slate-100">
          <li className="flex items-start gap-4 px-5 py-4 sm:px-6">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600"><Ico d={I.buzon} className="h-[18px] w-[18px]" /></div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-slate-900">Notificaciones del buzón SUNAT</p>
              <p className="mt-0.5 text-sm text-slate-500">
                Cada madrugada revisamos el buzón de las empresas con vigilancia activada y te avisamos de cada notificación nueva, con el PDF adjunto.
                La vigilancia se activa en la ficha de cada empresa (planes Premium y Empresas).
              </p>
            </div>
          </li>
          <li className="flex items-start gap-4 px-5 py-4 sm:px-6">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600"><Ico d={I.calendario} className="h-[18px] w-[18px]" /></div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-slate-900">Vencimientos de la declaración mensual</p>
              <p className="mt-0.5 text-sm text-slate-500">Tres días antes, un día antes y el mismo día, según el último dígito del RUC de cada empresa.</p>
            </div>
            <Interruptor on={e.cronograma} disabled={busy} onChange={(v) => accion("cronograma", { valor: v })} label="Avisos del cronograma" />
          </li>
          <li className="flex items-start gap-4 px-5 py-4 sm:px-6">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600"><Ico d={I.plan} className="h-[18px] w-[18px]" /></div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-slate-900">Vencimiento de tu plan</p>
              <p className="mt-0.5 text-sm text-slate-500">Siete, tres y un día antes de que venza, y el día del vencimiento.</p>
            </div>
          </li>
        </ul>
      </section>
    </div>
  );
}
