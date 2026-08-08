"use client";

import { useEffect, useState } from "react";
import { getSolPass, getSolUser } from "@/lib/solSession";

const soles = (n: any) => "S/ " + (Number(n) || 0).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Reporte Electrónico de Rentas y Retenciones (4ta/5ta) — persona natural.
// Como el RTT: dispara el bot (Generar Reporte en SOL) → SUNAT lo manda por
// correo → el webhook lo captura y PARSEA → aquí se muestra el detalle.
export default function RentasPanel({
  clienteId, solUserGuardado, inicial,
}: { clienteId: string; solUserGuardado?: string; inicial?: any }) {
  const [sol, setSol] = useState<any>(inicial ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [diagModo, setDiagModo] = useState(false);
  const [diag, setDiag] = useState<string | null>(null);

  async function cargar() {
    try {
      const res = await fetch(`/api/clientes/${clienteId}/rentas`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setSol(data.solicitud ?? null);
    } catch { /* */ }
  }
  useEffect(() => { cargar(); }, []); // eslint-disable-line
  // Auto-refresco mientras espera el correo de SUNAT.
  useEffect(() => {
    if (sol?.estado !== "en_proceso") return;
    const t = setInterval(cargar, 15000);
    return () => clearInterval(t);
  }, [sol?.estado]); // eslint-disable-line

  async function generar() {
    setError(null); setInfo(null); setDiag(null);
    const solPass = getSolPass(clienteId);
    const solUser = getSolUser(clienteId, solUserGuardado);
    if (!solPass) { setError("Carga tu Clave SOL (arriba)."); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/clientes/${clienteId}/rentas`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ solUser, solPass, diagnostico: diagModo }),
      });
      const data = await res.json().catch(() => ({}));
      if (diagModo && data.diag) setDiag(JSON.stringify(data.diag, null, 2));
      if (!res.ok) { setError(data.error ?? "No se pudo generar el reporte."); await cargar(); return; }
      setInfo(diagModo ? "Diagnóstico listo (revisa la traza abajo)." : "Solicitud enviada. SUNAT enviará el reporte por correo; aquí aparecerá el detalle cuando llegue.");
      await cargar();
    } catch { setError("Error de red."); }
    finally { setBusy(false); }
  }

  const rep = sol?.reporte;

  return (
    <section className="card p-5">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="font-semibold text-slate-800">Reporte de Rentas y Retenciones (4ta / 5ta)</h2>
        <span className="badge bg-slate-100 text-slate-500">Solo Usuario + Clave SOL</span>
      </div>
      <p className="mb-4 text-xs text-slate-400">
        Genera el <strong>Reporte Electrónico de Rentas y Retenciones</strong> en SUNAT (ejercicio 2025). SUNAT lo
        envía por correo a la nube; el sistema lo <strong>captura y extrae</strong> las rentas de 4ta y 5ta
        categoría por empleador, periodo y totales. No revisas el correo a mano.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-primary" onClick={generar} disabled={busy}>
          {busy ? "Generando…" : "📄 Generar Reporte de Rentas"}
        </button>
        {sol && (
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
            sol.estado === "listo" ? "bg-emerald-100 text-emerald-700" :
            sol.estado === "error" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-800"}`}>
            {sol.estado === "listo" ? "Listo" : sol.estado === "error" ? "Error" : "Esperando a SUNAT…"}
          </span>
        )}
        {sol?.rutaPdf && (
          <a className="btn-primary bg-emerald-600 hover:bg-emerald-700 text-sm" href={`/api/clientes/${clienteId}/rentas/pdf`}>
            ⬇ Descargar PDF
          </a>
        )}
        <label className="ml-auto flex items-center gap-2 text-xs text-slate-500">
          <input type="checkbox" checked={diagModo} onChange={(e) => setDiagModo(e.target.checked)} /> Modo diagnóstico
        </label>
      </div>

      {info && <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">{info}</div>}
      {error && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
      {sol?.estado === "error" && sol.error && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">⚠ {sol.error}</div>}
      {sol?.estado === "en_proceso" && <p className="mt-3 text-[11px] text-slate-400">⏳ SUNAT procesa el reporte y lo envía por correo; esta vista se actualiza sola.</p>}
      {diagModo && diag && <pre className="mt-3 max-h-96 overflow-auto rounded-lg bg-slate-900 p-3 text-[11px] text-slate-100">{diag}</pre>}

      {rep && (
        <div className="mt-4">
          {/* Encabezado: titular / documento / ejercicio (como el PDF de SUNAT). */}
          <div className="mb-2">
            {rep.titular && <div className="text-sm font-semibold text-slate-800">{rep.titular}</div>}
            <div className="text-xs text-slate-500">
              {rep.documento && <span>{rep.documento}</span>}
              {rep.documento && rep.anio && <span> · </span>}
              {rep.anio && <span>Año consultado: {rep.anio}</span>}
            </div>
          </div>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="badge bg-slate-100 text-slate-600">Renta 4ta: {soles(rep.totalRenta4ta)}</span>
            <span className="badge bg-slate-100 text-slate-600">Renta 5ta: {soles(rep.totalRenta5ta)}</span>
            <span className="badge bg-slate-200 text-slate-700">Total renta: {soles(rep.totalRenta)}</span>
            <span className="badge bg-brand-100 text-brand-700">Total retención: {soles(rep.totalRetencion)}</span>
          </div>
          {(rep.porEmpleador ?? []).map((g: any, i: number) => (
            <div key={i} className="mb-3 overflow-x-auto rounded-lg border border-slate-200">
              <div className="bg-slate-50 px-3 py-1.5">
                <span className="text-xs font-semibold text-slate-700">{g.empleador}</span>
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[10px] uppercase text-slate-400">
                    <th className="px-3 py-1">Periodo</th><th className="px-3 py-1">Concepto</th>
                    <th className="px-3 py-1 text-right">Monto de renta</th>
                    <th className="px-3 py-1 text-right">Monto de retención</th>
                  </tr>
                </thead>
                <tbody>
                  {(g.filas ?? []).map((f: any, j: number) => (
                    <tr key={j} className="border-t border-slate-100">
                      <td className="px-3 py-1 text-slate-600">{f.periodoTxt}</td>
                      <td className="px-3 py-1 text-slate-600">{f.concepto} categoría</td>
                      <td className="px-3 py-1 text-right tabular-nums text-slate-700">{soles(f.renta)}</td>
                      <td className="px-3 py-1 text-right tabular-nums text-slate-700">{soles(f.retencion)}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-slate-200 bg-slate-50/60">
                    <td className="px-3 py-1 text-right font-medium text-slate-500" colSpan={2}>Sub total empleador</td>
                    <td className="px-3 py-1 text-right tabular-nums font-semibold text-slate-700">{soles(g.totalRenta)}</td>
                    <td className="px-3 py-1 text-right tabular-nums font-semibold text-slate-700">{soles(g.totalRetencion)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          ))}
          {/* Total General (como el pie del PDF). */}
          <div className="flex items-center justify-end gap-6 rounded-lg bg-slate-100 px-4 py-2 text-sm">
            <span className="font-semibold text-slate-700">Total General</span>
            <span className="tabular-nums text-slate-600">Renta: <strong>{soles(rep.totalRenta)}</strong></span>
            <span className="tabular-nums text-slate-600">Retención: <strong>{soles(rep.totalRetencion)}</strong></span>
          </div>
        </div>
      )}
    </section>
  );
}
