"use client";

import { useState } from "react";
import { getSolPass, getSolUser } from "@/lib/solSession";

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Setiembre", "Octubre", "Noviembre", "Diciembre"];

// Extrae el DETALLE SIRE (propuesta comprobante por comprobante) de un periodo
// desde la API oficial de SUNAT y lo muestra en tabla + Excel. `tipo` fija si
// es Ventas (RVIE) o Compras (RCE) — cada módulo trabaja uno solo.
export default function DetalleSirePanel({ clienteId, tipo }: { clienteId: string; tipo: "ventas" | "compras" }) {
  const esVentas = tipo === "ventas";
  const libro = esVentas ? "RVIE (ventas)" : "RCE (compras)";
  const hoy = new Date();
  const [mes, setMes] = useState(hoy.getMonth() + 1);
  const [anio, setAnio] = useState(hoy.getFullYear());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [diagModo, setDiagModo] = useState(false);
  const [refrescar, setRefrescar] = useState(false);
  const [diag, setDiag] = useState<string | null>(null);
  const [bloque, setBloque] = useState<any>(null);

  async function extraer() {
    setError(null); setInfo(null); setDiag(null); setBloque(null);
    const solPass = getSolPass(clienteId);
    const solUser = getSolUser(clienteId);
    // Con caché no hace falta la Clave SOL; sin caché (o refrescar) sí.
    const periodo = `${anio}${String(mes).padStart(2, "0")}`;
    setBusy(true);
    try {
      const res = await fetch(`/api/clientes/${clienteId}/sire-detalle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ solUser, solPass, periodo, incluirVentas: esVentas, incluirCompras: !esVentas, diagnostico: diagModo, refrescar }),
      });
      const data = await res.json().catch(() => ({}));
      if (diagModo && data.diag) setDiag(JSON.stringify(data.diag, null, 2));
      if (res.status === 400 && !solPass && !data.desdeCache) {
        setError("No hay datos guardados de este periodo. Carga tus accesos SOL (arriba) para extraerlo de SUNAT.");
        return;
      }
      if (!res.ok) { setError(data.error ?? "No se pudo extraer el detalle."); return; }
      const b = esVentas ? data.ventas : data.compras;
      setBloque(b ?? null);
      if (diagModo) { setInfo("Diagnóstico listo (revisa la traza cruda abajo)."); return; }
      const desde = data.desdeCache
        ? ` · guardado (${new Date(data.cacheAt).toLocaleString("es-PE")}) — no se reconsultó SUNAT`
        : " · recién extraído de SUNAT (guardado en caché)";
      setInfo(`${b?.comprobantes ?? 0} comprobante(s) de ${libro}${desde}.`);
    } catch {
      setError("Error de red al extraer el detalle.");
    } finally {
      setBusy(false);
    }
  }

  async function descargarExcel() {
    const periodo = `${anio}${String(mes).padStart(2, "0")}`;
    setBusy(true);
    try {
      const res = await fetch("/api/sire-detalle/excel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ periodo, ventas: esVentas ? bloque : undefined, compras: esVentas ? undefined : bloque }),
      });
      if (!res.ok) { setError("No se pudo generar el Excel."); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `detalle-sire-${tipo}-${periodo}.xlsx`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  }

  const anios = [hoy.getFullYear(), hoy.getFullYear() - 1, hoy.getFullYear() - 2];
  const hayDatos = (bloque?.filas?.length ?? 0) > 0;

  return (
    <section className="card p-5">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="font-semibold text-slate-800">Detalle SIRE — {esVentas ? "Ventas (RVIE)" : "Compras (RCE)"}</h2>
        <span className="badge bg-slate-100 text-slate-500">API oficial SIRE</span>
      </div>
      <p className="mb-4 text-xs text-slate-400">
        Extrae el <strong>detalle comprobante por comprobante</strong> de la propuesta SUNAT de
        <strong> {libro}</strong> vía la API oficial, y descárgalo en <strong>Excel</strong>.
        Requiere tus accesos SOL y las credenciales de la app SIRE ya guardadas. Lo extraído se
        <strong> guarda en caché</strong>: si vuelves a consultar el mismo periodo no se re-pregunta a
        SUNAT (marca <strong>🔄 Refrescar</strong> para forzar una nueva consulta).
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="label">Mes</label>
          <select className="input" value={mes} onChange={(e) => setMes(Number(e.target.value))}>
            {MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Año</label>
          <select className="input" value={anio} onChange={(e) => setAnio(Number(e.target.value))}>
            {anios.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <button className="btn-primary" onClick={extraer} disabled={busy}>
          {busy ? "Extrayendo…" : `⬇ Extraer ${esVentas ? "ventas" : "compras"}`}
        </button>
        {hayDatos && (
          <button className="btn-ghost" onClick={descargarExcel} disabled={busy}>⬇ Excel</button>
        )}
        <label className="ml-auto flex items-center gap-2 text-xs text-slate-500" title="Vuelve a consultar SUNAT en vez de usar lo guardado">
          <input type="checkbox" checked={refrescar} onChange={(e) => setRefrescar(e.target.checked)} /> 🔄 Refrescar
        </label>
        <label className="flex items-center gap-2 text-xs text-slate-500">
          <input type="checkbox" checked={diagModo} onChange={(e) => setDiagModo(e.target.checked)} /> Modo diagnóstico
        </label>
      </div>

      {info && <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">{info}</div>}
      {error && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
      {diag && <pre className="mt-3 max-h-96 overflow-auto rounded-lg bg-slate-900 p-3 text-[11px] text-slate-100">{diag}</pre>}

      <TablaDetalle titulo={esVentas ? "Ventas (RVIE)" : "Compras (RCE)"} bloque={bloque} />
    </section>
  );
}

function TablaDetalle({ titulo, bloque }: { titulo: string; bloque: any }) {
  if (!bloque || !(bloque.columnas?.length)) return null;
  const filas = bloque.filas ?? [];
  return (
    <div className="mt-4">
      <p className="mb-1 text-sm font-semibold text-slate-700">{titulo} <span className="text-xs font-normal text-slate-400">· {filas.length} comprobante(s)</span></p>
      <div className="max-h-96 overflow-auto rounded-lg border border-slate-200">
        <table className="w-full text-[11px]">
          <thead className="sticky top-0 bg-slate-50">
            <tr className="text-left text-[10px] uppercase text-slate-400">
              {bloque.columnas.map((c: string, i: number) => <th key={i} className="whitespace-nowrap px-2 py-1">{c}</th>)}
            </tr>
          </thead>
          <tbody>
            {filas.slice(0, 300).map((f: string[], i: number) => (
              <tr key={i} className="border-t border-slate-100">
                {bloque.columnas.map((_: string, j: number) => (
                  <td key={j} className="whitespace-nowrap px-2 py-1 text-slate-600">{f[j] ?? ""}</td>
                ))}
              </tr>
            ))}
            {filas.length > 300 && (
              <tr><td className="px-2 py-1 text-slate-400" colSpan={bloque.columnas.length}>… y {filas.length - 300} más (descárgalos en Excel)</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
