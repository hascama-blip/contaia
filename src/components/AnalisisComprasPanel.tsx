"use client";

import { useState } from "react";
import ConciliacionSireRtp from "@/components/ConciliacionSireRtp";
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

const soles = (n: number) => `S/ ${Number(n || 0).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const solesK = (n: number) => `S/ ${Number(n || 0).toLocaleString("es-PE", { maximumFractionDigits: 0 })}`;
const COLORS = ["#1d4ed8", "#b88a2a", "#0ea5e9", "#10b981", "#f97316", "#8b5cf6", "#ef4444", "#64748b"];

export default function AnalisisComprasPanel() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [archivos, setArchivos] = useState<any[]>([]);
  const [consolidado, setConsolidado] = useState<any>(null);
  // Varias empresas (un Excel con una pestaña por empresa): análisis de cada una.
  const [empresas, setEmpresas] = useState<any[]>([]);
  const [sinGasto, setSinGasto] = useState<string[]>([]);
  const [sel, setSel] = useState(-1); // -1 = consolidado (o la única empresa); con varias, abre en la 1.ª
  const [verDetalle, setVerDetalle] = useState(false);
  const a = sel >= 0 ? empresas[sel] : consolidado;
  const esGrupo = empresas.length > 1;

  async function subir(files: FileList) {
    setError(null); setConsolidado(null); setEmpresas([]); setSinGasto([]); setSel(-1); setBusy(true);
    try {
      const fd = new FormData();
      Array.from(files).forEach((f) => fd.append("file", f));
      const res = await fetch("/api/analisis-compras/parsear", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? "No se pudo analizar el archivo."); return; }
      setConsolidado(data.analisis);
      setEmpresas(Array.isArray(data.empresas) ? data.empresas : []);
      // Varias empresas: el análisis va DIVIDIDO, se abre la primera empresa.
      if (Array.isArray(data.empresas) && data.empresas.length > 1) setSel(0);
      setSinGasto(Array.isArray(data.sinGasto) ? data.sinGasto : []);
      setArchivos(data.archivos ?? []);
    } catch {
      setError("Error de red al subir los archivos.");
    } finally {
      setBusy(false);
    }
  }

  async function descargar(tipo: "excel" | "pdf") {
    setError(null); setBusy(true);
    try {
      const res = await fetch(`/api/analisis-compras/${tipo}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analisis: a }),
      });
      if (!res.ok) { setError(`No se pudo generar el informe (${tipo.toUpperCase()}).`); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const el = document.createElement("a");
      const slug = String(a?.consolidado ? "consolidado-grupo" : a?.empresa || "empresa").toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      el.href = url; el.download = `informe-compras-${slug}.${tipo === "excel" ? "xlsx" : "pdf"}`;
      document.body.appendChild(el); el.click(); el.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError("Error de red al generar el informe.");
    } finally {
      setBusy(false);
    }
  }

  // ZIP con UN informe por empresa (PDF o Excel), sin el consolidado.
  const [zipBusy, setZipBusy] = useState<"" | "pdf" | "excel">("");
  async function descargarPorEmpresa(tipo: "excel" | "pdf") {
    setError(null); setZipBusy(tipo);
    try {
      const res = await fetch("/api/analisis-compras/por-empresa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ empresas, tipo }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error ?? "No se pudieron generar los informes por empresa."); return; }
      const blob = await res.blob();
      const nombre = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") || "")?.[1] ?? `informes-por-empresa-${tipo}.zip`;
      const url = URL.createObjectURL(blob);
      const el = document.createElement("a");
      el.href = url; el.download = nombre;
      document.body.appendChild(el); el.click(); el.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError("Error de red al generar los informes.");
    } finally {
      setZipBusy("");
    }
  }

  const funcData = (a?.porFuncion ?? []).map((f: any) => ({ name: `${f.cod} ${f.nombre.replace(/^Gastos\s+/i, "")}`, nombre: f.nombre, value: f.debe, pct: f.pct }));
  const natData = (a?.porNaturaleza ?? []).map((n: any) => ({ name: n.cod, nombre: n.nombre, value: n.debe }));
  const ccData = (a?.porCentroCosto ?? []).map((c: any) => ({ name: c.cod, value: c.debe }));
  const mesData = (a?.porMes ?? []).map((m: any) => ({ name: m.nombre.replace(/ \d{4}$/, ""), nombre: m.nombre, value: m.debe }));

  return (
    <section className="space-y-5">
      {/* Subida */}
      <div className="card p-5">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="font-semibold text-slate-800">Análisis de compras / gastos (clase 9)</h2>
          <span className="badge bg-slate-100 text-slate-500">Libro Diario (Excel)</span>
        </div>
        <p className="mb-4 text-xs text-slate-400">
          Sube el <strong>Libro Diario</strong> crudo (tal cual sale del sistema contable). Puedes subir
          <strong> varios meses a la vez</strong> (enero…diciembre) y se combinan en un solo informe, o un
          Excel con <strong>una pestaña por empresa</strong> (mismo mes): sale un informe por empresa y el
          <strong> consolidado del grupo</strong> con el comparativo. El
          sistema detecta los <strong>asientos</strong>, clasifica los gastos por <strong>función (clase 9)</strong>,
          arma el <strong>dashboard para gerencia</strong> y genera el informe (PDF/Excel).
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <label className={`btn-primary cursor-pointer text-sm ${busy ? "pointer-events-none opacity-50" : ""}`}>
            {busy ? "Analizando…" : "⬆ Subir Libro(s) Diario(s) — varios meses"}
            <input
              type="file"
              multiple
              accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={(e) => { const f = e.target.files; if (f && f.length) subir(f); e.currentTarget.value = ""; }}
            />
          </label>
          {archivos.length > 0 && (
            <span className="text-xs text-emerald-700">✓ {esGrupo ? `${empresas.length} empresas` : `${archivos.length} archivo(s)`}</span>
          )}
          {a && !esGrupo && (
            <div className="ml-auto flex gap-2">
              <button className="btn-primary text-sm" onClick={() => descargar("pdf")} disabled={busy}>
                ⬇ Informe (PDF)
              </button>
              <button className="btn-ghost text-sm" onClick={() => descargar("excel")} disabled={busy}>
                ⬇ Informe (Excel)
              </button>
            </div>
          )}
        </div>
        {error && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
        {archivos.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {archivos.map((f: any, i: number) => (
              <span key={i} className="rounded-full bg-slate-100 px-3 py-1 text-[11px] text-slate-600">
                📄 {f.hoja ? <><strong>{f.hoja}</strong> · {f.empresa}</> : f.nombre} <span className="text-slate-400">· {f.asientos} asiento(s), {f.movimientos} mov.</span>
              </span>
            ))}
          </div>
        )}
      </div>

      {sinGasto.length > 0 && (
        <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Sin gastos de clase 9 (no se analizan): {sinGasto.join(", ")}.
        </div>
      )}

      {esGrupo && (
        <div className="card space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="mr-auto min-w-[16rem] flex-1">
              <p className="text-sm font-semibold text-slate-800">Informes por empresa</p>
              <p className="text-xs text-slate-500">
                Un informe independiente por cada empresa ({empresas.length}), en un ZIP. Los PDF tardan unos segundos por empresa.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
            <button className="btn-primary text-sm" onClick={() => descargarPorEmpresa("pdf")} disabled={busy || !!zipBusy}>
              {zipBusy === "pdf" ? "Generando PDF…" : `⬇ PDF por empresa (${empresas.length})`}
            </button>
            <button className="btn-ghost text-sm" onClick={() => descargarPorEmpresa("excel")} disabled={busy || !!zipBusy}>
              {zipBusy === "excel" ? "Generando Excel…" : `⬇ Excel por empresa (${empresas.length})`}
            </button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
            <span className="text-xs text-slate-500">Ver en pantalla:</span>
          {empresas.map((e: any, i: number) => (
            <button key={i} onClick={() => setSel(i)}
              className={`rounded-full border px-3 py-1.5 text-xs ${sel === i ? "border-brand-700 bg-brand-700 font-semibold text-white" : "border-slate-300 bg-white text-slate-600 hover:border-brand-500"}`}>
              {e.empresa} <span className={sel === i ? "text-white/70" : "text-slate-400"}>· {solesK(e.totalGasto)}</span>
            </button>
          ))}
            <button onClick={() => setSel(-1)}
              className={`rounded-full border border-dashed px-3 py-1.5 text-xs ${sel === -1 ? "border-brand-700 bg-brand-700 font-semibold text-white" : "border-slate-300 bg-white text-slate-500 hover:border-brand-500"}`}>
              Consolidado del grupo (opcional)
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            Descargar solo lo que estás viendo ({a?.consolidado ? "consolidado" : a?.empresa}):
            <button className="font-semibold text-brand-600 hover:underline disabled:opacity-50" onClick={() => descargar("pdf")} disabled={busy || !!zipBusy}>PDF</button>
            ·
            <button className="font-semibold text-brand-600 hover:underline disabled:opacity-50" onClick={() => descargar("excel")} disabled={busy || !!zipBusy}>Excel</button>
          </div>
        </div>
      )}

      {a && (
        <>
          {/* Cabecera del informe */}
          <div className="rounded-2xl border border-brand-200 bg-gradient-to-r from-brand-700 to-brand-900 p-5 text-white shadow">
            <p className="text-xs uppercase tracking-wide text-white/70">Informe de compras y gastos para gerencia</p>
            <h2 className="mt-1 text-xl font-bold">{a.empresa}</h2>
            <p className="text-sm text-white/80">Periodo: {a.periodo || "—"}</p>
          </div>

          {/* KPIs */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi label="Total gasto (clase 9)" valor={soles(a.totalGasto)} destaca />
            <Kpi label="IGV / crédito fiscal" valor={soles(a.totalIgv)} />
            <Kpi label="Comprobantes" valor={String(a.nAsientos)} />
            <Kpi label="Movimientos" valor={String(a.nMovimientos)} />
          </div>

          {a.porEmpresa?.length > 0 && <ComparativoEmpresas filas={a.porEmpresa} total={a.totalGasto} onVer={(empresa) => setSel(empresas.findIndex((e: any) => e.empresa === empresa))} />}

          {/* Charts */}
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="card p-4">
              <h3 className="mb-2 text-sm font-semibold text-slate-700">Gasto por función (destino)</h3>
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie data={funcData} dataKey="value" nameKey="nombre" cx="50%" cy="50%" outerRadius={90} label={(e: any) => `${e.pct.toFixed(0)}%`}>
                    {funcData.map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v: number) => soles(v)} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="card p-4">
              <h3 className="mb-2 text-sm font-semibold text-slate-700">Gasto por naturaleza (clase 6)</h3>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={natData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef2f7" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={solesK} width={64} />
                  <Tooltip formatter={(v: number) => soles(v)} labelFormatter={(l, p: any) => p?.[0]?.payload?.nombre ?? l} />
                  <Bar dataKey="value" name="Gasto" fill="#1d4ed8" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {mesData.length > 1 && (
            <div className="card p-4">
              <h3 className="mb-2 text-sm font-semibold text-slate-700">Gasto por mes</h3>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={mesData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef2f7" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={solesK} width={64} />
                  <Tooltip formatter={(v: number) => soles(v)} labelFormatter={(l, p: any) => p?.[0]?.payload?.nombre ?? l} />
                  <Bar dataKey="value" name="Gasto" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="card p-4">
            <h3 className="mb-2 text-sm font-semibold text-slate-700">Gasto por centro de costo</h3>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={ccData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef2f7" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={solesK} width={64} />
                <Tooltip formatter={(v: number) => soles(v)} />
                <Bar dataKey="value" name="Gasto" fill="#b88a2a" radius={[4, 4, 0, 0]}>
                  {ccData.map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Detalle a nivel 2 dígitos (rollup por función 90…97) */}
          <div className="card p-4">
            <h3 className="mb-2 text-sm font-semibold text-slate-700">Detalle a nivel 2 dígitos (función)</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[10px] uppercase text-slate-400">
                    <th className="px-3 py-1">Cuenta</th>
                    <th className="px-3 py-1">Descripción</th>
                    <th className="px-3 py-1 text-right">Nº mov.</th>
                    <th className="px-3 py-1 text-right">Importe</th>
                    <th className="px-3 py-1 text-right">%</th>
                  </tr>
                </thead>
                <tbody>
                  {a.porFuncion.map((f: any) => (
                    <tr key={f.cod} className="border-t border-slate-100">
                      <td className="px-3 py-1 font-bold text-brand-700">{f.cod}</td>
                      <td className="px-3 py-1 text-slate-600">{f.nombre}</td>
                      <td className="px-3 py-1 text-right tabular-nums text-slate-500">{f.n}</td>
                      <td className="px-3 py-1 text-right tabular-nums font-semibold text-slate-700">{soles(f.debe)}</td>
                      <td className="px-3 py-1 text-right tabular-nums text-slate-400">{f.pct.toFixed(1)}%</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-brand-200 font-bold text-brand-800">
                    <td className="px-3 py-1" colSpan={2}>TOTAL</td>
                    <td className="px-3 py-1 text-right tabular-nums">{a.nMovimientos}</td>
                    <td className="px-3 py-1 text-right tabular-nums">{soles(a.totalGasto)}</td>
                    <td className="px-3 py-1 text-right">100%</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Revisión de clasificación / reclasificación sugerida */}
          {a.revision && (
            <div className="card p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-700">Revisión de clasificación (reclasificación sugerida)</h3>
                <div className="flex gap-2 text-xs">
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-700">✓ {a.revision.correctos} correctos</span>
                  <span className={`rounded-full px-2 py-0.5 ${a.revision.observados ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-500"}`}>
                    ⚠ {a.revision.observados} observados
                  </span>
                </div>
              </div>
              {a.revision.observados === 0 ? (
                <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                  ✓ No se detectaron errores de clasificación evidentes. Los gastos están asignados por función de forma coherente (94 Administración · 95 Ventas · 97 Financieros).
                </div>
              ) : (
                <>
                  <p className="mb-2 text-xs text-slate-500">
                    Se detectaron <strong>{a.revision.observados}</strong> movimiento(s) que podrían estar mal clasificados
                    (S/ {Number(a.revision.importeObservado).toLocaleString("es-PE", { minimumFractionDigits: 2 })}). Sugerencia de la cuenta a reclasificar:
                  </p>
                  <div className="overflow-x-auto rounded-lg border border-amber-200">
                    <table className="w-full text-xs">
                      <thead className="bg-amber-50">
                        <tr className="text-left text-[10px] uppercase text-slate-500">
                          <th className="px-2 py-1">Conf.</th>
                          {a.consolidado && <th className="px-2 py-1">Empresa</th>}
                          <th className="px-2 py-1">Factura / Doc.</th>
                          <th className="px-2 py-1">Fecha</th>
                          <th className="px-2 py-1">Cuenta actual</th>
                          <th className="px-2 py-1">Glosa</th>
                          <th className="px-2 py-1 text-right">Importe</th>
                          <th className="px-2 py-1">Reclasificar a</th>
                          <th className="px-2 py-1">Motivo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {a.revision.hallazgos.map((h: any, i: number) => (
                          <tr key={i} className="border-t border-amber-100">
                            <td className="px-2 py-1">
                              <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${h.confianza === "alta" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>
                                {h.confianza}
                              </span>
                            </td>
                            {a.consolidado && <td className="px-2 py-1 text-slate-600">{h.empresa}</td>}
                            <td className="px-2 py-1 font-semibold text-brand-700">{h.documento || "—"}</td>
                            <td className="px-2 py-1 tabular-nums text-slate-500">{h.fecha || "—"}</td>
                            <td className="px-2 py-1 font-medium text-slate-700">{h.cuenta}<div className="text-[10px] font-normal text-slate-400">{h.funcionActual}</div></td>
                            <td className="px-2 py-1 text-slate-500">{h.glosa}</td>
                            <td className="px-2 py-1 text-right tabular-nums text-slate-700">{soles(h.importe)}</td>
                            <td className="px-2 py-1">
                              <span className="font-semibold text-emerald-700">{h.cuentaSugerida}</span>
                              <div className="text-[10px] text-slate-400">{h.subcuenta}</div>
                            </td>
                            <td className="px-2 py-1 text-[11px] text-slate-500">{h.motivo}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="mt-2 text-[10px] text-slate-400">
                    Sugerencias automáticas para revisión del contador (no se modifica nada). La cuenta sugerida mantiene la naturaleza y corrige la función.
                  </p>
                </>
              )}
            </div>
          )}

          {/* Top conceptos + Top comprobantes */}
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="card p-4">
              <h3 className="mb-2 text-sm font-semibold text-slate-700">Principales conceptos (por glosa)</h3>
              <Tabla filas={a.topConceptos.map((c: any) => [c.nombre, soles(c.debe)])} col2="Importe" />
            </div>
            <div className="card p-4">
              <h3 className="mb-2 text-sm font-semibold text-slate-700">Principales comprobantes</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-[10px] uppercase text-slate-400">
                      {a.consolidado && <th className="px-2 py-1">Empresa</th>}
                      <th className="px-2 py-1">Documento</th>
                      <th className="px-2 py-1">Proveedor</th>
                      <th className="px-2 py-1">Glosa</th>
                      <th className="px-2 py-1 text-right">Importe</th>
                    </tr>
                  </thead>
                  <tbody>
                    {a.topComprobantes.map((d: any, i: number) => (
                      <tr key={i} className="border-t border-slate-100">
                        {a.consolidado && <td className="px-2 py-1 text-slate-600">{d.empresa}</td>}
                        <td className="px-2 py-1 text-slate-600">{d.documento}</td>
                        <td className="px-2 py-1 text-slate-500">{d.proveedor || "—"}</td>
                        <td className="px-2 py-1 text-slate-500">{d.glosa}</td>
                        <td className="px-2 py-1 text-right tabular-nums text-slate-700">{soles(d.debe)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Detalle por función (movimientos ordenados por fecha) */}
          <div className="card p-4">
            <button className="mb-2 text-sm font-semibold text-brand-600 hover:underline" onClick={() => setVerDetalle((v) => !v)}>
              {verDetalle ? "▲ Ocultar" : "▼ Ver"} detalle por función ({a.detalleCuentas.length} funciones · {a.nMovimientos} movimientos)
            </button>
            {verDetalle && (
              <div className="max-h-[36rem] space-y-4 overflow-auto">
                {a.detalleCuentas.map((g: any) => (
                  <div key={g.cuenta} className="rounded-lg border border-slate-200">
                    <div className="flex items-center justify-between bg-brand-50 px-3 py-2">
                      <span className="text-sm font-bold text-brand-800">{g.cuenta} · {g.funcion}</span>
                      <span className="text-sm font-bold text-brand-800">{soles(g.total)} <span className="text-xs font-normal text-brand-500">({g.movimientos.length} mov.)</span></span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-left text-[10px] uppercase text-slate-400">
                            <th className="px-3 py-1">Fecha</th>
                            {a.consolidado && <th className="px-3 py-1">Empresa</th>}
                            <th className="px-3 py-1">Cuenta</th>
                            <th className="px-3 py-1">Glosa</th>
                            <th className="px-3 py-1">Factura / Doc.</th>
                            <th className="px-3 py-1">C.C.</th>
                            <th className="px-3 py-1 text-right">Importe</th>
                          </tr>
                        </thead>
                        <tbody>
                          {g.movimientos.map((m: any, i: number) => (
                            <tr key={i} className="border-t border-slate-100">
                              <td className="px-3 py-1 tabular-nums text-slate-500">{m.fecha}</td>
                              {a.consolidado && <td className="px-3 py-1 text-slate-500">{m.empresa}</td>}
                              <td className="px-3 py-1 tabular-nums text-slate-500">{m.cuenta}</td>
                              <td className="px-3 py-1 text-slate-600">{m.glosa}</td>
                              <td className="px-3 py-1 text-slate-500">{m.documento}</td>
                              <td className="px-3 py-1 text-slate-400">{m.cenCos}</td>
                              <td className="px-3 py-1 text-right tabular-nums text-slate-700">{soles(m.debe)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* Conciliación SIRE vs contabilidad (independiente del análisis de egresos) */}
      <ConciliacionSireRtp />
    </section>
  );
}

// Comparativo entre las empresas del grupo (solo en el consolidado).
function ComparativoEmpresas({ filas, total, onVer }: { filas: any[]; total: number; onVer: (empresa: string) => void }) {
  const codigos = Array.from(new Set(filas.flatMap((f) => Object.keys(f.funciones ?? {})))).sort();
  const suma = (k: string) => filas.reduce((s, f) => s + (f.funciones?.[k] ?? 0), 0);
  return (
    <div className="card p-4">
      <h3 className="mb-1 text-sm font-semibold text-slate-700">Comparativo por empresa</h3>
      <p className="mb-3 text-xs text-slate-400">Gasto de clase 9 de cada empresa del grupo, por función. Clic en una empresa para ver su informe.</p>
      <div className="overflow-x-auto">
        <table className="w-full whitespace-nowrap text-xs">
          <thead>
            <tr className="text-left text-[10px] uppercase text-slate-400">
              <th className="px-2 py-1">Empresa</th>
              <th className="px-2 py-1 text-right">Gasto total</th>
              <th className="w-40 px-2 py-1">% del grupo</th>
              {codigos.map((c) => <th key={c} className="px-2 py-1 text-right" title={c}>{c}</th>)}
              <th className="px-2 py-1 text-right">IGV</th>
              <th className="px-2 py-1 text-right">Comprob.</th>
              <th className="px-2 py-1 text-right">Observ.</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.empresa} className="border-t border-slate-100">
                <td className="min-w-[11rem] whitespace-normal px-2 py-1.5"><button className="text-left font-semibold text-brand-700 hover:underline" onClick={() => onVer(f.empresa)}>{f.empresa}</button></td>
                <td className="px-2 py-1.5 text-right tabular-nums font-semibold text-slate-700">{soles(f.totalGasto)}</td>
                <td className="px-2 py-1.5">
                  <div className="flex items-center gap-2">
                    <div className="h-2 flex-1 overflow-hidden rounded bg-slate-100"><div className="h-2 rounded bg-brand-600" style={{ width: `${Math.min(100, f.pct)}%` }} /></div>
                    <span className="w-10 text-right tabular-nums text-slate-500">{f.pct.toFixed(1)}%</span>
                  </div>
                </td>
                {codigos.map((c) => <td key={c} className="px-2 py-1.5 text-right tabular-nums text-slate-600">{f.funciones?.[c] ? soles(f.funciones[c]) : "—"}</td>)}
                <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">{soles(f.totalIgv)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">{f.nAsientos}</td>
                <td className={`px-2 py-1.5 text-right tabular-nums ${f.observados ? "font-semibold text-amber-700" : "text-slate-400"}`}>{f.observados}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-brand-200 font-bold text-brand-800">
              <td className="px-2 py-1.5">TOTAL GRUPO</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{soles(total)}</td>
              <td className="px-2 py-1.5 text-right">100%</td>
              {codigos.map((c) => <td key={c} className="px-2 py-1.5 text-right tabular-nums">{soles(suma(c))}</td>)}
              <td className="px-2 py-1.5 text-right tabular-nums">{soles(filas.reduce((s, f) => s + f.totalIgv, 0))}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{filas.reduce((s, f) => s + f.nAsientos, 0)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{filas.reduce((s, f) => s + f.observados, 0)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Kpi({ label, valor, destaca }: { label: string; valor: string; destaca?: boolean }) {
  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${destaca ? "border-brand-300 bg-brand-50" : "border-slate-200 bg-white"}`}>
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`mt-1 text-xl font-bold ${destaca ? "text-brand-800" : "text-slate-800"}`}>{valor}</p>
    </div>
  );
}

function Tabla({ filas, col2 }: { filas: [string, string][]; col2: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-[10px] uppercase text-slate-400">
            <th className="px-2 py-1">Concepto</th>
            <th className="px-2 py-1 text-right">{col2}</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f, i) => (
            <tr key={i} className="border-t border-slate-100">
              <td className="px-2 py-1 text-slate-600">{f[0]}</td>
              <td className="px-2 py-1 text-right tabular-nums text-slate-700">{f[1]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
