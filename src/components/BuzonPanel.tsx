"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { BuzonMensaje } from "@/lib/types";
import { getSolPass } from "@/lib/solSession";

// Buzón electrónico (paso 1). Usa los accesos SOL cargados arriba (Usuario
// guardado + Clave de la sesión); no vuelve a pedir credenciales.
export default function BuzonPanel({
  clienteId,
  solUserGuardado,
  yaConsultado,
}: {
  clienteId: string;
  solUserGuardado: string;
  yaConsultado?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [diag, setDiag] = useState<string | null>(null);
  const [diagModo, setDiagModo] = useState(false);

  const [buzon, setBuzon] = useState<BuzonMensaje[] | null>(null);
  const [peligrosos, setPeligrosos] = useState<BuzonMensaje[]>([]);
  const [urgentes, setUrgentes] = useState<BuzonMensaje[]>([]);

  async function consultar() {
    setError(null); setDiag(null);
    const solUser = solUserGuardado;
    const solPass = getSolPass(clienteId);
    if (!solUser || !solPass) { setError("Carga tus accesos SOL (arriba) para consultar."); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/clientes/${clienteId}/buzon`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ solUser, solPass, dias: 15, diagnostico: diagModo }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? "No se pudo consultar el buzón."); return; }
      if (data.diag) { setDiag(JSON.stringify(data.diag, null, 2)); return; }
      setBuzon(data.mensajes ?? []);
      setPeligrosos(data.peligrosos ?? []);
      setUrgentes(data.urgentes ?? []);
      router.refresh();
    } catch {
      setError("Se cortó la conexión con SUNAT. Intenta de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card p-5">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="font-semibold text-slate-800">📨 Buzón electrónico</h3>
        {yaConsultado && (
          <Link href={`/clientes/${clienteId}/buzon`} className="text-xs text-brand-600 hover:underline">
            Ver notificaciones (PDF)
          </Link>
        )}
      </div>
      <p className="mb-3 text-xs text-slate-500">Mensajes del mes en curso. Usa los accesos SOL cargados.</p>

      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-primary" onClick={consultar} disabled={busy}>
          {busy ? "Consultando…" : "Consultar buzón"}
        </button>
        <label className="flex items-center gap-2 text-xs text-slate-500">
          <input type="checkbox" checked={diagModo} onChange={(e) => setDiagModo(e.target.checked)} />
          Modo diagnóstico
        </label>
      </div>

      {error && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
      {diag && <pre className="mt-3 max-h-72 overflow-auto rounded-lg bg-slate-900 p-3 text-[11px] text-slate-100">{diag}</pre>}

      {buzon && (
        <div className="mt-5">
          {peligrosos.length > 0 && (
            <div className="mb-3 rounded-lg border-2 border-red-300 bg-red-50 p-3">
              <p className="mb-2 text-sm font-bold text-red-700">
                🚨 {peligrosos.length} MÁS PELIGROSO(S) — fiscalización / no contenciosas
              </p>
              <ul className="space-y-2">{peligrosos.map((m) => <MensajeItem key={m.id} m={m} />)}</ul>
            </div>
          )}
          {urgentes.length > 0 && (
            <div className="rounded-lg border border-orange-200 bg-orange-50 p-3">
              <p className="mb-2 text-sm font-semibold text-orange-700">
                ⚠ {urgentes.length} urgente(s) — cobranza / valores
              </p>
              <ul className="space-y-2">{urgentes.map((m) => <MensajeItem key={m.id} m={m} />)}</ul>
            </div>
          )}
          <p className="mb-2 mt-3 text-xs font-semibold uppercase text-slate-400">Todos ({buzon.length})</p>
          {buzon.length === 0 ? (
            <p className="text-sm text-slate-400">Sin mensajes en los últimos 15 días.</p>
          ) : (
            <ul className="space-y-2">{buzon.map((m) => <MensajeItem key={m.id} m={m} />)}</ul>
          )}
        </div>
      )}
    </section>
  );
}

function MensajeItem({ m }: { m: BuzonMensaje }) {
  const badge =
    m.nivel === "peligroso"
      ? "bg-red-100 text-red-700"
      : m.nivel === "urgente"
        ? "bg-orange-100 text-orange-700"
        : "bg-slate-100 text-slate-500";
  return (
    <li className="rounded-md border border-slate-200 bg-white p-2 text-sm">
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium text-slate-800">{m.asunto || "(sin asunto)"}</span>
        {m.tipo && <span className={`badge shrink-0 ${badge}`}>{m.tipo}</span>}
      </div>
      <p className="text-xs text-slate-500">{m.fecha}</p>
    </li>
  );
}
