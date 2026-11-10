"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Proyeccion, AnalisisDetalle, GrupoDetalle, BaseCalculo } from "@/lib/proyeccion";
import { calcularPlaneamiento, REGIMEN_LABEL, type EntradasPlan, type Regimen } from "@/lib/planeamiento";

interface ClienteMin { id: string; razonSocial: string; ruc: string }

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Setiembre", "Octubre", "Noviembre", "Diciembre"];
const etiqueta = (p: string) => `${MESES[Number(p.slice(4, 6)) - 1] ?? "?"} ${p.slice(0, 4)}`;
const soles = (n: number) => { const v = Number(n || 0); const t = `S/ ${Math.abs(v).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; return v < 0 ? `(${t})` : t; };
const fechaCorta = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split("-"); return `${d}/${m}/${y}`; };
/** Mes anterior a hoy en Lima (el periodo que toca declarar), "AAAA-MM". */
function mesPorDeclarar(): string {
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima", year: "numeric", month: "2-digit" }).format(new Date());
  const [y, m] = hoy.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

type Campos = { regimen: Regimen; coeficiente: string; tieneCredito: boolean; saldoFavorIgv: string; percepciones: string; retenciones: string; saldoFavorRenta: string };
const txt = (n?: number | null) => (n ? String(n) : "");
const aCampos = (e: EntradasPlan): Campos => ({
  regimen: e.regimen, coeficiente: txt(e.coeficiente), tieneCredito: e.saldoFavorIgv > 0,
  saldoFavorIgv: txt(e.saldoFavorIgv), percepciones: txt(e.percepciones), retenciones: txt(e.retenciones), saldoFavorRenta: txt(e.saldoFavorRenta),
});
const n = (s: string) => { const v = Number(String(s).replace(/,/g, "")); return Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : 0; };
const aEntradas = (c: Campos): EntradasPlan => ({
  regimen: c.regimen, coeficiente: n(c.coeficiente) > 0 && n(c.coeficiente) < 100 ? n(c.coeficiente) : null,
  saldoFavorIgv: c.tieneCredito ? n(c.saldoFavorIgv) : 0, percepciones: n(c.percepciones), retenciones: n(c.retenciones), saldoFavorRenta: n(c.saldoFavorRenta),
});
const iguales = (a: EntradasPlan, b: EntradasPlan) => a.regimen === b.regimen && (a.coeficiente ?? null) === (b.coeficiente ?? null)
  && a.saldoFavorIgv === b.saldoFavorIgv && a.percepciones === b.percepciones && a.retenciones === b.retenciones && a.saldoFavorRenta === b.saldoFavorRenta;

// Utilitario "Proyección tributaria": NO consulta SUNAT. Arma el informe con el
// SIRE del mes (Reporte analítico) + el Detalle SIRE ya generados, y el crédito
// a favor de la DJ anterior que se ingresa a mano.
export default function ProyeccionPanel({ clientes, inicialId, inicialPeriodo }: { clientes: ClienteMin[]; inicialId?: string; inicialPeriodo?: string }) {
  const [id, setId] = useState(inicialId ?? "");
  const [mes, setMes] = useState(inicialPeriodo ? `${inicialPeriodo.slice(0, 4)}-${inicialPeriodo.slice(4)}` : mesPorDeclarar());
  const periodo = mes.replace("-", "");
  const [p, setP] = useState<Proyeccion | null>(null);
  const [periodos, setPeriodos] = useState<string[]>([]);
  const [campos, setCampos] = useState<Campos | null>(null);
  const [base, setBase] = useState<BaseCalculo | null>(null);
  const [cargando, setCargando] = useState(false);
  const [busy, setBusy] = useState<"" | "guardar" | "pdf">("");
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const cargar = useCallback(async (conservar = false) => {
    if (!id || !/^\d{6}$/.test(periodo)) { setP(null); return; }
    setCargando(true); setError(null); setMsg(null);
    try {
      const res = await fetch(`/api/proyeccion?cliente=${encodeURIComponent(id)}&periodo=${periodo}`, { cache: "no-store" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "No se pudo cargar.");
      const pr: Proyeccion = j.proyeccion;
      setP(pr); setPeriodos(j.periodos ?? []);
      setBase((b) => (conservar && b && pr.basesDisponibles.includes(b) ? b : pr.base));
      setCampos((c) => (conservar && c ? c : aCampos(pr.entradas)));
    } catch (e) {
      setP(null); setError(e instanceof Error ? e.message : "Error");
    } finally { setCargando(false); }
  }, [id, periodo]);

  useEffect(() => { void cargar(); }, [cargar]);
  // Al volver de generar el SIRE en otra pestaña, vuelve a comprobar las fuentes.
  useEffect(() => {
    const alVolver = () => { if (document.visibilityState === "visible") void cargar(true); };
    document.addEventListener("visibilitychange", alVolver);
    return () => document.removeEventListener("visibilitychange", alVolver);
  }, [cargar]);

  const sel = clientes.find((c) => c.id === id) ?? null;
  const entradas = campos ? aEntradas(campos) : null;
  const sCalc = p && base ? p.calc[base] ?? null : null;
  const r = p && sCalc && entradas ? calcularPlaneamiento(sCalc, entradas, [...p.historial, sCalc]) : null;
  const sinCambios = Boolean(p?.guardado && entradas && iguales(entradas, p.entradas));
  const set = (k: keyof Campos) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setCampos((c) => (c ? { ...c, [k]: e.target.value } : c));

  async function guardar() {
    if (!entradas) return;
    setBusy("guardar"); setError(null); setMsg(null);
    try {
      const res = await fetch("/api/proyeccion", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cliente: id, periodo, ...entradas }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "No se pudo guardar.");
      setP(j.proyeccion); setMsg(`Datos de ${etiqueta(periodo)} guardados.`);
    } catch (e) { setError(e instanceof Error ? e.message : "Error"); } finally { setBusy(""); }
  }

  async function descargarPdf() {
    if (!entradas) return;
    setBusy("pdf"); setError(null); setMsg(null);
    try {
      const res = await fetch("/api/proyeccion/pdf", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cliente: id, periodo, base, ...entradas }) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || "No se pudo generar el PDF."); }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a"); a.href = url; a.download = `proyeccion-tributaria-${sel?.ruc ?? ""}-${periodo}.pdf`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) { setError(e instanceof Error ? e.message : "Error"); } finally { setBusy(""); }
  }

  const sinIgv = campos?.regimen === "rus" || campos?.regimen === "ninguno";
  const c = p?.cierre;

  return (
    <div className="space-y-4">
      {/* Empresa y periodo */}
      <div className="card grid gap-3 p-5 sm:grid-cols-[1fr_auto]">
        <div>
          <label className="label">Empresa</label>
          {clientes.length === 0 ? (
            <p className="text-sm text-slate-500">No tienes empresas registradas. <Link href="/clientes/nuevo" className="text-brand-600 hover:underline">Crea una primero →</Link></p>
          ) : (
            <select className="input" value={id} onChange={(e) => { setId(e.target.value); setP(null); setCampos(null); }}>
              <option value="">— Elige una empresa —</option>
              {clientes.map((x) => <option key={x.id} value={x.id}>{x.razonSocial} · RUC {x.ruc}</option>)}
            </select>
          )}
        </div>
        <div>
          <label className="label">Periodo</label>
          <input className="input" type="month" value={mes} onChange={(e) => { setMes(e.target.value); setCampos(null); }} />
          {periodos.length > 0 && (
            <p className="mt-1 max-w-[16rem] text-[11px] text-slate-500">Con SIRE: {periodos.slice(0, 6).map((x) => (
              <button key={x} className={`mr-1.5 underline-offset-2 hover:underline ${x === periodo ? "font-bold text-brand-700" : "text-brand-600"}`} onClick={() => { setMes(`${x.slice(0, 4)}-${x.slice(4)}`); setCampos(null); }}>{MESES[Number(x.slice(4)) - 1].slice(0, 3)} {x.slice(2, 4)}</button>
            ))}</p>
          )}
        </div>
      </div>

      {error && <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {cargando && !p && <p className="text-sm text-slate-500">Cargando…</p>}

      {p && sel && (
        <>
          {/* Paso 1: fuentes */}
          <section className="card p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold text-slate-800">1. Información de {etiqueta(periodo)}</h2>
              <button className="btn-ghost text-sm" onClick={() => cargar(true)} disabled={cargando}>{cargando ? "Comprobando…" : "↻ Volver a comprobar"}</button>
            </div>
            <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              <Fuente titulo="SIRE del mes (montos de ventas y compras)" donde="Reporte analítico de auditoría → Extracción SIRE"
                ok={p.fuentes.resumen ? `Generado${p.fuentes.resumen.at ? ` el ${fechaCorta(p.fuentes.resumen.at)}` : ""}` : null}
                href={`/clientes/${sel.id}`} cta="Generar en el Reporte analítico" />
              <Fuente titulo="Detalle SIRE — ventas (RVIE)" donde="Detalle SIRE → Ventas"
                ok={p.fuentes.detalleVentas ? `${p.fuentes.detalleVentas.comprobantes} comprobante(s) · ${fechaCorta(p.fuentes.detalleVentas.at)}` : null}
                href={`/herramientas/detalle-sire?cliente=${sel.id}&tab=ventas&periodo=${periodo}`} cta="Generar en Detalle SIRE" />
              <Fuente titulo="Detalle SIRE — compras (RCE)" donde="Detalle SIRE → Compras"
                ok={p.fuentes.detalleCompras ? `${p.fuentes.detalleCompras.comprobantes} comprobante(s) · ${fechaCorta(p.fuentes.detalleCompras.at)}` : null}
                href={`/herramientas/detalle-sire?cliente=${sel.id}&tab=compras&periodo=${periodo}`} cta="Generar en Detalle SIRE" />
            </div>
            {p.avisos.map((a, i) => <p key={i} className="mt-2 text-sm text-amber-700">{a}</p>)}
            {!p.basesDisponibles.length && (
              <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                Aún no hay SIRE de {etiqueta(periodo)} para esta empresa. Genéralo en los módulos de arriba y luego pulsa «Volver a comprobar».
              </p>
            )}
          </section>

          {campos && p.basesDisponibles.length > 0 && (
            <>
              {/* Paso 2: datos manuales */}
              <section className="card space-y-4 p-5">
                <h2 className="font-semibold text-slate-800">2. Crédito a favor y datos de la DJ anterior (manual)</h2>
                {!sinIgv && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-4">
                    <p className="mb-2 text-sm font-semibold text-amber-900">¿Tiene crédito (saldo) a favor de IGV en la DJ mensual anterior?</p>
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1">
                        {([false, true] as const).map((v) => (
                          <button key={String(v)} onClick={() => setCampos((x) => (x ? { ...x, tieneCredito: v } : x))}
                            className={`rounded-md px-4 py-1.5 text-sm font-semibold transition ${campos.tieneCredito === v ? "bg-brand-600 text-white" : "text-slate-500 hover:text-brand-700"}`}>
                            {v ? "Sí tiene" : "No tiene"}
                          </button>
                        ))}
                      </div>
                      {campos.tieneCredito && (
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-slate-600">Monto S/</span>
                          <input className="input w-40" inputMode="decimal" placeholder="0.00" autoFocus value={campos.saldoFavorIgv} onChange={set("saldoFavorIgv")} />
                          <span className="text-[11px] text-slate-500">Casilla 145 del PDT 621</span>
                        </div>
                      )}
                    </div>
                    <div className="mt-4 grid gap-3 sm:grid-cols-3">
                      <Campo l="Percepciones IGV" ayuda="Del mes + saldo no aplicado" v={campos.percepciones} on={set("percepciones")} />
                      <Campo l="Retenciones IGV" ayuda="Del mes + saldo no aplicado" v={campos.retenciones} on={set("retenciones")} />
                      <Campo l="Saldo a favor de renta" ayuda="Aplicable a pagos a cuenta" v={campos.saldoFavorRenta} on={set("saldoFavorRenta")} />
                    </div>
                  </div>
                )}
                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <label className="label">Régimen de renta</label>
                    <select className="input" value={campos.regimen} onChange={set("regimen")}>
                      {(Object.keys(REGIMEN_LABEL) as Regimen[]).map((k) => <option key={k} value={k}>{REGIMEN_LABEL[k]}{k === p.regimenSugerido ? " (según SUNAT)" : ""}</option>)}
                    </select>
                  </div>
                  {(campos.regimen === "general" || campos.regimen === "mype") && (
                    <Campo l="Coeficiente renta (%)" ayuda="Opcional. Vacío = 1.5 %" v={campos.coeficiente} on={set("coeficiente")} ph="1.5" />
                  )}
                  {p.basesDisponibles.length > 1 && (
                    <div>
                      <label className="label">Calcular con</label>
                      <select className="input" value={base ?? ""} onChange={(e) => setBase(e.target.value as BaseCalculo)}>
                        <option value="resumen">SIRE del mes (resumen)</option>
                        <option value="detalle">Detalle SIRE (en soles)</option>
                      </select>
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <button className="btn-primary" onClick={guardar} disabled={busy !== "" || sinCambios}>{busy === "guardar" ? "Guardando…" : sinCambios ? "Datos guardados" : "Guardar datos manuales"}</button>
                  <button className="btn-accent" onClick={descargarPdf} disabled={busy !== "" || !r}>{busy === "pdf" ? "Generando PDF…" : "⬇ Descargar informe PDF"}</button>
                  {msg && <span className="text-sm text-emerald-700">{msg}</span>}
                </div>
              </section>

              {r && sCalc && (
                <section className="card space-y-5 p-5">
                  <h2 className="font-semibold text-slate-800">3. Proyección de {etiqueta(periodo)}</h2>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <Kpi titulo="IGV a pagar" valor={soles(r.igvAPagar)} sub={r.saldoFavorSiguiente > 0 ? `Saldo a favor: ${soles(r.saldoFavorSiguiente)}` : sinIgv ? "No aplica" : "Débito − crédito − saldos"} tono={r.igvAPagar > 0 ? "rojo" : "verde"} />
                    <Kpi titulo={campos.regimen === "rus" ? "Cuota Nuevo RUS" : "Renta (pago a cuenta)"} valor={soles(r.rentaAPagar)} sub={r.baseTasa || "No aplica"} />
                    <Kpi titulo="Total a pagar" valor={soles(r.totalAPagar)} sub={etiqueta(periodo)} />
                    <Kpi titulo="Vence la DJ" valor={c ? fechaCorta(c.vence) : "—"}
                      sub={!c ? "" : c.estado === "vencido" ? `Vencido hace ${-c.diasCalendario} día(s)` : c.estado === "vence-hoy" ? "Vence hoy" : `Faltan ${c.diasHabiles} día(s) hábil(es)${c.oficial ? "" : " · ref."}`}
                      tono={c && (c.estado === "vencido" || c.estado === "vence-hoy") ? "rojo" : c?.estado === "urgente" ? "ambar" : undefined} />
                  </div>

                  <div className="grid gap-4 lg:grid-cols-2">
                    <Tabla titulo="IGV — cuenta propia">
                      <Fila l={`Ventas gravadas (base) · ${sCalc.ventas.comprobantes} comprob.`} v={r.ventasBase} />
                      <Fila l="IGV de ventas (débito fiscal)" v={r.debitoFiscal} />
                      <Fila l={`Compras gravadas (base) · ${sCalc.compras.comprobantes} comprob.`} v={r.comprasBase} />
                      <Fila l="IGV de compras (crédito fiscal)" v={-r.creditoFiscal} />
                      <Fila l="Tributo resultante" v={r.tributoResultante} fuerte />
                      <Fila l="(−) Saldo a favor mes anterior" v={-r.saldoFavorAnterior} />
                      <Fila l="Impuesto resultante" v={r.impuestoResultante} fuerte />
                      <Fila l="(−) Percepciones aplicadas" v={-r.percepcionesAplicadas} />
                      <Fila l="(−) Retenciones aplicadas" v={-r.retencionesAplicadas} />
                      <Fila l="IGV a pagar" v={r.igvAPagar} total />
                      {r.saldoFavorSiguiente > 0 && <Fila l="Saldo a favor para el mes siguiente" v={r.saldoFavorSiguiente} verde />}
                      {r.saldoPercepcionesSiguiente > 0 && <Fila l="Saldo de percepciones/retenciones por aplicar" v={r.saldoPercepcionesSiguiente} verde />}
                    </Tabla>
                    <Tabla titulo={`Renta — ${REGIMEN_LABEL[campos.regimen]}`}>
                      <Fila l="Ingresos netos del mes (gravados + exonerados/inafectos)" v={r.ingresosNetos} />
                      {campos.regimen === "mype" && <Fila l={`Ingresos acumulados del año (tope 300 UIT = ${soles(r.topeRmt)})`} v={r.ingresosAcumulados} />}
                      <tr className="border-t border-slate-100"><td className="px-3 py-1.5 text-slate-600">Tasa aplicada</td><td className="px-3 py-1.5 text-right text-slate-700">{r.baseTasa || "—"}</td></tr>
                      <Fila l={campos.regimen === "rus" ? "Cuota mensual" : "Pago a cuenta"} v={r.pagoACuenta} fuerte />
                      <Fila l="(−) Saldo a favor de renta" v={-r.saldoFavorRentaAplicado} />
                      <Fila l="Renta a pagar" v={r.rentaAPagar} total />
                    </Tabla>
                  </div>

                  {r.recomendaciones.length > 0 && (
                    <div className="rounded-lg border border-brand-100 bg-brand-50/50 p-4">
                      <p className="mb-2 text-sm font-semibold text-brand-800">Planeamiento y recomendaciones</p>
                      <ul className="list-disc space-y-1.5 pl-5 text-sm text-slate-700">{r.recomendaciones.map((t, i) => <li key={i}>{t}</li>)}</ul>
                    </div>
                  )}

                  {p.cuadre.length > 0 && (
                    <div>
                      <p className="mb-2 text-sm font-semibold text-slate-800">Cuadre: SIRE del mes vs Detalle SIRE {p.cuadra ? <span className="ml-1 rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700">Coinciden</span> : <span className="ml-1 rounded bg-red-100 px-2 py-0.5 text-xs text-red-700">Con diferencias</span>}</p>
                      <div className="overflow-x-auto rounded-lg border border-slate-200">
                        <table className="w-full text-sm">
                          <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-3 py-2 text-left">Libro</th><th className="px-3 py-2 text-left">Concepto</th><th className="px-3 py-2 text-right">SIRE del mes</th><th className="px-3 py-2 text-right">Detalle SIRE</th><th className="px-3 py-2 text-right">Diferencia</th></tr></thead>
                          <tbody>{p.cuadre.map((x, i) => { const cnt = x.concepto === "Comprobantes"; const mal = cnt ? x.diferencia !== 0 : Math.abs(x.diferencia) > 1; return (
                            <tr key={i} className="border-t border-slate-100"><td className="px-3 py-1.5 capitalize text-slate-600">{x.libro}</td><td className="px-3 py-1.5 text-slate-600">{x.concepto}</td>
                              <td className="px-3 py-1.5 text-right tabular-nums">{cnt ? x.resumen : soles(x.resumen)}</td><td className="px-3 py-1.5 text-right tabular-nums">{cnt ? x.detalle : soles(x.detalle)}</td>
                              <td className={`px-3 py-1.5 text-right tabular-nums ${mal ? "font-semibold text-red-600" : "text-slate-400"}`}>{cnt ? x.diferencia : soles(x.diferencia)}</td></tr>); })}</tbody>
                        </table>
                      </div>
                      {!p.cuadra && <p className="mt-1.5 text-xs text-slate-500">Puede deberse a comprobantes en moneda extranjera, notas de crédito o a que se extrajeron en fechas distintas. Elige en «Calcular con» la base que corresponda o vuelve a generar ambos.</p>}
                    </div>
                  )}

                  <div className="grid gap-4 lg:grid-cols-2">
                    <Detalle titulo="Ventas — Detalle SIRE (RVIE)" a={p.ventas} contraparte="Clientes" />
                    <Detalle titulo="Compras — Detalle SIRE (RCE)" a={p.compras} contraparte="Proveedores" />
                  </div>

                  <p className="text-[11px] leading-relaxed text-slate-500">
                    Estimación para planificar el pago del mes. No incluye prorrata del crédito fiscal, ajustes, comprobantes fuera del SIRE,
                    IGV de importaciones no anotado ni otros tributos (ESSALUD, ONP, 4ta/5ta). Verifica con la propuesta antes de declarar.
                  </p>
                </section>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

function Fuente({ titulo, donde, ok, href, cta }: { titulo: string; donde: string; ok: string | null; href: string; cta: string }) {
  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3">
      <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm font-bold ${ok ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{ok ? "✓" : "!"}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-slate-800">{titulo}</p>
        <p className="text-xs text-slate-500">{ok ?? `Falta generarlo en: ${donde}`}</p>
      </div>
      <Link href={href} target="_blank" className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${ok ? "border-slate-200 text-slate-500 hover:border-brand-300 hover:text-brand-700" : "border-brand-500 bg-brand-50 text-brand-700 hover:bg-brand-100"}`}>
        {ok ? "Volver a generar" : cta} →
      </Link>
    </div>
  );
}

function Campo({ l, ayuda, v, on, ph = "0.00" }: { l: string; ayuda?: string; v: string; on: (e: React.ChangeEvent<HTMLInputElement>) => void; ph?: string }) {
  return (
    <div>
      <label className="label">{l}</label>
      <input className="input" inputMode="decimal" placeholder={ph} value={v} onChange={on} />
      {ayuda && <p className="mt-1 text-[11px] text-slate-500">{ayuda}</p>}
    </div>
  );
}

function Kpi({ titulo, valor, sub, tono }: { titulo: string; valor: string; sub?: string; tono?: "rojo" | "verde" | "ambar" }) {
  const color = tono === "rojo" ? "text-red-600" : tono === "verde" ? "text-emerald-700" : tono === "ambar" ? "text-amber-700" : "text-brand-800";
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{titulo}</p>
      <p className={`mt-1 text-xl font-bold ${color}`}>{valor}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

function Tabla({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200">
      <p className="bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600">{titulo}</p>
      <table className="w-full text-sm"><tbody>{children}</tbody></table>
    </div>
  );
}

function Fila({ l, v, fuerte, total, verde }: { l: string; v: number; fuerte?: boolean; total?: boolean; verde?: boolean }) {
  const cls = total ? "bg-brand-50 font-bold text-brand-900" : fuerte ? "font-semibold text-slate-800" : verde ? "text-emerald-700" : "text-slate-600";
  return (
    <tr className={`border-t border-slate-100 ${cls}`}>
      <td className="px-3 py-1.5">{l}</td>
      <td className={`whitespace-nowrap px-3 py-1.5 text-right tabular-nums ${v < 0 ? "text-slate-500" : ""}`}>{soles(v)}</td>
    </tr>
  );
}

function Grupos({ titulo, col, filas }: { titulo: string; col: string; filas: GrupoDetalle[] }) {
  if (!filas.length) return null;
  return (
    <div>
      <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{titulo}</p>
      <table className="w-full text-xs">
        <thead className="text-[10px] uppercase text-slate-400"><tr><th className="px-3 py-1 text-left">{col}</th><th className="px-2 py-1 text-right">N.º</th><th className="px-2 py-1 text-right">IGV</th><th className="px-2 py-1 text-right">Total</th><th className="px-3 py-1 text-right">%</th></tr></thead>
        <tbody>{filas.map((g, i) => (
          <tr key={i} className="border-t border-slate-100 text-slate-600">
            <td className="px-3 py-1"><span className="line-clamp-1">{g.nombre || "—"}</span>{g.ruc && <span className="text-[10px] text-slate-400">{g.ruc}</span>}</td>
            <td className="px-2 py-1 text-right tabular-nums">{g.comprobantes}</td>
            <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums">{soles(g.igv)}</td>
            <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums">{soles(g.total)}</td>
            <td className="px-3 py-1 text-right tabular-nums">{g.pct.toFixed(1)}%</td>
          </tr>))}</tbody>
      </table>
    </div>
  );
}

function Detalle({ titulo, a, contraparte }: { titulo: string; a: AnalisisDetalle | null; contraparte: string }) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200">
      <p className="bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600">{titulo}</p>
      {!a ? <p className="px-3 py-3 text-sm text-slate-500">No se ha generado este detalle para el periodo.</p>
        : !a.comprobantes ? <p className="px-3 py-3 text-sm text-slate-500">Sin comprobantes en el periodo.</p> : (
          <>
            <p className="px-3 pt-2 text-xs text-slate-600">
              {a.comprobantes} comprobante(s) · {a.contrapartes} {contraparte.toLowerCase()} · total <b>{soles(a.total)}</b>
              {a.notasCredito.comprobantes > 0 && <> · {a.notasCredito.comprobantes} NC por {soles(a.notasCredito.total)}</>}
              {a.monedaExtranjera > 0 && <> · {a.monedaExtranjera} en moneda extranjera (a soles)</>}
            </p>
            <Grupos titulo="Por tipo de comprobante" col="Tipo" filas={a.porTipo} />
            <Grupos titulo={`Principales ${contraparte.toLowerCase()}`} col={contraparte} filas={a.top} />
          </>
        )}
    </div>
  );
}
