"use client";

import { useEffect, useState } from "react";
import { getSolPass, setSolPass as setSolPassSesion } from "@/lib/solSession";
import { usePuedeDiag } from "./SupremoContext";

interface ClienteOpt { id: string; razonSocial: string; ruc: string; solUser: string }

const MESES = [
  ["01", "Enero"], ["02", "Febrero"], ["03", "Marzo"], ["04", "Abril"], ["05", "Mayo"], ["06", "Junio"],
  ["07", "Julio"], ["08", "Agosto"], ["09", "Septiembre"], ["10", "Octubre"], ["11", "Noviembre"], ["12", "Diciembre"],
];

// Consulta MENSUAL de Ingresos de Cuarta Categoría (solo persona natural RUC 10/15).
export default function CuartaCategoriaFlow({ clientes }: { clientes: ClienteOpt[] }) {
  const [clienteId, setClienteId] = useState(clientes[0]?.id ?? "");
  const [solUser, setSolUser] = useState(clientes[0]?.solUser ?? "");
  const [solPass, setSolPass] = useState("");
  const [mes, setMes] = useState("01");
  const [anio, setAnio] = useState(String(new Date().getFullYear()));
  const [html, setHtml] = useState<string>("");
  const [consultado, setConsultado] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modoDiag, setModoDiag] = useState(false);
  const [diag, setDiag] = useState<string | null>(null);
  const puedeDiag = usePuedeDiag();

  useEffect(() => { setSolPass(getSolPass(clienteId)); }, [clienteId]);
  useEffect(() => { if (solPass) setSolPassSesion(clienteId, solPass); }, [clienteId, solPass]);

  function elegir(id: string) {
    setClienteId(id);
    setSolUser(clientes.find((c) => c.id === id)?.solUser ?? "");
    setHtml(""); setConsultado(false); setError(null); setDiag(null);
  }

  async function buscar() {
    if (!clienteId) return setError("Elige una empresa.");
    if (!solPass) return setError("Ingresa la Clave SOL.");
    setBusy(true); setError(null); setDiag(null);
    const ctrl = new AbortController();
    const tope = setTimeout(() => ctrl.abort(), 200000);
    try {
      const res = await fetch(`/api/consultas/cuarta-categoria`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clienteId, solUser, solPass, mes, anio, diagnostico: modoDiag }),
        signal: ctrl.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (modoDiag && data.diag) setDiag(JSON.stringify(data.diag, null, 2));
      if (!res.ok) { setError(data.error ?? "No se pudo consultar."); return; }
      setHtml(data.cuarta?.html ?? "");
      setConsultado(true);
    } catch (e: any) {
      setError(e?.name === "AbortError" ? "Tardó demasiado (SUNAT lento o bloqueado). Reintenta en unos minutos." : "Se cortó la conexión con SUNAT.");
    } finally { clearTimeout(tope); setBusy(false); }
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-slate-800">Cuarta Categoría — consulta mensual</h2>
        <p className="text-sm text-slate-500">
          Reporte de <b>Ingresos de Cuarta Categoría</b> por mes (recibos por honorarios). Solo persona
          natural (RUC 10/15). SUNAT lo muestra en pantalla; el sistema lo extrae.
        </p>
      </div>

      {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
      {diag && (
        <div className="rounded-lg border border-slate-200 bg-slate-900 p-3">
          <p className="mb-1 text-xs font-semibold text-slate-300">Diagnóstico (cópialo y pásamelo para calibrar):</p>
          <pre className="max-h-80 overflow-auto text-[11px] leading-relaxed text-emerald-300">{diag}</pre>
        </div>
      )}

      {clientes.length === 0 ? (
        <div className="card p-6 text-sm text-slate-500">No hay empresas persona natural (RUC 10/15) para este módulo.</div>
      ) : (
        <div className="card p-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="text-xs font-semibold text-slate-600">Empresa (RUC 10/15)</label>
              <select className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm outline-none focus:border-brand-500"
                value={clienteId} onChange={(e) => elegir(e.target.value)}>
                {clientes.map((c) => <option key={c.id} value={c.id}>{c.razonSocial} ({c.ruc})</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600">Usuario SOL</label>
              <input className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm outline-none focus:border-brand-500"
                value={solUser} onChange={(e) => setSolUser(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600">Clave SOL</label>
              <input type="password" className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm outline-none focus:border-brand-500"
                value={solPass} onChange={(e) => setSolPass(e.target.value)} placeholder="No se guarda" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600">Mes</label>
              <select className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm outline-none focus:border-brand-500"
                value={mes} onChange={(e) => setMes(e.target.value)}>
                {MESES.map(([v, n]) => <option key={v} value={v}>{v} · {n}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600">Año</label>
              <input className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm outline-none focus:border-brand-500"
                value={anio} onChange={(e) => setAnio(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="2025" />
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button className="btn-primary" onClick={buscar} disabled={busy}>
              {busy ? "Consultando…" : "🔎 Buscar"}
            </button>
            {puedeDiag && (
              <label className="flex items-center gap-2 text-xs text-slate-500">
                <input type="checkbox" checked={modoDiag} onChange={(e) => setModoDiag(e.target.checked)} />
                Modo diagnóstico
              </label>
            )}
          </div>
        </div>
      )}

      {consultado && !html && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
          No se encontraron ingresos de cuarta categoría en {mes}/{anio}.
        </div>
      )}
      {html && (
        <div className="card p-3">
          <p className="mb-2 text-xs font-semibold text-slate-500">Reporte de Ingresos de Cuarta Categoría — {mes}/{anio}</p>
          <div className="cuarta-tabla overflow-x-auto" dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      )}
    </section>
  );
}
