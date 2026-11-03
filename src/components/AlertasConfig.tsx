"use client";

import { useCallback, useEffect, useState } from "react";

interface Estado {
  telegramDisponible: boolean; bot: string; telegramVinculado: boolean; telegramNombre: string;
  codigo: string | null; enlace: string | null; email: boolean; emailDisponible: boolean; correo: string; cronograma: boolean;
  mensaje?: string;
}

// Configuración de alertas al celular: vincular Telegram (sin Meta), correo de
// respaldo, avisos de cronograma y botón de prueba.
export default function AlertasConfig() {
  const [e, setE] = useState<Estado | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

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
      if (!r.ok) { setMsg(d.error ?? "No se pudo completar."); return; }
      if (d.mensaje) setMsg(d.mensaje);
      if (d.telegramDisponible !== undefined) setE(d); else await cargar();
    } finally { setBusy(false); }
  }

  if (!e) return <div className="card p-5 text-sm text-slate-500">Cargando…</div>;

  return (
    <div className="space-y-4">
      {msg && <div className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-800">{msg}</div>}

      {/* Telegram */}
      <section className="card p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold text-slate-800">✈️ Telegram (al celular, al instante)</h2>
          {e.telegramVinculado
            ? <span className="badge bg-emerald-100 text-emerald-700">Vinculado{e.telegramNombre ? ` · ${e.telegramNombre}` : ""}</span>
            : <span className="badge bg-slate-100 text-slate-500">No vinculado</span>}
        </div>
        {!e.telegramDisponible ? (
          <p className="mt-2 text-sm text-slate-500">El canal de Telegram aún no está habilitado en la plataforma (falta configurar el bot). Mientras tanto recibirás las alertas por correo.</p>
        ) : e.telegramVinculado ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button className="btn-ghost text-sm" onClick={() => accion("prueba")} disabled={busy}>📨 Enviar prueba</button>
            <button className="btn-ghost text-sm text-red-600" onClick={() => accion("desvincular")} disabled={busy}>Desvincular</button>
          </div>
        ) : (
          <div className="mt-3 space-y-3 text-sm text-slate-600">
            <ol className="list-decimal space-y-1 pl-5">
              <li>Pulsa <strong>Generar código</strong>.</li>
              <li>Abre el bot <strong>@{e.bot || "RadarTributarIA_bot"}</strong> en Telegram (el botón lo abre con el código listo) y pulsa <strong>Iniciar</strong>, o escríbele el código.</li>
              <li>Vuelve aquí y pulsa <strong>Verificar</strong>.</li>
            </ol>
            <div className="flex flex-wrap items-center gap-2">
              {!e.codigo ? (
                <button className="btn-primary text-sm" onClick={() => accion("codigo")} disabled={busy}>Generar código</button>
              ) : (
                <>
                  <span className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 font-mono text-lg tracking-[0.3em]">{e.codigo}</span>
                  {e.enlace && <a href={e.enlace} target="_blank" rel="noreferrer" className="btn-accent text-sm">Abrir Telegram</a>}
                  <button className="btn-primary text-sm" onClick={() => accion("verificar")} disabled={busy}>{busy ? "…" : "Verificar"}</button>
                  <button className="text-xs text-slate-400 underline" onClick={() => accion("codigo")} disabled={busy}>nuevo código</button>
                </>
              )}
            </div>
            <p className="text-xs text-slate-400">El código vence en 15 minutos. Telegram es gratuito y no requiere verificación de empresa.</p>
          </div>
        )}
      </section>

      {/* Correo */}
      <section className="card p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold text-slate-800">✉️ Correo ({e.correo})</h2>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={e.email} disabled={busy || !e.emailDisponible} onChange={(ev) => accion("email", { valor: ev.target.checked })} />
            Recibir alertas por correo
          </label>
        </div>
        <p className="mt-1 text-xs text-slate-400">{e.emailDisponible ? "Canal de respaldo: llega aunque no tengas Telegram vinculado." : "El correo no está configurado en la plataforma."}</p>
      </section>

      {/* Qué avisa */}
      <section className="card p-5">
        <h2 className="font-semibold text-slate-800">🔔 Qué te avisamos</h2>
        <ul className="mt-2 space-y-2 text-sm text-slate-600">
          <li>📨 <strong>Buzón SUNAT:</strong> cada madrugada se revisa el buzón de las empresas con <em>vigilancia activada</em> (se activa en la ficha de cada empresa, planes Premium y Equipo) y te avisamos de cada notificación nueva: “La empresa X con RUC … recibió una notificación SUNAT: asunto. Debe ser atendida”.</li>
          <li className="flex items-start justify-between gap-3">
            <span>🗓️ <strong>Cronograma de DDJJ mensual:</strong> aviso 3 días antes, 1 día antes y el mismo día del vencimiento de cada empresa, según el último dígito del RUC.</span>
            <label className="flex shrink-0 items-center gap-1.5 text-xs"><input type="checkbox" checked={e.cronograma} disabled={busy} onChange={(ev) => accion("cronograma", { valor: ev.target.checked })} /> Activo</label>
          </li>
          <li>💳 <strong>Tu plan:</strong> aviso 7, 3 y 1 día(s) antes de que venza, y el día del vencimiento.</li>
        </ul>
        <div className="mt-3">
          <button className="btn-ghost text-sm" onClick={() => accion("prueba")} disabled={busy}>📨 Enviar alerta de prueba</button>
        </div>
      </section>
    </div>
  );
}
