"use client";

import { useEffect, useMemo, useState } from "react";
import type { SireResumen, PlaneamientoEntradas, SunatInfo } from "@/lib/types";
import {
  calcularPlaneamiento, regimenSugerido, ENTRADAS_VACIAS, REGIMEN_LABEL, type EntradasPlan, type Regimen,
} from "@/lib/planeamiento";
import { analisisCierre } from "@/lib/cronogramaSunat";

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Setiembre", "Octubre", "Noviembre", "Diciembre"];
const etiqueta = (p: string) => `${MESES[Number(p.slice(4, 6)) - 1] ?? "?"} ${p.slice(0, 4)}`;
const soles = (n: number) => `S/ ${Number(n || 0).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const hoyLima = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const fechaCorta = (iso: string) => { const [y, m, d] = iso.split("-"); return `${d}/${m}/${y}`; };
const anterior = (p: string) => { const y = Number(p.slice(0, 4)), m = Number(p.slice(4, 6)); return m === 1 ? `${y - 1}12` : `${y}${String(m - 1).padStart(2, "0")}`; };

type Campos = { regimen: Regimen; coeficiente: string; saldoFavorIgv: string; percepciones: string; retenciones: string; saldoFavorRenta: string };
const aCampos = (e: EntradasPlan): Campos => ({
  regimen: e.regimen, coeficiente: e.coeficiente ? String(e.coeficiente) : "",
  saldoFavorIgv: e.saldoFavorIgv ? String(e.saldoFavorIgv) : "", percepciones: e.percepciones ? String(e.percepciones) : "",
  retenciones: e.retenciones ? String(e.retenciones) : "", saldoFavorRenta: e.saldoFavorRenta ? String(e.saldoFavorRenta) : "",
});
const n = (s: string) => { const v = Number(String(s).replace(/,/g, "")); return Number.isFinite(v) && v > 0 ? v : 0; };
const aEntradas = (c: Campos): EntradasPlan => ({
  regimen: c.regimen, coeficiente: n(c.coeficiente) > 0 && n(c.coeficiente) < 100 ? n(c.coeficiente) : null,
  saldoFavorIgv: n(c.saldoFavorIgv), percepciones: n(c.percepciones), retenciones: n(c.retenciones), saldoFavorRenta: n(c.saldoFavorRenta),
});

// Planeamiento tributario del mes: estima IGV + pago a cuenta de renta con el
// SIRE de ventas y compras ya extraído (sección 6), más los datos manuales de
// la DJ anterior (saldo a favor, percepciones, retenciones).
export default function PlaneamientoPanel({
  clienteId, ruc, negocio, sunat, sire, inicial,
}: {
  clienteId: string; ruc: string; negocio?: "con" | "sin"; sunat: SunatInfo | null;
  sire: SireResumen[]; inicial?: Record<string, PlaneamientoEntradas>;
}) {
  const hoy = hoyLima();
  const periodos = useMemo(() => [...sire].map((s) => s.periodo).sort((a, b) => b.localeCompare(a)), [sire]);
  const sugerido = regimenSugerido(sunat?.tributos, ruc, negocio);
  const porDeclarar = anterior(hoy.slice(0, 7).replace("-", ""));
  const [periodo, setPeriodo] = useState<string>(() => (periodos.includes(porDeclarar) ? porDeclarar : periodos[0] ?? ""));
  const [guardados, setGuardados] = useState<Record<string, PlaneamientoEntradas>>(inicial ?? {});
  const [campos, setCampos] = useState<Campos>(aCampos(ENTRADAS_VACIAS(sugerido)));
  const [arrastre, setArrastre] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);

  // Si el SIRE cambia (nueva extracción) y el periodo elegido no existe, toma uno válido.
  useEffect(() => {
    if (!periodo || !periodos.includes(periodo)) setPeriodo(periodos.includes(porDeclarar) ? porDeclarar : periodos[0] ?? "");
  }, [periodos, periodo, porDeclarar]);

  // Al cambiar de periodo: datos guardados de ese mes; si no hay, el saldo a
  // favor que dejó el mes anterior (si se planificó) como sugerencia editable.
  useEffect(() => {
    setMsg(null); setArrastre(null);
    if (!periodo) return;
    const g = guardados[periodo];
    if (g) { setCampos(aCampos({ ...ENTRADAS_VACIAS(sugerido), ...g })); return; }
    const base = ENTRADAS_VACIAS(guardados[anterior(periodo)]?.regimen ?? sugerido);
    const sAnt = sire.find((s) => s.periodo === anterior(periodo));
    const gAnt = guardados[anterior(periodo)];
    if (sAnt && gAnt) {
      const rAnt = calcularPlaneamiento(sAnt, { ...ENTRADAS_VACIAS(sugerido), ...gAnt }, sire);
      if (rAnt.saldoFavorSiguiente > 0) { base.saldoFavorIgv = rAnt.saldoFavorSiguiente; setArrastre(etiqueta(anterior(periodo))); }
      if (rAnt.saldoPercepcionesSiguiente > 0) base.percepciones = rAnt.saldoPercepcionesSiguiente;
      base.coeficiente = gAnt.coeficiente ?? null;
    }
    setCampos(aCampos(base));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodo]);

  const s = sire.find((x) => x.periodo === periodo);
  const r = s ? calcularPlaneamiento(s, aEntradas(campos), sire) : null;
  const cierre = periodo ? analisisCierre(ruc, periodo, hoy) : null;
  const sinCambios = (() => {
    const g = guardados[periodo];
    if (!g) return false;
    const a = aEntradas(campos);
    return g.regimen === a.regimen && (g.coeficiente ?? null) === (a.coeficiente ?? null) && g.saldoFavorIgv === a.saldoFavorIgv
      && g.percepciones === a.percepciones && g.retenciones === a.retenciones && g.saldoFavorRenta === a.saldoFavorRenta;
  })();

  async function guardar() {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(`/api/clientes/${clienteId}/planeamiento`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ periodo, ...aEntradas(campos) }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "No se pudo guardar.");
      setGuardados(j.planeamiento ?? {}); setArrastre(null);
      setMsg({ ok: true, t: `Datos de ${etiqueta(periodo)} guardados.` });
    } catch (e) {
      setMsg({ ok: false, t: e instanceof Error ? e.message : "Error" });
    } finally { setBusy(false); }
  }

  const set = (k: keyof Campos) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setCampos((c) => ({ ...c, [k]: e.target.value }));
  const sinIgv = campos.regimen === "rus" || campos.regimen === "ninguno";

  if (!periodos.length) {
    return (
      <section className="card p-5 text-sm text-slate-600">
        Primero extrae el SIRE de compras y ventas del mes (sección 6). Con esos montos se calcula aquí cuánto se pagará de IGV y renta.
      </section>
    );
  }

  return (
    <section className="card space-y-5 p-5">
      {/* Datos del periodo */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="label">Periodo (SIRE extraído)</label>
          <select className="input" value={periodo} onChange={(e) => setPeriodo(e.target.value)}>
            {periodos.map((p) => <option key={p} value={p}>{etiqueta(p)}{guardados[p] ? " ✓" : ""}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Régimen de renta</label>
          <select className="input" value={campos.regimen} onChange={set("regimen")}>
            {(Object.keys(REGIMEN_LABEL) as Regimen[]).map((k) => <option key={k} value={k}>{REGIMEN_LABEL[k]}{k === sugerido ? " (según SUNAT)" : ""}</option>)}
          </select>
        </div>
        {(campos.regimen === "general" || campos.regimen === "mype") && (
          <div>
            <label className="label">Coeficiente renta (%) <span className="font-normal text-slate-400">opcional</span></label>
            <input className="input" inputMode="decimal" placeholder="1.5" value={campos.coeficiente} onChange={set("coeficiente")} />
          </div>
        )}
      </div>

      {/* Datos manuales de la DJ anterior */}
      {!sinIgv && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-4">
          <p className="mb-3 text-sm font-semibold text-amber-900">Datos de la DJ mensual anterior (manual)</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="label">Saldo a favor IGV mes anterior</label>
              <input className="input" inputMode="decimal" placeholder="0.00" value={campos.saldoFavorIgv} onChange={set("saldoFavorIgv")} />
              <p className="mt-1 text-[11px] text-slate-500">Casilla 145 del PDT 621{arrastre ? ` · sugerido de ${arrastre}` : ""}</p>
            </div>
            <div>
              <label className="label">Percepciones IGV</label>
              <input className="input" inputMode="decimal" placeholder="0.00" value={campos.percepciones} onChange={set("percepciones")} />
              <p className="mt-1 text-[11px] text-slate-500">Del mes + saldo no aplicado</p>
            </div>
            <div>
              <label className="label">Retenciones IGV</label>
              <input className="input" inputMode="decimal" placeholder="0.00" value={campos.retenciones} onChange={set("retenciones")} />
              <p className="mt-1 text-[11px] text-slate-500">Del mes + saldo no aplicado</p>
            </div>
            <div>
              <label className="label">Saldo a favor renta</label>
              <input className="input" inputMode="decimal" placeholder="0.00" value={campos.saldoFavorRenta} onChange={set("saldoFavorRenta")} />
              <p className="mt-1 text-[11px] text-slate-500">Aplicable a pagos a cuenta</p>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-primary" onClick={guardar} disabled={busy || !periodo || sinCambios}>
          {busy ? "Guardando…" : sinCambios ? "Datos guardados" : "Guardar datos manuales"}
        </button>
        {msg && <span className={`text-sm ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>{msg.t}</span>}
      </div>

      {r && s && (
        <>
          {/* KPIs */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi titulo="IGV a pagar" valor={soles(r.igvAPagar)} sub={r.saldoFavorSiguiente > 0 ? `Saldo a favor: ${soles(r.saldoFavorSiguiente)}` : sinIgv ? "No aplica" : "Débito − crédito − saldos"} tono={r.igvAPagar > 0 ? "rojo" : "verde"} />
            <Kpi titulo={campos.regimen === "rus" ? "Cuota Nuevo RUS" : "Renta (pago a cuenta)"} valor={soles(r.rentaAPagar)} sub={r.baseTasa || "No aplica"} />
            <Kpi titulo="Total a pagar" valor={soles(r.totalAPagar)} sub={etiqueta(periodo)} tono="azul" />
            <Kpi
              titulo="Vence la DJ"
              valor={cierre ? fechaCorta(cierre.vence) : "—"}
              sub={!cierre ? "" : cierre.estado === "vencido" ? `Vencido hace ${-cierre.diasCalendario} día(s)` : cierre.estado === "vence-hoy" ? "Vence hoy" : `Faltan ${cierre.diasHabiles} día(s) hábil(es)${cierre.oficial ? "" : " · ref."}`}
              tono={cierre && (cierre.estado === "vencido" || cierre.estado === "vence-hoy") ? "rojo" : cierre?.estado === "urgente" ? "ambar" : undefined}
            />
          </div>

          {/* Detalle tipo PDT 621 */}
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="overflow-hidden rounded-lg border border-slate-200">
              <p className="bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600">IGV — cuenta propia</p>
              <table className="w-full text-sm">
                <tbody>
                  <Fila l={`Ventas gravadas (base) · ${s.ventas.comprobantes} comprob.`} v={r.ventasBase} />
                  <Fila l="IGV de ventas (débito fiscal)" v={r.debitoFiscal} />
                  <Fila l={`Compras gravadas (base) · ${s.compras.comprobantes} comprob.`} v={r.comprasBase} />
                  <Fila l="IGV de compras (crédito fiscal)" v={-r.creditoFiscal} />
                  <Fila l="Tributo resultante" v={r.tributoResultante} fuerte />
                  <Fila l="(−) Saldo a favor mes anterior" v={-r.saldoFavorAnterior} />
                  <Fila l="Impuesto resultante" v={r.impuestoResultante} fuerte />
                  <Fila l="(−) Percepciones aplicadas" v={-r.percepcionesAplicadas} />
                  <Fila l="(−) Retenciones aplicadas" v={-r.retencionesAplicadas} />
                  <Fila l="IGV a pagar" v={r.igvAPagar} total />
                  {r.saldoFavorSiguiente > 0 && <Fila l="Saldo a favor para el mes siguiente" v={r.saldoFavorSiguiente} verde />}
                  {r.saldoPercepcionesSiguiente > 0 && <Fila l="Saldo de percepciones/retenciones por aplicar" v={r.saldoPercepcionesSiguiente} verde />}
                </tbody>
              </table>
            </div>
            <div className="overflow-hidden rounded-lg border border-slate-200">
              <p className="bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600">Renta — {REGIMEN_LABEL[campos.regimen]}</p>
              <table className="w-full text-sm">
                <tbody>
                  <Fila l="Ingresos netos del mes (gravados + exonerados/inafectos)" v={r.ingresosNetos} />
                  {campos.regimen === "mype" && <Fila l={`Ingresos acumulados del año (tope 300 UIT = ${soles(r.topeRmt)})`} v={r.ingresosAcumulados} />}
                  <tr className="border-t border-slate-100"><td className="px-3 py-1.5 text-slate-600">Tasa aplicada</td><td className="px-3 py-1.5 text-right text-slate-700">{r.baseTasa || "—"}</td></tr>
                  <Fila l={campos.regimen === "rus" ? "Cuota mensual" : "Pago a cuenta"} v={r.pagoACuenta} fuerte />
                  <Fila l="(−) Saldo a favor de renta" v={-r.saldoFavorRentaAplicado} />
                  <Fila l="Renta a pagar" v={r.rentaAPagar} total />
                </tbody>
              </table>
            </div>
          </div>

          {r.recomendaciones.length > 0 && (
            <div className="rounded-lg border border-brand-100 bg-brand-50/50 p-4">
              <p className="mb-2 text-sm font-semibold text-brand-800">Planeamiento y recomendaciones</p>
              <ul className="list-disc space-y-1.5 pl-5 text-sm text-slate-700">
                {r.recomendaciones.map((t, i) => <li key={i}>{t}</li>)}
              </ul>
            </div>
          )}
          <p className="text-[11px] leading-relaxed text-slate-500">
            Estimación con el resumen SIRE de {etiqueta(periodo)} (montos tal como los reporta SUNAT). No incluye prorrata del crédito fiscal,
            ajustes, notas fuera del SIRE, IGV de importaciones no anotado ni otros tributos (ESSALUD, ONP, 4ta/5ta). Verifica con la propuesta antes de declarar.
          </p>
        </>
      )}
    </section>
  );
}

function Kpi({ titulo, valor, sub, tono }: { titulo: string; valor: string; sub?: string; tono?: "rojo" | "verde" | "azul" | "ambar" }) {
  const color = tono === "rojo" ? "text-red-600" : tono === "verde" ? "text-emerald-700" : tono === "ambar" ? "text-amber-700" : "text-brand-800";
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{titulo}</p>
      <p className={`mt-1 text-xl font-bold ${color}`}>{valor}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

function Fila({ l, v, fuerte, total, verde }: { l: string; v: number; fuerte?: boolean; total?: boolean; verde?: boolean }) {
  const cls = total ? "bg-brand-50 font-bold text-brand-900" : fuerte ? "font-semibold text-slate-800" : verde ? "text-emerald-700" : "text-slate-600";
  return (
    <tr className={`border-t border-slate-100 ${cls}`}>
      <td className="px-3 py-1.5">{l}</td>
      <td className={`whitespace-nowrap px-3 py-1.5 text-right tabular-nums ${v < 0 ? "text-slate-500" : ""}`}>{v < 0 ? `(${soles(-v)})` : soles(v)}</td>
    </tr>
  );
}
