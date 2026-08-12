"use client";

import { useState } from "react";
import { getSolPass, getSolUser } from "@/lib/solSession";

const soles = (n: any) => "S/ " + (Number(n) || 0).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ITF (Impuesto a las Transacciones Financieras) — persona natural.
// SUNAT lo muestra EN PANTALLA (no llega por correo): el bot entra a SOL, abre
// el módulo de ITF y lee el reporte. En calibración: Modo diagnóstico vuelca el
// menú y la estructura del formulario.
export default function ItfPanel({ clienteId, solUserGuardado, inicial, sinConsultar }: { clienteId: string; solUserGuardado?: string; inicial?: any; sinConsultar?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [itf, setItf] = useState<any>(inicial ?? null);
  const [consultado, setConsultado] = useState(Boolean(inicial));
  const [diagModo, setDiagModo] = useState(false);
  const [diag, setDiag] = useState<string | null>(null);

  async function consultar() {
    setError(null); setDiag(null);
    const solPass = getSolPass(clienteId);
    const solUser = getSolUser(clienteId, solUserGuardado);
    if (!solPass) { setError("Carga tu Clave SOL (arriba)."); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/clientes/${clienteId}/itf`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ solUser, solPass, diagnostico: diagModo }),
      });
      const data = await res.json().catch(() => ({}));
      if (diagModo && data.diag) setDiag(JSON.stringify(data.diag, null, 2));
      if (!res.ok) { setError(data.error ?? "No se pudo consultar el ITF."); return; }
      setItf(data.itf ?? null);
      setConsultado(true);
    } catch { setError("Error de red."); }
    finally { setBusy(false); }
  }

  return (
    <section className="card p-5">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="font-semibold text-slate-800">ITF — Impuesto a las Transacciones Financieras</h2>
        <span className="badge bg-slate-100 text-slate-500">Solo Usuario + Clave SOL</span>
      </div>
      <p className="mb-4 text-xs text-slate-400">
        SUNAT genera el ITF <strong>en pantalla</strong>. El sistema entra a SOL, abre el módulo de ITF y
        <strong> lee el reporte</strong> directamente (no llega por correo).
      </p>

      <div className="flex flex-wrap items-center gap-3">
        {sinConsultar ? (
          <span className="text-xs text-slate-500">Se consulta desde <b>⚡ Extraer todo</b> (arriba), en una sola sesión.</span>
        ) : (
          <>
            <button className="btn-primary" onClick={consultar} disabled={busy}>
              {busy ? "Consultando…" : "🔎 Consultar ITF"}
            </button>
            <label className="ml-auto flex items-center gap-2 text-xs text-slate-500">
              <input type="checkbox" checked={diagModo} onChange={(e) => setDiagModo(e.target.checked)} /> Modo diagnóstico
            </label>
          </>
        )}
      </div>

      {error && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
      {diagModo && diag && <pre className="mt-3 max-h-96 overflow-auto rounded-lg bg-slate-900 p-3 text-[11px] text-slate-100">{diag}</pre>}

      {consultado && itf && (!itf.filas || itf.filas.length === 0) && (
        <div className="mt-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
          No cuenta con registros de ITF{itf.ejercicio ? ` en el ejercicio ${itf.ejercicio}` : ""}.
        </div>
      )}

      {itf && itf.filas && itf.filas.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
          <div className="bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700">Ejercicio {itf.ejercicio || "—"}</div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase text-slate-400">
                <th className="px-3 py-1">Periodo</th><th className="px-3 py-1">Concepto</th>
                <th className="px-3 py-1 text-right">Monto</th>
              </tr>
            </thead>
            <tbody>
              {(itf.filas ?? []).map((f: any, i: number) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="px-3 py-1 text-slate-600">{f.periodo}</td>
                  <td className="px-3 py-1 text-slate-600">{f.concepto}</td>
                  <td className="px-3 py-1 text-right tabular-nums text-slate-700">{soles(f.monto)}</td>
                </tr>
              ))}
              <tr className="border-t border-slate-200 bg-slate-50/60">
                <td className="px-3 py-1 text-right font-medium text-slate-500" colSpan={2}>Total</td>
                <td className="px-3 py-1 text-right tabular-nums font-semibold text-slate-700">{soles(itf.total)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
