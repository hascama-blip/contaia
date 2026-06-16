"use client";

import { useState } from "react";
import type { BuzonMensaje } from "@/lib/types";

export default function BuzonPanel({ clienteId }: { clienteId: string }) {
  const [solUser, setSolUser] = useState("");
  const [solPass, setSolPass] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [diagModo, setDiagModo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [diag, setDiag] = useState<string | null>(null);
  const [mensajes, setMensajes] = useState<BuzonMensaje[] | null>(null);
  const [urgentes, setUrgentes] = useState<BuzonMensaje[]>([]);

  async function consultar() {
    setError(null);
    setDiag(null);
    if (!solUser || !solPass) {
      setError("Ingresa el Usuario SOL y la Clave SOL.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/clientes/${clienteId}/buzon`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          solUser,
          solPass,
          clientId,
          clientSecret,
          dias: 15,
          diagnostico: diagModo,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "No se pudo consultar el buzón.");
        return;
      }
      if (data.diag) {
        setDiag(JSON.stringify(data.diag, null, 2));
      } else {
        setMensajes(data.mensajes ?? []);
        setUrgentes(data.urgentes ?? []);
      }
      setSolPass("");
      setClientSecret("");
    } catch {
      setError("Error de red al consultar el buzón.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card p-5">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="font-semibold text-slate-800">Buzón electrónico SUNAT</h2>
        <span className="badge bg-red-100 text-red-700">Urgentes</span>
      </div>
      <p className="mb-4 text-xs text-slate-400">
        Resumen de los mensajes de los últimos 15 días. Resalta{" "}
        <strong>resoluciones de cobranza y valores</strong> para evitar contingencias.
        La Clave SOL se usa solo para esta consulta y <strong>no se guarda</strong>.
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Usuario SOL</label>
          <input className="input" value={solUser} onChange={(e) => setSolUser(e.target.value)} autoComplete="off" />
        </div>
        <div>
          <label className="label">Clave SOL</label>
          <input className="input" type="password" value={solPass} onChange={(e) => setSolPass(e.target.value)} autoComplete="new-password" />
        </div>
        <div>
          <label className="label">client_id</label>
          <input className="input" value={clientId} onChange={(e) => setClientId(e.target.value)} autoComplete="off" />
        </div>
        <div>
          <label className="label">client_secret</label>
          <input className="input" type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} autoComplete="new-password" />
        </div>
      </div>

      <label className="mt-3 flex items-center gap-2 text-xs text-slate-500">
        <input type="checkbox" checked={diagModo} onChange={(e) => setDiagModo(e.target.checked)} />
        Modo diagnóstico (para soporte)
      </label>

      {error && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}

      <button className="btn-primary mt-4" onClick={consultar} disabled={busy}>
        {busy ? "Consultando…" : "Consultar buzón (15 días)"}
      </button>

      {diag && (
        <pre className="mt-3 max-h-72 overflow-auto rounded-lg bg-slate-900 p-3 text-[11px] text-slate-100">{diag}</pre>
      )}

      {mensajes && (
        <div className="mt-5 space-y-4">
          {urgentes.length > 0 && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3">
              <p className="mb-2 text-sm font-semibold text-red-700">
                ⚠ {urgentes.length} mensaje(s) urgente(s) — cobranza / valores
              </p>
              <ul className="space-y-2">
                {urgentes.map((m) => (
                  <MensajeItem key={m.id} m={m} />
                ))}
              </ul>
            </div>
          )}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase text-slate-400">
              Todos los mensajes ({mensajes.length})
            </p>
            {mensajes.length === 0 ? (
              <p className="text-sm text-slate-400">Sin mensajes en los últimos 15 días.</p>
            ) : (
              <ul className="space-y-2">
                {mensajes.map((m) => (
                  <MensajeItem key={m.id} m={m} />
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function MensajeItem({ m }: { m: BuzonMensaje }) {
  return (
    <li className={`rounded-md border p-2 text-sm ${m.urgente ? "border-red-200 bg-white" : "border-slate-200"}`}>
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium text-slate-800">{m.asunto || "(sin asunto)"}</span>
        {m.urgente && <span className="badge shrink-0 bg-red-100 text-red-700">urgente</span>}
      </div>
      <p className="text-xs text-slate-500">
        {m.fecha}
        {m.tipo && <> · {m.tipo}</>}
      </p>
    </li>
  );
}
