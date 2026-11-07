"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { getSolPass, getSolUser } from "@/lib/solSession";

interface Estado {
  activo: boolean; permitido: boolean; plan: string; solUser?: string; guardadaAt?: string; venceAt?: string;
  ultimoChequeo?: string | null; ultimoError?: string | null; ultimaAlerta?: string | null; vistos?: number;
}
const fmt = (iso?: string | null) => { if (!iso) return "—"; try { return new Date(iso).toLocaleString("es-PE", { dateStyle: "short", timeStyle: "short" }); } catch { return iso; } };

// Vigilancia automática del buzón (opt-in). La Clave SOL se guarda CIFRADA en el
// servidor solo si la persona acepta; vence a los 30 días y se borra al
// desactivar. Cada madrugada se consulta el buzón y se avisa (Telegram/correo)
// de cada notificación nueva.
export default function VigilanciaBuzonPanel({ clienteId, solUserGuardado }: { clienteId: string; solUserGuardado: string }) {
  const [e, setE] = useState<Estado | null>(null);
  const [acepto, setAcepto] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    const r = await fetch(`/api/clientes/${clienteId}/vigilancia`, { cache: "no-store" });
    if (r.ok) setE(await r.json());
  }, [clienteId]);
  useEffect(() => { cargar(); }, [cargar]);

  async function activar() {
    setErr(null); setMsg(null);
    const solPass = getSolPass(clienteId);
    const solUser = getSolUser(clienteId, solUserGuardado);
    if (!solPass) { setErr("Carga primero la Clave SOL en “Accesos SOL” (arriba)."); return; }
    if (!acepto) { setErr("Marca la casilla de consentimiento para guardar la clave cifrada."); return; }
    // Confirmación explícita: activar guarda la Clave SOL cifrada en el servidor.
    if (!confirm("¿Activar la vigilancia del buzón?\n\nLa Clave SOL de esta empresa se guardará cifrada en el servidor durante 30 días para revisar el buzón cada madrugada. Puedes desactivarla cuando quieras.")) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/clientes/${clienteId}/vigilancia`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ solUser, solPass, acepto: true }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(d.error ?? "No se pudo activar."); return; }
      setE(d); setMsg("Vigilancia activada. Desde esta madrugada se revisa el buzón cada día.");
    } finally { setBusy(false); }
  }
  async function desactivar() {
    if (!confirm("¿Dejar de vigilar el buzón y borrar la Clave SOL guardada?")) return;
    setBusy(true); setErr(null); setMsg(null);
    try {
      const r = await fetch(`/api/clientes/${clienteId}/vigilancia`, { method: "DELETE" });
      if (r.ok) { setMsg("Vigilancia desactivada y clave borrada."); await cargar(); }
    } finally { setBusy(false); }
  }

  if (!e) return null;
  const diasRestantes = e.venceAt ? Math.max(0, Math.ceil((new Date(e.venceAt).getTime() - Date.now()) / 86400000)) : null;

  return (
    <section className="card p-5">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h2 className="font-semibold text-slate-800">🛡️ Vigilancia automática del buzón</h2>
        {e.activo
          ? <span className="badge bg-emerald-100 text-emerald-700">Activa</span>
          : <span className="badge bg-slate-100 text-slate-500">Inactiva</span>}
      </div>
      <p className="mb-3 text-xs text-slate-400">
        Cada madrugada Radar entra al buzón SUNAT de esta empresa y te avisa al celular (Telegram) o por correo de cada
        notificación nueva: <em>“{`La empresa X con RUC … recibió una notificación SUNAT: asunto. Debe ser atendida`}”</em>.
        Configura el canal en <Link href="/alertas" className="font-semibold text-brand-600 underline">Alertas</Link>.
      </p>

      {msg && <div className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{msg}</div>}
      {err && <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{err}</div>}

      {!e.permitido ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          🔒 <strong>Nuevo:</strong> seguimiento 24 h del buzón con aviso por Telegram y correo. Disponible en los planes <strong>Premium</strong> y <strong>Empresas</strong>.{" "}
          <Link href="/planes" className="font-semibold underline">Ver planes</Link>
        </div>
      ) : e.activo ? (
        <div className="space-y-2 text-sm text-slate-600">
          <div className="grid gap-1 sm:grid-cols-2">
            <p>Usuario SOL: <strong>{e.solUser}</strong></p>
            <p>Clave guardada: {fmt(e.guardadaAt)} · vence en <strong>{diasRestantes} día(s)</strong></p>
            <p>Última revisión: {fmt(e.ultimoChequeo)}</p>
            <p>Última alerta: {fmt(e.ultimaAlerta)} · {e.vistos ?? 0} mensaje(s) conocidos</p>
          </div>
          {e.ultimoError && <p className="rounded-lg bg-red-50 px-3 py-1.5 text-xs text-red-600">Último error: {e.ultimoError}</p>}
          <p className="text-xs text-slate-400">A los 30 días la clave se borra sola y hay que volver a escribirla. Si SUNAT la rechaza 3 noches seguidas, también se borra y se te avisa.</p>
          <button className="btn-ghost text-sm text-red-600" onClick={desactivar} disabled={busy}>Dejar de vigilar y borrar la clave</button>
        </div>
      ) : (
        <div className="space-y-3 text-sm text-slate-600">
          <label className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed">
            <input type="checkbox" className="mt-0.5" checked={acepto} onChange={(ev) => setAcepto(ev.target.checked)} />
            <span>
              <strong>Acepto</strong> que Radar guarde la <strong>Clave SOL</strong> de esta empresa <strong>cifrada</strong> en su servidor,
              únicamente para consultar el buzón SUNAT de forma automática cada madrugada. Entiendo que la clave
              <strong> vence a los 30 días</strong>, que puedo <strong>borrarla en cualquier momento</strong> y que nunca se muestra ni se comparte.
            </span>
          </label>
          <button className="btn-primary text-sm" onClick={activar} disabled={busy || !acepto}>
            {busy ? "Activando…" : "🛡️ Activar vigilancia (usa la Clave SOL cargada arriba)"}
          </button>
        </div>
      )}
    </section>
  );
}
