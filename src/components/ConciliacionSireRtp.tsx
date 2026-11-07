"use client";

import { useState } from "react";

// Conciliación SIRE vs contabilidad, POR EMPRESA (análisis RTP).
//  · Ventas: SIRE RVIE vs Registro de Ventas contable (una pestaña por empresa).
//  · Compras: SIRE RCE vs Libro Diario (si se sube el Diario como archivo contable).
// El SIRE NO se sube: se toma de lo ya descargado en el módulo Detalle SIRE de
// cada empresa (el cliente con el mismo RUC). Subir el SIRE a mano queda como
// alternativa. Se empareja por comprobante (tipo + serie + número) y monto.

const soles = (n: number) => `S/ ${Number(n || 0).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const ESTADO: Record<string, { txt: string; cls: string }> = {
  ok: { txt: "Coincide", cls: "bg-emerald-100 text-emerald-700" },
  "dif-monto": { txt: "Dif. montos", cls: "bg-red-100 text-red-700" },
  "dif-fecha": { txt: "Dif. fecha", cls: "bg-amber-100 text-amber-800" },
  "solo-sire": { txt: "Solo SIRE", cls: "bg-orange-100 text-orange-700" },
  "solo-contable": { txt: "Solo contable", cls: "bg-orange-100 text-orange-700" },
};
// Por revisar: diferencias + los emparejados con serie/número distinto.
const pendientes = (x: any) => x.cruce.difMonto + x.cruce.difFecha + x.cruce.soloSire + x.cruce.soloContable + (x.docDistinto ?? 0);

export default function ConciliacionSireRtp() {
  const [contables, setContables] = useState<File[]>([]);
  const [sires, setSires] = useState<File[]>([]);
  const [asignaciones, setAsignaciones] = useState<Record<string, string>>({});
  const [periodo, setPeriodo] = useState("");
  const [manual, setManual] = useState(false);
  const [res, setRes] = useState<any>(null);
  const [sel, setSel] = useState(0);
  const [verTodo, setVerTodo] = useState(false);
  const [busy, setBusy] = useState<"" | "conciliar" | "excel">("");
  const [error, setError] = useState<string | null>(null);

  async function conciliar(cont: File[], archivos: File[], asig: Record<string, string>, per = periodo) {
    if (!cont.length) { setRes(null); return; }
    setError(null); setBusy("conciliar");
    try {
      const fd = new FormData();
      cont.forEach((f) => fd.append("contable", f));
      archivos.forEach((f) => fd.append("sire", f));
      fd.append("asignaciones", JSON.stringify(asig));
      if (/^\d{6}$/.test(per)) fd.append("periodo", per);
      const r = await fetch("/api/analisis-compras/conciliacion", { method: "POST", body: fd });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d.error ?? "No se pudo conciliar."); return; }
      setRes(d); setSel(0); setVerTodo(false);
      if (d.periodo) setPeriodo(d.periodo);
    } catch {
      setError("Error de red al conciliar.");
    } finally {
      setBusy("");
    }
  }

  async function excel() {
    setError(null); setBusy("excel");
    try {
      const r = await fetch("/api/analisis-compras/conciliacion/excel", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ empresas: res.empresas }),
      });
      if (!r.ok) { const d = await r.json().catch(() => ({})); setError(d.error ?? "No se pudo generar el Excel."); return; }
      const blob = await r.blob();
      const nombre = /filename="([^"]+)"/.exec(r.headers.get("content-disposition") || "")?.[1] ?? "conciliacion-sire-por-empresa.zip";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = nombre;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch {
      setError("Error de red al generar el Excel.");
    } finally {
      setBusy("");
    }
  }

  const unir = (prev: File[], lista: FileList) => [...prev, ...Array.from(lista).filter((f) => !prev.some((s) => s.name === f.name && s.size === f.size))];
  const agregarContable = (lista: FileList) => { const n = unir(contables, lista); setContables(n); conciliar(n, sires, asignaciones); };
  const agregarSire = (lista: FileList) => { const n = unir(sires, lista); setSires(n); conciliar(contables, n, asignaciones); };
  const hayCompras = (res?.empresas ?? []).some((x: any) => x.libro === "compras");
  const asignar = (id: string, clave: string) => setAsignaciones((a) => ({ ...a, [id]: clave }));

  const e = res?.empresas?.[sel];
  const filas = e ? (verTodo ? e.cruce.filas : e.cruce.filas.filter((f: any) => f.estado !== "ok" || f.observaciones.length > 0)) : [];

  return (
    <div className="card space-y-4 p-5">
      <div className="flex flex-wrap items-start gap-3">
        <div className="mr-auto min-w-[16rem] flex-1">
          <h2 className="font-semibold text-slate-800">Conciliación SIRE vs contabilidad (ventas)</h2>
          <p className="mt-1 text-xs text-slate-500">
            Sube el <strong>Registro de Ventas</strong> del sistema contable (un Excel con una pestaña por empresa). El SIRE de
            ventas se toma <strong>solo</strong> de lo que ya descargaste en <a href="/herramientas/detalle-sire" target="_blank" rel="noopener" className="font-semibold text-brand-600 hover:underline">Detalle SIRE</a>{" "}
            para cada empresa (la registrada en Clientes con el mismo RUC) y el mismo periodo. Se concilia
            <strong> factura por factura</strong> (tipo + serie + número) y por <strong>monto</strong> (base, IGV, total) y fecha.
            Con el Libro Diario, concilia compras contra el Detalle SIRE de compras.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className={`cursor-pointer text-sm ${contables.length ? "btn-ghost" : "btn-primary"} ${busy ? "pointer-events-none opacity-50" : ""}`}>
            {busy === "conciliar" ? "Conciliando…" : contables.length ? "✓ Registro de Ventas · cambiar" : "⬆ Subir Registro de Ventas (contable)"}
            <input type="file" multiple accept=".xlsx" className="hidden"
              onChange={(ev) => { const f = ev.target.files; if (f && f.length) { const n = Array.from(f); setContables(n); setPeriodo(""); conciliar(n, sires, asignaciones, ""); } ev.currentTarget.value = ""; }} />
          </label>
          {contables.length > 0 && (
            <button className="btn-ghost text-sm" disabled={!!busy} onClick={() => conciliar(contables, sires, asignaciones)} title="Después de descargar el SIRE que faltaba en Detalle SIRE">
              ↻ Volver a conciliar
            </button>
          )}
          {res?.empresas?.length > 0 && (
            <button className="btn-ghost text-sm" onClick={excel} disabled={!!busy}>
              {busy === "excel" ? "Generando…" : `⬇ Excel por empresa (${res.empresas.length})`}
            </button>
          )}
        </div>
      </div>

      {contables.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
          <span>Periodo:</span>
          <input className="input w-28 py-1 text-xs" value={periodo} maxLength={6} placeholder="AAAAMM"
            onChange={(ev) => setPeriodo(ev.target.value.replace(/\D/g, "").slice(0, 6))} />
          <button className="text-xs font-semibold text-brand-600 hover:underline disabled:opacity-50" disabled={!!busy || !/^\d{6}$/.test(periodo)}
            onClick={() => conciliar(contables, sires, asignaciones)}>Aplicar periodo</button>
          <span className="text-slate-300">|</span>
          <button className="text-xs text-slate-500 hover:text-brand-700" onClick={() => setManual((m) => !m)}>
            {manual ? "Ocultar" : "¿No usarás Detalle SIRE? Subir el SIRE a mano"}
          </button>
          {manual && (
            <label className={`btn-ghost cursor-pointer py-1 text-xs ${busy ? "pointer-events-none opacity-50" : ""}`}>
              ⬆ Archivos SIRE (Excel, TXT o ZIP)
              <input type="file" multiple accept=".xlsx,.txt,.csv,.zip" className="hidden"
                onChange={(ev) => { const f = ev.target.files; if (f && f.length) agregarSire(f); ev.currentTarget.value = ""; }} />
            </label>
          )}
        </div>
      )}

      {(contables.length > 0 || sires.length > 0) && (
        <div className="flex flex-wrap items-center gap-2">
          {contables.map((f, i) => (
            <span key={`c${i}`} className="rounded-full bg-brand-50 px-3 py-1 text-[11px] text-brand-800">Contable: {f.name}</span>
          ))}
          {sires.map((f, i) => (
            <span key={i} className="rounded-full bg-slate-100 px-3 py-1 text-[11px] text-slate-600">
              SIRE: {f.name}
              <button className="ml-2 text-slate-400 hover:text-red-600" title="Quitar" disabled={!!busy}
                onClick={() => { const n = sires.filter((_, j) => j !== i); setSires(n); conciliar(contables, n, asignaciones); }}>×</button>
            </span>
          ))}

        </div>
      )}

      {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
      {res?.avisos?.length > 0 && (
        <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{res.avisos.map((a: string, i: number) => <div key={i}>{a}</div>)}</div>
      )}

      {res?.sinEmpresa?.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3 text-xs">
          <p className="mb-2 font-semibold text-amber-900">SIRE sin empresa: su RUC y su razón social no coinciden con ninguna pestaña del archivo contable. Elige a cuál corresponde.</p>
          {res.sinEmpresa.map((s: any) => (
            <div key={s.id} className="mb-1 flex flex-wrap items-center gap-2">
              <span className="text-slate-700">{s.nombre} ({s.libro}) · <strong>{s.razonSocial || "—"}</strong> {s.ruc && `(RUC ${s.ruc})`} · {s.comprobantes} comprob.</span>
              <select className="input w-auto py-1 text-xs" value={asignaciones[s.id] ?? ""} onChange={(ev) => asignar(s.id, ev.target.value)}>
                <option value="">— Elegir empresa —</option>
                {res.empresasDisponibles.map((x: any) => <option key={x.clave} value={x.clave}>{x.empresa}</option>)}
              </select>
            </div>
          ))}
          <button className="btn-primary mt-2 text-xs" disabled={!!busy || !Object.keys(asignaciones).length} onClick={() => conciliar(contables, sires, asignaciones)}>Aplicar y conciliar</button>
        </div>
      )}

      {res?.faltantes?.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
          <p className="mb-2 font-semibold text-slate-700">Falta el SIRE de estas empresas (periodo {res.periodo}). Descárgalo y pulsa “↻ Volver a conciliar”:</p>
          {res.faltantes.map((f: any, i: number) => (
            <div key={i} className="flex flex-wrap items-center gap-2 border-t border-slate-200 py-1.5 first:border-0">
              <span className="min-w-[14rem] font-semibold text-slate-700">{f.empresa}</span>
              <span className="text-slate-400">{f.ruc && `RUC ${f.ruc} · `}{f.libro}</span>
              {f.motivo === "sin-detalle" ? (
                <a className="font-semibold text-brand-600 hover:underline" target="_blank" rel="noopener"
                  href={`/herramientas/detalle-sire?cliente=${f.clienteId}&tab=${f.libro}&periodo=${f.periodo}`}>
                  Descargar en Detalle SIRE ({f.libro === "ventas" ? "RVIE" : "RCE"} {f.periodo}) →
                </a>
              ) : (
                <a className="font-semibold text-amber-700 hover:underline" target="_blank" rel="noopener" href={`/clientes/nuevo${f.ruc ? `?ruc=${f.ruc}` : ""}`}>
                  No está en Clientes: registrarla →
                </a>
              )}
            </div>
          ))}
        </div>
      )}

      {res?.empresas?.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full whitespace-nowrap text-[11px]">
            <thead>
              <tr className="text-left text-[10px] uppercase text-slate-400">
                <th className="px-2 py-1">Empresa</th>
                {hayCompras && <th className="px-2 py-1">Libro</th>}
                <th className="px-2 py-1 text-right">SIRE</th>
                <th className="px-2 py-1 text-right">Contabilidad</th>
                <th className="px-2 py-1 text-right">Diferencia</th>
                <th className="px-2 py-1 text-right" title="Comprobantes que coinciden">OK</th>
                <th className="px-2 py-1 text-right" title="Diferencia de montos">Montos</th>
                <th className="px-2 py-1 text-right" title="Diferencia de fecha">Fecha</th>
                <th className="px-2 py-1 text-right">Solo SIRE</th>
                <th className="px-2 py-1 text-right">Solo cont.</th>
                <th className="px-2 py-1">Estado</th>
              </tr>
            </thead>
            <tbody>
              {res.empresas.map((x: any, i: number) => {
                const c = x.cruce, dif = c.totalesSire.total - c.totalesContable.total, p = pendientes(x);
                return (
                  <tr key={`${x.clave}|${x.libro}`} onClick={() => { setSel(i); setVerTodo(false); }}
                    className={`cursor-pointer border-t border-slate-100 ${sel === i ? "bg-brand-50" : "hover:bg-slate-50"}`}>
                    <td className="min-w-[9rem] whitespace-normal px-2 py-1.5 font-semibold text-brand-700">{x.empresa}</td>
                    {hayCompras && <td className="px-2 py-1.5 capitalize text-slate-500">{x.libro}</td>}
                    <td className="px-2 py-1.5 text-right tabular-nums">{soles(c.totalesSire.total)}<div className="text-[10px] text-slate-400">{c.totalesSire.comprobantes} comprob.</div></td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{soles(c.totalesContable.total)}<div className="text-[10px] text-slate-400">{c.totalesContable.comprobantes} comprob.</div></td>
                    <td className={`px-2 py-1.5 text-right tabular-nums ${Math.abs(dif) > 1 ? "font-semibold text-red-600" : "text-slate-400"}`}>{soles(dif)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-emerald-700">{c.ok}</td>
                    <td className={`px-2 py-1.5 text-right tabular-nums ${c.difMonto ? "font-semibold text-red-600" : "text-slate-400"}`}>{c.difMonto}</td>
                    <td className={`px-2 py-1.5 text-right tabular-nums ${c.difFecha ? "font-semibold text-amber-700" : "text-slate-400"}`}>{c.difFecha}</td>
                    <td className={`px-2 py-1.5 text-right tabular-nums ${c.soloSire ? "font-semibold text-orange-700" : "text-slate-400"}`}>{c.soloSire}</td>
                    <td className={`px-2 py-1.5 text-right tabular-nums ${c.soloContable ? "font-semibold text-orange-700" : "text-slate-400"}`}>{c.soloContable}</td>
                    <td className="px-2 py-1.5">
                      <span className={`rounded px-2 py-0.5 text-[10px] font-bold ${p ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-700"}`}>{p ? `Revisar ${p}` : "Cuadra"}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {e && (
        <div className="rounded-xl border border-slate-200">
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2">
            <span className="mr-auto text-sm font-bold text-slate-800">{e.empresa}<span className="ml-2 font-normal capitalize text-slate-500">· {e.libro}{e.periodo && ` · periodo ${e.periodo}`}</span></span>
            {e.docDistinto > 0 && <span className="text-[11px] text-amber-700">{e.docDistinto} con serie/número distinto (emparejado por {e.libro === "compras" ? "RUC del proveedor" : "tipo, fecha y cliente"} + importe)</span>}
            {e.excluidos?.honorarios > 0 && <span className="text-[11px] text-slate-500">{e.excluidos.honorarios} recibo(s) por honorarios excluidos (no van al RCE)</span>}
            <button className="text-xs font-semibold text-brand-600 hover:underline" onClick={() => setVerTodo((v) => !v)}>
              {verTodo ? "Ver solo diferencias" : `Ver todos (${e.cruce.filas.length})`}
            </button>
          </div>
          {filas.length === 0 ? (
            <p className="px-3 py-3 text-sm text-emerald-700">✓ Todos los comprobantes coinciden: misma factura y mismo monto en el SIRE y en la contabilidad.</p>
          ) : (
            <div className="max-h-[32rem] overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-white">
                  <tr className="text-left text-[10px] uppercase text-slate-400">
                    <th className="px-2 py-1">Estado</th>
                    <th className="px-2 py-1">Comprobante</th>
                    <th className="px-2 py-1">{e.libro === "compras" ? "Proveedor" : "Cliente"}</th>
                    <th className="px-2 py-1">Fecha SIRE / cont.</th>
                    <th className="px-2 py-1 text-right">Total SIRE</th>
                    <th className="px-2 py-1 text-right">Total cont.</th>
                    <th className="px-2 py-1 text-right">Dif.</th>
                    <th className="px-2 py-1">Observación</th>
                  </tr>
                </thead>
                <tbody>
                  {filas.map((f: any) => (
                    <tr key={f.clave} className="border-t border-slate-100 align-top">
                      <td className="px-2 py-1">{f.estado === "ok" && f.observaciones.length
                        ? <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">Nº distinto</span>
                        : <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${ESTADO[f.estado]?.cls ?? ""}`}>{ESTADO[f.estado]?.txt ?? f.estado}</span>}</td>
                      <td className="whitespace-nowrap px-2 py-1 font-semibold text-slate-700"><span className="mr-1 text-[10px] font-normal text-slate-400">{({ "1": "FAC", "3": "BOL", "7": "NC", "8": "ND" } as Record<string, string>)[f.tipoDoc] ?? f.tipoDoc}</span>{f.serie}-{f.numero}</td>
                      <td className="px-2 py-1 text-slate-600">{f.rucContraparte}{f.razonSocial && <div className="text-[10px] text-slate-400">{f.razonSocial}</div>}</td>
                      <td className="whitespace-nowrap px-2 py-1 tabular-nums text-slate-500">{f.fechaSire || "—"} / {f.fechaContable || "—"}</td>
                      <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums">{f.estado === "solo-contable" ? "—" : soles(f.totalSire)}</td>
                      <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums">{f.estado === "solo-sire" ? "—" : soles(f.totalContable)}</td>
                      <td className={`whitespace-nowrap px-2 py-1 text-right tabular-nums ${Math.abs(f.difTotal) > 1 ? "font-semibold text-red-600" : "text-slate-400"}`}>{soles(f.difTotal)}</td>
                      <td className="px-2 py-1 text-[11px] text-slate-500">{f.observaciones.join(" · ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
