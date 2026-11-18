"use client";

import { useMemo, useState } from "react";
import type { ResumenConciliacion, FilaUnica, FilaFecha } from "@/lib/conciliacionCaja";

const soles = (n: unknown) => "S/ " + (Number(n) || 0).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fch = (iso: string) => (iso ? iso.split("-").reverse().join("/") : "");
type Vista = "conciliacion" | "fecha";
interface Respuesta { resumen: ResumenConciliacion; unificada: FilaUnica[]; porFecha: FilaFecha[]; avisos: string[]; excelBase64?: string }
const TOPE = 400; // filas en pantalla (el Excel trae todas)

// Conciliación bancaria de 3 vías: Contabilidad (Registro de Ventas) ↔ Caja virtual
// (cobranzas) ↔ Bancos. Vincula cada comprobante con su cobro y su depósito; lo que no
// se logra vincular sale como "No conciliado".
export default function ConciliacionPanel() {
  const [fCont, setFCont] = useState<File | null>(null);
  const [fCaja, setFCaja] = useState<File | null>(null);
  const [fBancos, setFBancos] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [res, setRes] = useState<Respuesta | null>(null);
  const [vista, setVista] = useState<Vista>("conciliacion");
  const [soloNo, setSoloNo] = useState(false);
  const [buscar, setBuscar] = useState("");

  async function conciliar() {
    if (!fCont && !fCaja && !fBancos.length) return setError("Adjunta los Excel de contabilidad, caja virtual y bancos.");
    setBusy(true); setError(null); setRes(null);
    try {
      const fd = new FormData();
      if (fCont) fd.append("contabilidad", fCont);
      if (fCaja) fd.append("caja", fCaja);
      for (const f of fBancos) fd.append("bancos", f);
      const r = await fetch("/api/conciliacion", { method: "POST", body: fd });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) { setError(data.error ?? "No se pudo conciliar."); return; }
      setRes(data); setVista("conciliacion"); setSoloNo(false); setBuscar("");
    } catch { setError("Error de red (¿archivo muy pesado?)."); }
    finally { setBusy(false); }
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

  return (
    <div className="space-y-4">
      <div className="card p-5">
        <div className="grid gap-4 md:grid-cols-3">
          <Uploader titulo="1 · Contabilidad" detalle="Registro de Ventas del mes (Excel de StarSoft)." file={fCont ? [fCont] : []} onPick={(fs) => setFCont(fs[0] ?? null)} />
          <Uploader titulo="2 · Caja virtual" detalle="Tramas de cobranza: cada cobro con los comprobantes que cancela (Excel)." file={fCaja ? [fCaja] : []} onPick={(fs) => setFCaja(fs[0] ?? null)} />
          <Uploader titulo="3 · Bancos" detalle="Extractos en Excel. Puedes subir varios archivos, o uno con una pestaña por cuenta." multiple file={fBancos} onPick={setFBancos} />
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Cada pestaña se reconoce por su contenido: si tienes todo en <b>un solo Excel</b> (contabilidad, caja y bancos en pestañas), súbelo en cualquiera de las tres casillas.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button className="btn-primary" onClick={conciliar} disabled={busy}>{busy ? "Conciliando…" : "⚖️ Conciliar"}</button>
          {res?.excelBase64 && <button className="btn-accent" onClick={descargar}>⬇ Descargar Excel conciliado</button>}
        </div>
        {error && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
      </div>

      {res && s && (
        <>
          <div className="card p-5">
            <p className="text-sm font-semibold text-slate-800">{s.empresa} <span className="font-normal text-slate-500">· RUC {s.ruc} · {s.periodo}</span></p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Kpi t="Comprobantes conciliados" v={`${s.ventas.conciliados} de ${s.ventas.total}`} sub={soles(s.ventas.importeConciliado)} tono="verde" />
              <Kpi t="Comprobantes NO conciliados" v={String(s.ventas.noConciliados)} sub={soles(s.ventas.importeNoConciliado)} tono={s.ventas.noConciliados ? "rojo" : "verde"} />
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
                {([["conciliacion", "Conciliación"], ["fecha", "Por fecha"]] as [Vista, string][]).map(([k, t]) => (
                  <button key={k} onClick={() => setVista(k)} className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${vista === k ? "bg-brand-600 text-white" : "text-slate-500 hover:text-brand-700"}`}>{t}</button>
                ))}
              </div>
              {vista === "conciliacion" && (
                <>
                  <label className="flex items-center gap-2 text-sm text-slate-600">
                    <input type="checkbox" checked={soloNo} onChange={(e) => setSoloNo(e.target.checked)} /> Solo lo no conciliado
                  </label>
                  <input className="input ml-auto max-w-xs" placeholder="Buscar comprobante, cliente, monto…" value={buscar} onChange={(e) => setBuscar(e.target.value)} />
                </>
              )}
            </div>
            {vista === "conciliacion" && <TablaUnica filas={filas} />}
            {vista === "fecha" && <TablaFechas filas={res.porFecha ?? []} />}
          </div>
        </>
      )}
    </div>
  );
}

function Uploader({ titulo, detalle, file, onPick, multiple }: { titulo: string; detalle: string; file: File[]; onPick: (f: File[]) => void; multiple?: boolean }) {
  return (
    <label className="block cursor-pointer rounded-xl border-2 border-dashed border-slate-300 p-4 transition hover:border-brand-400 hover:bg-brand-50/30">
      <p className="text-sm font-semibold text-slate-800">{titulo}</p>
      <p className="mt-0.5 text-xs text-slate-500">{detalle}</p>
      <input type="file" accept=".xlsx" multiple={multiple} className="hidden" onChange={(e) => onPick(Array.from(e.target.files ?? []))} />
      <p className={`mt-3 truncate text-xs ${file.length ? "font-medium text-emerald-700" : "text-brand-600"}`}>
        {file.length ? `✓ ${file.map((f) => f.name).join(", ")}` : `Elegir archivo${multiple ? "(s)" : ""} .xlsx`}
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
  <span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-bold ${e === "Conciliado" ? "bg-emerald-100 text-emerald-700" : e === "No conciliado" ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-500"}`}>{e}</span>
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
            <th colSpan={5} className={`bg-sky-800 px-2 py-1.5 text-left ${g}`}>Caja virtual</th>
            <th colSpan={4} className={`bg-teal-700 px-2 py-1.5 text-left ${g}`}>Bancos</th>
            <th colSpan={3} className={`bg-slate-600 px-2 py-1.5 text-left ${g}`}>Resultado</th>
          </tr>
          <tr className="bg-slate-50 text-[10px] uppercase text-slate-500">
            <th className={th}>Fecha</th><th className={`${th} ${oro}`}>Comprobante ★</th><th className={th}>Cliente</th><th className={`${th} text-right`}>Total</th>
            <th className={`${th} ${oro} ${g}`}>Comprobante ★</th><th className={th}>Cobro · medio</th><th className={`${th} ${oro}`}>Fecha ◆</th><th className={`${th} text-right`}>Cobrado</th><th className={`${th} ${oro} text-right`}>Total del cobro ◆</th>
            <th className={`${th} ${g}`}>Cuenta</th><th className={`${th} ${oro}`}>Fecha ◆</th><th className={th}>Concepto</th><th className={`${th} ${oro} text-right`}>Importe ◆</th>
            <th className={`${th} ${g}`}>Estado</th><th className={th}>Punto en común caja ↔ banco</th><th className={th}>Observación</th>
          </tr>
        </thead>
        <tbody>
          {filas.slice(0, TOPE).map((f, i) => (
            <tr key={i} className={`border-t border-slate-100 ${f.estado === "No conciliado" ? "bg-red-50/50" : f.estado === "Cargo" ? "bg-slate-50 text-slate-400" : ""}`}>
              <td className={`${td} whitespace-nowrap`}>{fch(f.cFecha)}</td><td className={`${td} whitespace-nowrap ${f.cDoc ? pc : ""}`}>{f.cDoc}</td>
              <td className={td}><span className="line-clamp-1">{f.cCliente}</span></td><td className={tdr}>{m(f.cTotal)}</td>
              <td className={`${td} whitespace-nowrap ${g} ${f.vDoc ? pc : ""}`}>{f.vDoc}</td><td className={`${td} whitespace-nowrap`}>{[f.vCobro, f.vMedio].filter(Boolean).join(" · ")}</td>
              <td className={`${td} whitespace-nowrap ${f.vFecha ? pc : ""}`}>{fch(f.vFecha)}</td><td className={tdr}>{m(f.vImporte)}</td><td className={`${tdr} ${f.vTotalCobro != null ? pc : ""}`}>{m(f.vTotalCobro)}</td>
              <td className={`${td} whitespace-nowrap ${g}`}>{f.bBanco}</td><td className={`${td} whitespace-nowrap ${f.bFecha ? pc : ""}`}>{fch(f.bFecha)}</td>
              <td className={td}><span className="line-clamp-1">{f.bDesc}</span></td><td className={`${tdr} ${f.bImporte != null ? pc : ""}`}>{m(f.bImporte)}</td>
              <td className={`${td} ${g}`}><Est e={f.estado} /></td><td className={td}>{f.punto2}</td><td className={td}>{f.obs}</td>
            </tr>
          ))}
          {!filas.length && <Vacio cols={16} />}<Mas n={filas.length} cols={16} />
        </tbody>
      </table>
      <p className="border-t border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] text-slate-500">
        <b>★</b> punto en común contabilidad ↔ caja: el <b>comprobante</b> (serie y número). &nbsp; <b>◆</b> punto en común caja ↔ banco: el <b>total del cobro</b> y la <b>fecha</b> (o el N° de operación cuando el banco lo trae).
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
