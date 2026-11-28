"use client";

import { useMemo, useState } from "react";
import type { ResumenConciliacion, FilaUnica, FilaFecha, FilaBanco } from "@/lib/conciliacionCaja";
import type { ResultadoOperaciones } from "@/lib/cajaOperaciones";
import { analizarZipCaja } from "@/lib/cajaZipCliente";

const soles = (n: unknown) => "S/ " + (Number(n) || 0).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fch = (iso: string) => (iso ? iso.split("-").reverse().join("/") : "");
type Vista = "conciliacion" | "bancos" | "fecha";
interface Respuesta { resumen: ResumenConciliacion; unificada: FilaUnica[]; bancos?: FilaBanco[]; porFecha: FilaFecha[]; avisos: string[]; excelBase64?: string }
const TOPE = 400; // filas en pantalla (el Excel trae todas)

// Conciliación bancaria de 3 vías: Contabilidad (Registro de Ventas y/o Libro Diario) ↔ Caja virtual
// (cobranzas) ↔ Bancos. Vincula cada comprobante con su cobro (punto en común: el comprobante) y el
// cobro con su depósito o abono (punto en común: el N° de operación); lo que no se logra vincular sale
// como "No conciliado". La caja virtual entra como los ZIP por sede del utilitario "Caja virtual ·
// reportes por sede" (se analizan antes, por tandas) o como el Excel de tramas; los bancos, en Excel,
// PDF o Word.
export default function ConciliacionPanel() {
  const [fCont, setFCont] = useState<File[]>([]);
  const [fCaja, setFCaja] = useState<File[]>([]);
  const [sedes, setSedes] = useState<ResultadoOperaciones[]>([]);
  const [paso, setPaso] = useState("");
  const [fBancos, setFBancos] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [res, setRes] = useState<Respuesta | null>(null);
  const [vista, setVista] = useState<Vista>("conciliacion");
  const [soloNo, setSoloNo] = useState(false);
  const [buscar, setBuscar] = useState("");
  const [cuenta, setCuenta] = useState("");

  async function conciliar() {
    if (!fCont.length && !fCaja.length && !fBancos.length) return setError("Adjunta la contabilidad, la caja virtual y los bancos.");
    setBusy(true); setError(null); setRes(null); setSedes([]);
    try {
      // 1) Los ZIP de la caja virtual (uno por sede): se leen el reporte de cada día y los vouchers.
      const zips = fCaja.filter((f) => /\.zip$/i.test(f.name));
      const analizadas: ResultadoOperaciones[] = [];
      for (const [i, f] of zips.entries()) {
        setPaso(`Caja virtual, sede ${i + 1} de ${zips.length}: ${f.name}…`);
        try { analizadas.push(await analizarZipCaja(f, (t) => setPaso(`Caja virtual, sede ${i + 1} de ${zips.length} · ${t}`))); }
        catch (e) { setError(e instanceof Error ? e.message : `${f.name}: no se pudo analizar.`); return; }
      }
      setSedes(analizadas);
      // 2) La conciliación.
      setPaso("Conciliando contabilidad, caja virtual y bancos…");
      const fd = new FormData();
      for (const f of fCont) fd.append("contabilidad", f);
      for (const f of fCaja.filter((x) => !/\.zip$/i.test(x.name))) fd.append("caja", f);
      if (analizadas.length) fd.append("cajaZip", JSON.stringify(analizadas.map((s) => ({ ...s, otros: [] }))));
      for (const f of fBancos) fd.append("bancos", f);
      const r = await fetch("/api/conciliacion", { method: "POST", body: fd });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) { setError(data.error ?? "No se pudo conciliar."); return; }
      setRes(data); setVista("conciliacion"); setSoloNo(false); setBuscar(""); setCuenta("");
    } catch { setError("Error de red (¿archivo muy pesado?)."); }
    finally { setBusy(false); setPaso(""); }
  }

  function descargar() {
    if (!res?.excelBase64) return;
    const bin = atob(res.excelBase64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    const a = document.createElement("a");
    a.href = url; a.download = `conciliacion-${(res.resumen.empresa || "bancaria").replace(/[^\w]+/g, "-").slice(0, 40)}.xlsx`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  const s = res?.resumen;
  const q = buscar.trim().toUpperCase();
  const pasa = (f: object) => !q || Object.values(f).some((v) => String(v ?? "").toUpperCase().includes(q));
  const filas = useMemo(() => (res?.unificada ?? []).filter((f) => (!soloNo || f.estado === "No conciliado") && pasa(f)), [res, q, soloNo]); // eslint-disable-line react-hooks/exhaustive-deps
  const cuentas = (s?.bancos ?? []).map((b) => b.banco);
  const cuentaSel = cuentas.includes(cuenta) ? cuenta : cuentas[0] ?? "";
  const filasBanco = useMemo(() => (res?.bancos ?? []).filter((f) => f.banco === cuentaSel && (!soloNo || f.estado === "No conciliado") && pasa(f)), [res, q, soloNo, cuentaSel]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4">
      <div className="card p-5">
        <div className="grid gap-4 md:grid-cols-3">
          <Uploader titulo="1 · Contabilidad" detalle="Registro de Ventas del mes y/o Libro Diario de ventas (Excel de StarSoft). Puedes subir los dos." multiple file={fCont} onPick={setFCont} />
          <Uploader titulo="2 · Caja virtual" detalle="Los ZIP por sede que descarga «Caja virtual · reportes por sede» (todas las sedes a la vez: traen el N° de operación y el voucher del depósito). También sirve el Excel de tramas de cobranza." multiple acepta=".zip,.xlsx" tipos=".zip o .xlsx" file={fCaja} onPick={setFCaja} />
          <Uploader titulo="3 · Bancos" detalle="Extractos de cada cuenta en Excel, PDF (el original del banco) o Word (.docx). Puedes subir varios." multiple acepta=".xlsx,.pdf,.docx" tipos=".xlsx, .pdf o .docx" file={fBancos} onPick={setFBancos} />
        </div>
        <p className="mt-3 text-xs text-slate-500">
          <b>Tres fases:</b> contabilidad ↔ caja virtual por el <b>comprobante</b>, y caja virtual ↔ bancos por el <b>N° de operación</b> (en el efectivo, el del voucher del depósito). Si las tres coinciden, el comprobante queda conciliado.
          Cada pestaña de Excel se reconoce por su contenido: si tienes todo en un solo Excel, súbelo en cualquiera de las tres casillas.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button className="btn-primary" onClick={conciliar} disabled={busy}>{busy ? "Conciliando…" : "⚖️ Conciliar"}</button>
          {res?.excelBase64 && <button className="btn-accent" onClick={descargar}>⬇ Descargar Excel conciliado</button>}
        </div>
        {busy && paso && <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">⏳ {paso}{/vouchers|sede/.test(paso) ? " Se leen los vouchers escaneados: cerca de un minuto por sede." : ""}</div>}
        {sedes.length > 0 && (
          <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full whitespace-nowrap text-xs">
              <thead><tr className="bg-slate-50 text-left uppercase text-slate-500"><th className="px-3 py-1.5">Caja virtual · sede</th><th className="px-2 py-1.5 text-right">Días</th><th className="px-2 py-1.5 text-right">Comprobantes</th><th className="px-2 py-1.5 text-right">Cobrado</th><th className="px-2 py-1.5 text-right">Efectivo: días con voucher</th><th className="px-2 py-1.5 text-right">Con diferencia</th><th className="px-3 py-1.5 text-right">Sin voucher</th></tr></thead>
              <tbody>{sedes.map((x) => {
                const ef = x.operaciones.filter((o) => o.medio.startsWith("EFECTIVO")); const n = (e: string) => ef.filter((o) => o.estado === e).length;
                return (
                  <tr key={x.sede} className="border-t border-slate-100"><td className="px-3 py-1.5 font-semibold text-slate-700">{x.sede}</td><td className="px-2 py-1.5 text-right tabular-nums">{x.dias}</td><td className="px-2 py-1.5 text-right tabular-nums">{x.comprobantes}</td><td className="px-2 py-1.5 text-right tabular-nums">{soles(x.total)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-emerald-700">{n("Cuadra") + n("Diferencia")} de {ef.length}</td>
                    <td className={`px-2 py-1.5 text-right tabular-nums ${n("Diferencia") ? "font-semibold text-red-600" : "text-slate-400"}`}>{n("Diferencia")}</td>
                    <td className={`px-3 py-1.5 text-right tabular-nums ${n("Sin voucher") ? "font-semibold text-amber-700" : "text-slate-400"}`}>{n("Sin voucher")}</td></tr>
                );
              })}</tbody>
            </table>
          </div>
        )}
        {error && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
      </div>

      {res && s && (
        <>
          <div className="card p-5">
            <p className="text-sm font-semibold text-slate-800">{s.empresa} <span className="font-normal text-slate-500">· RUC {s.ruc} · {s.periodo}</span></p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Kpi t="Comprobantes conciliados" v={`${s.ventas.conciliados} de ${s.ventas.total}`} sub={soles(s.ventas.importeConciliado)} tono="verde" />
              <Kpi t="Comprobantes NO conciliados" v={String(s.ventas.noConciliados)} sub={`${soles(s.ventas.importeNoConciliado)}${s.ventas.conTicket ? ` · ${s.ventas.conTicket} con ticket verificado` : ""}`} tono={s.ventas.noConciliados ? "rojo" : "verde"} />
              <Kpi t="Cobros de caja sin banco" v={`${s.cobros.noConciliados} de ${s.cobros.total}`} sub={soles(s.cobros.importeNoConciliado)} tono={s.cobros.noConciliados ? "rojo" : "verde"} />
              <Kpi t="Abonos del banco sin cobro" v={String(s.bancos.reduce((a, b) => a + b.noConciliados, 0))} sub={soles(s.bancos.reduce((a, b) => a + b.importeNoConciliado, 0))} tono={s.bancos.some((b) => b.noConciliados) ? "ambar" : "verde"} />
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div className="rounded-lg border border-slate-200">
                <p className="bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600">Por qué no concilian los comprobantes</p>
                <table className="w-full text-sm"><tbody>
                  {Object.entries(s.ventas.porMotivo).map(([k, v]) => (
                    <tr key={k} className="border-t border-slate-100"><td className="px-3 py-1.5 text-slate-700">{k}</td><td className="px-3 py-1.5 text-right tabular-nums">{v.n}</td><td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-slate-600">{soles(v.importe)}</td></tr>
                  ))}
                  {!Object.keys(s.ventas.porMotivo).length && <tr><td className="px-3 py-2 text-emerald-700">Todos los comprobantes concilian.</td></tr>}
                </tbody></table>
              </div>
              <div className="rounded-lg border border-slate-200">
                <p className="bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600">Bancos</p>
                <table className="w-full text-sm">
                  <thead className="text-[11px] uppercase text-slate-400"><tr><th className="px-3 py-1 text-left">Cuenta</th><th className="px-2 py-1 text-right">Abonos</th><th className="px-2 py-1 text-right">Conciliados</th><th className="px-2 py-1 text-right">No conciliados</th><th className="px-3 py-1 text-right">Cargos</th></tr></thead>
                  <tbody>{s.bancos.map((b) => (
                    <tr key={b.banco} className="border-t border-slate-100"><td className="px-3 py-1.5 font-medium text-slate-700">{b.banco}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{b.abonos}<div className="text-[11px] text-slate-400">{soles(b.importeAbonos)}</div></td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-emerald-700">{b.conciliados}<div className="text-[11px] text-slate-400">{soles(b.importeConciliado)}</div></td>
                      <td className={`px-2 py-1.5 text-right tabular-nums ${b.noConciliados ? "text-red-600" : "text-slate-500"}`}>{b.noConciliados}<div className="text-[11px] text-slate-400">{soles(b.importeNoConciliado)}</div></td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">{b.cargos}<div className="text-[11px] text-slate-400">{soles(b.importeCargos)}</div></td></tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
            <p className="mt-3 text-xs text-slate-500">
              Cómo se vinculó cada cobro con el banco: {Object.entries(s.cobros.porCriterio).map(([k, n]) => `${k} (${n})`).join(" · ") || "—"}.
            </p>
            {res.avisos.map((a, i) => <p key={i} className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{a}</p>)}
          </div>

          <div className="card p-5">
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex flex-wrap rounded-lg border border-slate-200 bg-white p-1">
                {([["conciliacion", "Conciliación"], ["bancos", "Extracto conciliado"], ["fecha", "Por fecha"]] as [Vista, string][]).map(([k, t]) => (
                  <button key={k} onClick={() => setVista(k)} className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${vista === k ? "bg-brand-600 text-white" : "text-slate-500 hover:text-brand-700"}`}>{t}</button>
                ))}
              </div>
              {vista === "bancos" && cuentas.length > 1 && (
                <select className="input max-w-[14rem]" value={cuentaSel} onChange={(e) => setCuenta(e.target.value)}>
                  {cuentas.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              )}
              {vista !== "fecha" && (
                <>
                  <label className="flex items-center gap-2 text-sm text-slate-600">
                    <input type="checkbox" checked={soloNo} onChange={(e) => setSoloNo(e.target.checked)} /> Solo lo no conciliado
                  </label>
                  <input className="input ml-auto max-w-xs" placeholder={vista === "bancos" ? "Buscar descripción, comprobante, monto…" : "Buscar comprobante, cliente, monto…"} value={buscar} onChange={(e) => setBuscar(e.target.value)} />
                </>
              )}
            </div>
            {vista === "conciliacion" && <TablaUnica filas={filas} />}
            {vista === "bancos" && <TablaBanco filas={filasBanco} cuenta={cuentaSel} />}
            {vista === "fecha" && <TablaFechas filas={res.porFecha ?? []} />}
          </div>
        </>
      )}
    </div>
  );
}

function Uploader({ titulo, detalle, file, onPick, multiple, acepta = ".xlsx", tipos = ".xlsx" }: { titulo: string; detalle: string; file: File[]; onPick: (f: File[]) => void; multiple?: boolean; acepta?: string; tipos?: string }) {
  return (
    <label className="block cursor-pointer rounded-xl border-2 border-dashed border-slate-300 p-4 transition hover:border-brand-400 hover:bg-brand-50/30">
      <p className="text-sm font-semibold text-slate-800">{titulo}</p>
      <p className="mt-0.5 text-xs text-slate-500">{detalle}</p>
      <input type="file" accept={acepta} multiple={multiple} className="hidden" onChange={(e) => onPick(Array.from(e.target.files ?? []))} />
      <p className={`mt-3 truncate text-xs ${file.length ? "font-medium text-emerald-700" : "text-brand-600"}`}>
        {file.length ? `✓ ${file.length > 3 ? `${file.length} archivos: ` : ""}${file.map((f) => f.name).join(", ")}` : `Elegir archivo${multiple ? "(s)" : ""} ${tipos}`}
      </p>
    </label>
  );
}

function Kpi({ t, v, sub, tono }: { t: string; v: string; sub: string; tono: "verde" | "rojo" | "ambar" }) {
  const c = tono === "rojo" ? "text-red-600" : tono === "ambar" ? "text-amber-700" : "text-emerald-700";
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t}</p>
      <p className={`mt-1 text-xl font-bold ${c}`}>{v}</p>
      <p className="text-xs text-slate-500">{sub}</p>
    </div>
  );
}

const Est = ({ e }: { e: string }) => (
  <span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-bold ${e === "Conciliado" ? "bg-emerald-100 text-emerald-700" : e === "No conciliado" ? "bg-red-100 text-red-700" : e === "Con ticket" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-500"}`}>{e}</span>
);
const Mas = ({ n, cols }: { n: number; cols: number }) => (n > TOPE ? <tr><td colSpan={cols} className="px-2 py-2 text-slate-400">… y {n - TOPE} filas más (están todas en el Excel)</td></tr> : null);
const Vacio = ({ cols }: { cols: number }) => <tr><td colSpan={cols} className="px-2 py-3 text-slate-500">Sin filas.</td></tr>;
const th = "whitespace-nowrap px-2 py-1.5 text-left", td = "px-2 py-1 text-slate-600", tdr = "whitespace-nowrap px-2 py-1 text-right tabular-nums text-slate-700";

// HOJA ÚNICA: la misma fila vista en Contabilidad, en la Caja virtual y en el Banco. Las columnas
// en dorado son el PUNTO EN COMÚN con que se concilia cada salto.
function TablaUnica({ filas }: { filas: FilaUnica[] }) {
  const g = "border-l-2 border-slate-300"; // separador de bloque
  const oro = "bg-amber-100 text-amber-900"; // encabezado de punto en común
  const pc = "bg-amber-50/70 font-medium text-slate-800"; // celda de punto en común
  const m = (n: number | null) => (n == null ? "" : soles(n));
  return (
    <div className="mt-3 max-h-[36rem] overflow-auto rounded-lg border border-slate-200">
      <table className="w-full text-[11px]">
        <thead className="sticky top-0 z-10">
          <tr className="text-[11px] font-bold uppercase tracking-wide text-white">
            <th colSpan={4} className="bg-brand-700 px-2 py-1.5 text-left">Contabilidad</th>
            <th colSpan={6} className={`bg-sky-800 px-2 py-1.5 text-left ${g}`}>Caja virtual</th>
            <th colSpan={4} className={`bg-teal-700 px-2 py-1.5 text-left ${g}`}>Bancos</th>
            <th colSpan={3} className={`bg-slate-600 px-2 py-1.5 text-left ${g}`}>Resultado</th>
          </tr>
          <tr className="bg-slate-50 text-[10px] uppercase text-slate-500">
            <th className={th}>Fecha</th><th className={`${th} ${oro}`}>Comprobante ★</th><th className={th}>Cliente</th><th className={`${th} text-right`}>Total</th>
            <th className={`${th} ${oro} ${g}`}>Comprobante ★</th><th className={th}>Cobro · medio</th><th className={`${th} ${oro}`}>Fecha ◆</th><th className={`${th} text-right`}>Cobrado</th><th className={`${th} ${oro} text-right`}>Total del cobro ◆</th><th className={th}>Ticket / voucher</th>
            <th className={`${th} ${g}`}>Cuenta</th><th className={`${th} ${oro}`}>Fecha ◆</th><th className={th}>Concepto</th><th className={`${th} ${oro} text-right`}>Importe ◆</th>
            <th className={`${th} ${g}`}>Estado</th><th className={th}>Punto en común caja ↔ banco</th><th className={th}>Observación</th>
          </tr>
        </thead>
        <tbody>
          {filas.slice(0, TOPE).map((f, i) => (
            <tr key={i} className={`border-t border-slate-100 ${f.estado === "No conciliado" ? "bg-red-50/50" : f.estado === "Con ticket" ? "bg-amber-50/60" : f.estado === "Cargo" ? "bg-slate-50 text-slate-400" : ""}`}>
              <td className={`${td} whitespace-nowrap`}>{fch(f.cFecha)}</td><td className={`${td} whitespace-nowrap ${f.cDoc ? pc : ""}`}>{f.cDoc}</td>
              <td className={td}><span className="line-clamp-1">{f.cCliente}</span></td><td className={tdr}>{m(f.cTotal)}</td>
              <td className={`${td} whitespace-nowrap ${g} ${f.vDoc ? pc : ""}`}>{f.vDoc}</td><td className={`${td} whitespace-nowrap`}>{[f.vCobro, f.vMedio].filter(Boolean).join(" · ")}</td>
              <td className={`${td} whitespace-nowrap ${f.vFecha ? pc : ""}`}>{fch(f.vFecha)}</td><td className={tdr}>{m(f.vImporte)}</td><td className={`${tdr} ${f.vTotalCobro != null ? pc : ""}`}>{m(f.vTotalCobro)}</td><td className={`${td} whitespace-nowrap ${f.vTicket?.startsWith("✔") ? "text-emerald-700" : "text-slate-400"}`}>{f.vTicket}</td>
              <td className={`${td} whitespace-nowrap ${g}`}>{f.bBanco}</td><td className={`${td} whitespace-nowrap ${f.bFecha ? pc : ""}`}>{fch(f.bFecha)}</td>
              <td className={td}><span className="line-clamp-1">{f.bDesc}</span></td><td className={`${tdr} ${f.bImporte != null ? pc : ""}`}>{m(f.bImporte)}</td>
              <td className={`${td} ${g}`}><Est e={f.estado} /></td><td className={td}>{f.punto2}</td><td className={td}>{f.obs}</td>
            </tr>
          ))}
          {!filas.length && <Vacio cols={17} />}<Mas n={filas.length} cols={17} />
        </tbody>
      </table>
      <p className="border-t border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] text-slate-500">
        <b>★</b> punto en común contabilidad ↔ caja: el <b>comprobante</b> (serie y número). &nbsp; <b>◆</b> punto en común caja ↔ banco: el <b>total del cobro</b> y la <b>fecha</b> (o el N° de operación cuando el banco lo trae).
      </p>
    </div>
  );
}

// EXTRACTO CONCILIADO: los movimientos de una cuenta, en el orden del banco, con la columna
// CONCILIACIÓN (la glosa del cobro de la caja) como la arma contabilidad a mano.
function TablaBanco({ filas, cuenta }: { filas: FilaBanco[]; cuenta: string }) {
  return (
    <div className="mt-3 max-h-[36rem] overflow-auto rounded-lg border border-slate-200">
      <table className="w-full text-[11px]">
        <thead className="sticky top-0 z-10 bg-slate-50 text-[10px] uppercase text-slate-500"><tr>
          <th className={th}>Fecha</th><th className={th}>Descripción ({cuenta})</th><th className={th}>N° oper.</th><th className={`${th} text-right`}>Importe</th>
          <th className={`${th} bg-teal-700 text-white`}>Conciliación</th><th className={th}>Comprobantes que cancela</th><th className={th}>Estado</th><th className={th}>Observación</th>
        </tr></thead>
        <tbody>
          {filas.slice(0, TOPE).map((f, i) => (
            <tr key={i} className={`border-t border-slate-100 ${f.estado === "No conciliado" ? "bg-red-50/50" : f.estado === "Cargo" ? "bg-slate-50" : ""}`}>
              <td className={`${td} whitespace-nowrap`}>{fch(f.fecha)}</td><td className={`${td} whitespace-nowrap`}>{f.desc}</td><td className={`${td} whitespace-nowrap`}>{f.op}</td>
              <td className={`${tdr} ${f.cargo > 0 && !f.abono ? "text-slate-500" : ""}`}>{soles(f.abono > 0 ? f.abono : -f.cargo)}</td>
              <td className={`${td} whitespace-nowrap font-semibold text-slate-800`}>{f.conciliacion}</td><td className={td}><span className="line-clamp-2">{f.estado === "Conciliado" ? f.detalle : ""}</span></td>
              <td className={td}><Est e={f.estado} /></td><td className={`${td} min-w-[18rem]`}>{f.obs}</td>
            </tr>
          ))}
          {!filas.length && <Vacio cols={8} />}<Mas n={filas.length} cols={8} />
        </tbody>
      </table>
      <p className="border-t border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] text-slate-500">
        La columna <b>Conciliación</b> es la glosa del cobro de la caja virtual que corresponde a cada abono. Los cargos solo traen texto cuando es evidente (ITF, comisiones, haberes): el resto lo completa contabilidad.
      </p>
    </div>
  );
}

// Cuadro por día: lo vendido (contabilidad) debe ser igual a lo cobrado (caja virtual); y de lo
// cobrado cada día, cuánto ya llegó al banco y en qué fechas.
function TablaFechas({ filas }: { filas: FilaFecha[] }) {
  const t = (k: keyof FilaFecha) => filas.reduce((a, f) => a + (Number(f[k]) || 0), 0);
  const m = (n: number) => (n ? soles(n) : "");
  return (
    <div className="mt-3 max-h-[32rem] overflow-auto rounded-lg border border-slate-200">
      <table className="w-full text-[11px]">
        <thead className="sticky top-0 bg-slate-50 text-[10px] uppercase text-slate-400"><tr>
          <th className={th}>Fecha</th><th className={`${th} text-right`}>Ventas (contab.)</th><th className={`${th} text-right`}>N. crédito</th>
          <th className={`${th} text-right`}>Caja efectivo</th><th className={`${th} text-right`}>Caja transf.</th><th className={`${th} text-right`}>Caja total</th><th className={`${th} text-right`}>Dif. ventas − caja</th>
          <th className={`${th} text-right`}>Ya en banco</th><th className={`${th} text-right`}>Sin banco</th><th className={th}>El banco lo recibió</th><th className={`${th} text-right`}>Entró al banco ese día</th><th className={th}>Estado</th><th className={th}>Observación</th>
        </tr></thead>
        <tbody>
          {filas.map((f) => (
            <tr key={f.fecha} className={`border-t border-slate-100 ${f.estado === "No conciliado" && (f.cajaTotal || f.ventas) ? "bg-red-50/40" : ""}`}>
              <td className={`${td} whitespace-nowrap font-medium text-slate-800`}>{fch(f.fecha)}</td><td className={tdr}>{m(f.ventas)}</td><td className={tdr}>{m(f.notasCredito)}</td>
              <td className={tdr}>{m(f.cajaEfectivo)}</td><td className={tdr}>{m(f.cajaTransferencias)}</td><td className={`${tdr} font-semibold`}>{m(f.cajaTotal)}</td>
              <td className={`${tdr} ${Math.abs(f.difVentasCaja) >= 0.01 ? "font-semibold text-red-600" : "text-slate-400"}`}>{Math.abs(f.difVentasCaja) >= 0.01 ? soles(f.difVentasCaja) : "—"}</td>
              <td className={`${tdr} text-emerald-700`}>{m(f.depositado)}</td><td className={`${tdr} ${f.sinDepositar ? "font-semibold text-red-600" : ""}`}>{m(f.sinDepositar)}</td>
              <td className={`${td} whitespace-nowrap`}>{f.depositoDesde ? (f.depositoDesde === f.depositoHasta ? fch(f.depositoDesde) : `${fch(f.depositoDesde)} al ${fch(f.depositoHasta)}`) : ""}</td>
              <td className={tdr}>{m(f.abonosBanco)}</td><td className={td}>{f.cajaTotal || f.ventas ? <Est e={f.estado} /> : null}</td><td className={td}>{f.nota}</td>
            </tr>
          ))}
          {!filas.length && <Vacio cols={13} />}
          {filas.length > 0 && (
            <tr className="border-t-2 border-slate-300 bg-slate-50 font-bold text-slate-800">
              <td className="px-2 py-1.5">TOTAL</td><td className={tdr}>{soles(t("ventas"))}</td><td className={tdr}>{soles(t("notasCredito"))}</td><td className={tdr}>{soles(t("cajaEfectivo"))}</td><td className={tdr}>{soles(t("cajaTransferencias"))}</td>
              <td className={tdr}>{soles(t("cajaTotal"))}</td><td className={tdr}>{soles(t("difVentasCaja"))}</td><td className={tdr}>{soles(t("depositado"))}</td><td className={tdr}>{soles(t("sinDepositar"))}</td><td /><td className={tdr}>{soles(t("abonosBanco"))}</td><td /><td />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
