"use client";

import { useState } from "react";
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
  const [a, setA] = useState<any>(null);
  const [verDetalle, setVerDetalle] = useState(false);

  async function subir(files: FileList) {
    setError(null); setA(null); setBusy(true);
    try {
      const fd = new FormData();
      Array.from(files).forEach((f) => fd.append("file", f));
      const res = await fetch("/api/analisis-compras/parsear", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? "No se pudo analizar el archivo."); return; }
      setA(data.analisis);
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
      el.href = url; el.download = `informe-compras-gerencia.${tipo === "excel" ? "xlsx" : "pdf"}`;
      document.body.appendChild(el); el.click(); el.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError("Error de red al generar el informe.");
    } finally {
      setBusy(false);
    }
  }

  const funcData = (a?.porFuncion ?? []).map((f: any) => ({ name: `${f.cod} ${f.nombre.split(" ").slice(1, 2).join(" ") || f.nombre}`, nombre: f.nombre, value: f.debe, pct: f.pct }));
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
          <strong> varios meses a la vez</strong> (enero…diciembre) y se combinan en un solo informe. El
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
            <span className="text-xs text-emerald-700">✓ {archivos.length} archivo(s)</span>
          )}
          {a && (
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
                📄 {f.nombre} <span className="text-slate-400">· {f.asientos} asiento(s), {f.movimientos} mov.</span>
              </span>
            ))}
          </div>
        )}
      </div>

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

          {/* Análisis clase 9 por función → cuentas */}
          <div className="card p-4">
            <h3 className="mb-3 text-sm font-semibold text-slate-700">Análisis de cuenta clase 9 (detallado)</h3>
            <div className="space-y-4">
              {a.porFuncion.map((f: any) => (
                <div key={f.cod}>
                  <div className="flex items-center justify-between rounded-lg bg-brand-50 px-3 py-2">
                    <span className="text-sm font-bold text-brand-800">{f.cod} · {f.nombre}</span>
                    <span className="text-sm font-bold text-brand-800">{soles(f.debe)} <span className="text-xs font-normal text-brand-500">({f.pct.toFixed(1)}%)</span></span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-[10px] uppercase text-slate-400">
                          <th className="px-3 py-1">Cuenta</th>
                          <th className="px-3 py-1">Concepto</th>
                          <th className="px-3 py-1 text-right">Nº mov.</th>
                          <th className="px-3 py-1 text-right">Importe</th>
                          <th className="px-3 py-1 text-right">%</th>
                        </tr>
                      </thead>
                      <tbody>
                        {f.cuentas.map((c: any) => (
                          <tr key={c.cod} className="border-t border-slate-100">
                            <td className="px-3 py-1 font-medium text-slate-700">{c.cod}</td>
                            <td className="px-3 py-1 text-slate-500">{c.nombre}</td>
                            <td className="px-3 py-1 text-right tabular-nums text-slate-500">{c.n}</td>
                            <td className="px-3 py-1 text-right tabular-nums text-slate-700">{soles(c.debe)}</td>
                            <td className="px-3 py-1 text-right tabular-nums text-slate-400">{c.pct.toFixed(1)}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
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
                      <th className="px-2 py-1">Documento</th>
                      <th className="px-2 py-1">Proveedor</th>
                      <th className="px-2 py-1">Glosa</th>
                      <th className="px-2 py-1 text-right">Importe</th>
                    </tr>
                  </thead>
                  <tbody>
                    {a.topComprobantes.map((d: any, i: number) => (
                      <tr key={i} className="border-t border-slate-100">
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

          {/* Detalle completo */}
          <div className="card p-4">
            <button className="mb-2 text-sm font-semibold text-brand-600 hover:underline" onClick={() => setVerDetalle((v) => !v)}>
              {verDetalle ? "▲ Ocultar" : "▼ Ver"} detalle completo de clase 9 ({a.detalle.length} movimientos)
            </button>
            {verDetalle && (
              <div className="max-h-96 overflow-auto rounded-lg border border-slate-200">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-slate-50">
                    <tr className="text-left text-[10px] uppercase text-slate-400">
                      <th className="px-2 py-1">Cuenta</th>
                      <th className="px-2 py-1">Función</th>
                      <th className="px-2 py-1">Glosa</th>
                      <th className="px-2 py-1">Documento</th>
                      <th className="px-2 py-1">Fecha</th>
                      <th className="px-2 py-1">C.C.</th>
                      <th className="px-2 py-1 text-right">Importe</th>
                    </tr>
                  </thead>
                  <tbody>
                    {a.detalle.map((d: any, i: number) => (
                      <tr key={i} className="border-t border-slate-100">
                        <td className="px-2 py-1 font-medium text-slate-700">{d.cuenta}</td>
                        <td className="px-2 py-1 text-slate-500">{d.funcion}</td>
                        <td className="px-2 py-1 text-slate-500">{d.glosa}</td>
                        <td className="px-2 py-1 text-slate-500">{d.documento}</td>
                        <td className="px-2 py-1 text-slate-400">{d.fecDoc}</td>
                        <td className="px-2 py-1 text-slate-400">{d.cenCos}</td>
                        <td className="px-2 py-1 text-right tabular-nums text-slate-700">{soles(d.debe)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </section>
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
