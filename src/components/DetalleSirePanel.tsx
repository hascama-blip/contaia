"use client";

import { useState } from "react";
import { getSolPass, getSolUser } from "@/lib/solSession";

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Setiembre", "Octubre", "Noviembre", "Diciembre"];

// Extrae el DETALLE SIRE (propuesta comprobante por comprobante) de un periodo
// desde la API oficial de SUNAT y lo muestra en tabla + Excel.
export default function DetalleSirePanel({ clienteId }: { clienteId: string }) {
  const hoy = new Date();
  const [mes, setMes] = useState(hoy.getMonth() + 1);
  const [anio, setAnio] = useState(hoy.getFullYear());
  const [verVentas, setVerVentas] = useState(true);
  const [verCompras, setVerCompras] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [diagModo, setDiagModo] = useState(false);
  const [diag, setDiag] = useState<string | null>(null);
  const [ventas, setVentas] = useState<any>(null);
  const [compras, setCompras] = useState<any>(null);

  async function extraer() {
    setError(null); setInfo(null); setDiag(null); setVentas(null); setCompras(null);
    const solPass = getSolPass(clienteId);
    const solUser = getSolUser(clienteId);
    if (!solPass) { setError("Carga tus accesos SOL (arriba) para extraer el detalle."); return; }
    if (!verVentas && !verCompras) { setError("Elige al menos ventas o compras."); return; }
    const periodo = `${anio}${String(mes).padStart(2, "0")}`;
    setBusy(true);
    try {
      const res = await fetch(`/api/clientes/${clienteId}/sire-detalle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ solUser, solPass, periodo, incluirVentas: verVentas, incluirCompras: verCompras, diagnostico: diagModo }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.diag) setDiag(JSON.stringify(data.diag, null, 2));
      if (!res.ok) { setError(data.error ?? "No se pudo extraer el detalle."); return; }
      setVentas(data.ventas ?? null);
      setCompras(data.compras ?? null);
      const nv = data.ventas?.comprobantes ?? 0;
      const nc = data.compras?.comprobantes ?? 0;
      setInfo(diagModo ? "Diagnóstico listo (revisa la traza cruda abajo)." : `Ventas: ${nv} · Compras: ${nc} comprobante(s).`);
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
        body: JSON.stringify({ periodo, ventas, compras }),
      });
      if (!res.ok) { setError("No se pudo generar el Excel."); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `detalle-sire-${periodo}.xlsx`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  }

  const anios = [hoy.getFullYear(), hoy.getFullYear() - 1, hoy.getFullYear() - 2];
  const hayDatos = (ventas?.filas?.length ?? 0) > 0 || (compras?.filas?.length ?? 0) > 0;

  return (
    <section className="card p-5">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="font-semibold text-slate-800">Detalle SIRE (propuesta) desde SUNAT</h2>
        <span className="badge bg-slate-100 text-slate-500">API oficial SIRE</span>
      </div>
      <p className="mb-4 text-xs text-slate-400">
        Extrae el <strong>detalle comprobante por comprobante</strong> de la propuesta SUNAT
        (RVIE ventas / RCE compras) vía la API oficial, y descárgalo en <strong>Excel</strong>.
        Requiere tus accesos SOL y las credenciales de la app SIRE ya guardadas.
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
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={verVentas} onChange={(e) => setVerVentas(e.target.checked)} /> Ventas (RVIE)
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={verCompras} onChange={(e) => setVerCompras(e.target.checked)} /> Compras (RCE)
        </label>
        <button className="btn-primary" onClick={extraer} disabled={busy}>
          {busy ? "Extrayendo…" : "⬇ Extraer detalle SIRE"}
        </button>
        {hayDatos && (
          <button className="btn-ghost" onClick={descargarExcel} disabled={busy}>⬇ Excel</button>
        )}
        <label className="ml-auto flex items-center gap-2 text-xs text-slate-500">
          <input type="checkbox" checked={diagModo} onChange={(e) => setDiagModo(e.target.checked)} /> Modo diagnóstico
        </label>
      </div>

      {info && <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">{info}</div>}
      {error && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
      {diag && <pre className="mt-3 max-h-96 overflow-auto rounded-lg bg-slate-900 p-3 text-[11px] text-slate-100">{diag}</pre>}

      <TablaDetalle titulo="Ventas (RVIE)" bloque={ventas} />
      <TablaDetalle titulo="Compras (RCE)" bloque={compras} />
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
