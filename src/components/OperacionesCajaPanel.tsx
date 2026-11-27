"use client";

import { useMemo, useState } from "react";
import { unzipSync, zipSync } from "fflate";
import type { ResultadoOperaciones, OperacionCaja } from "@/lib/cajaOperaciones";

// Relación N° DE OPERACIÓN ↔ COMPROBANTES. Se suben los ZIP que baja "Caja virtual · reportes por
// sede" (uno por sede). El navegador saca de cada ZIP solo lo necesario (el Excel de cada día y los
// PDF de depósito del Drive) y el servidor lee los vouchers escaneados y arma la relación.

const soles = (n: number | null) => (n == null ? "—" : `S/ ${Number(n).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const fch = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split("-").reverse().join("/") : iso);
type Filtro = "efectivo" | "todas" | "revisar";
const ESTADO: Record<string, string> = { Cuadra: "bg-emerald-100 text-emerald-700", Diferencia: "bg-red-100 text-red-700", "Sin voucher": "bg-amber-100 text-amber-800", "Según caja virtual": "bg-slate-100 text-slate-500" };

/** Deja del ZIP solo el Excel de cada día y los PDF del Drive que no son el reporte escaneado
 *  (un mes de una sede baja de ~30 MB a ~4 MB). */
function reducir(buf: ArrayBuffer): Uint8Array {
  const conDrive = new Set<string>();
  const util = unzipSync(new Uint8Array(buf), {
    filter: (f) => {
      const m = /(?:^|\/)(\d{4}-\d{2}-\d{2})\/(.+)$/.exec(f.name);
      if (!m) return false;
      if (/^drive\//i.test(m[2])) conDrive.add(m[1]);
      return (!m[2].includes("/") && /\.xlsx$/i.test(m[2])) || (/^drive\/[^/]+\.pdf$/i.test(m[2]) && !/^drive\/REPORTE/i.test(m[2]));
    },
  });
  // Marca de "la sede sí subió algo al Drive ese día" aunque no haya PDF de depósito (sin mandar esos archivos).
  for (const d of Array.from(conDrive)) if (!Object.keys(util).some((k) => k.includes(`${d}/drive/`))) util[`${d}/drive/_sin-deposito.txt`] = new Uint8Array([32]);
  return zipSync(util, { level: 0 });
}

export default function OperacionesCajaPanel() {
  const [sedes, setSedes] = useState<ResultadoOperaciones[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Filtro>("efectivo");
  const [abierta, setAbierta] = useState<string | null>(null);
  const [buscar, setBuscar] = useState("");

  async function subir(lista: FileList) {
    setError(null);
    const nuevas: ResultadoOperaciones[] = [];
    try {
      for (const [i, f] of Array.from(lista).entries()) {
        setBusy(`Leyendo ${f.name} (${i + 1} de ${lista.length}): se leen los vouchers escaneados, puede tardar cerca de un minuto por sede…`);
        let cuerpo: Uint8Array;
        try { cuerpo = reducir(await f.arrayBuffer()); } catch { setError(`"${f.name}" no es un ZIP válido.`); continue; }
        const fd = new FormData();
        fd.append("zip", new Blob([cuerpo as unknown as BlobPart], { type: "application/zip" }), f.name);
        const r = await fetch("/api/conciliacion/operaciones", { method: "POST", body: fd });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) { setError(`${f.name}: ${d.error ?? "no se pudo analizar."}`); continue; }
        nuevas.push(d.sede);
      }
      if (nuevas.length) setSedes((prev) => [...prev.filter((p) => !nuevas.some((n) => n.sede === p.sede)), ...nuevas]);
    } catch { setError("Error de red al analizar el ZIP."); }
    finally { setBusy(""); }
  }

  async function excel() {
    setError(null); setBusy("Generando el Excel…");
    try {
      const r = await fetch("/api/conciliacion/operaciones", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sedes }) });
      if (!r.ok) { const d = await r.json().catch(() => ({})); setError(d.error ?? "No se pudo generar el Excel."); return; }
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement("a"); a.href = url; a.download = "relacion-operaciones-comprobantes.xlsx";
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } finally { setBusy(""); }
  }

  const q = buscar.trim().toUpperCase();
  const ops = useMemo(() => sedes.flatMap((s) => s.operaciones).filter((o) =>
    (filtro === "todas" || (filtro === "efectivo" ? o.medio.startsWith("EFECTIVO") : o.estado === "Diferencia" || o.estado === "Sin voucher")) &&
    (!q || o.operacion.toUpperCase().includes(q) || o.sede.toUpperCase().includes(q) || o.comprobantes.some((c) => c.comprobante.includes(q)))), [sedes, filtro, q]);
  const clave = (o: OperacionCaja) => `${o.sede}|${o.fechaVenta}|${o.medio}|${o.operacion}`;

  return (
    <div className="card space-y-4 p-5">
      <div className="flex flex-wrap items-start gap-3">
        <div className="mr-auto min-w-[16rem] flex-1">
          <h2 className="font-semibold text-slate-800">Relación N° de operación ↔ comprobantes (Caja virtual)</h2>
          <p className="mt-1 text-xs text-slate-500">
            Sube los ZIP que descarga <a href="/herramientas/caja-virtual" className="font-semibold text-brand-600 hover:underline">Caja virtual · reportes por sede</a> (uno por sede).
            El <strong>efectivo</strong> de cada día se relaciona con el <strong>voucher del depósito</strong> que la sede subió al Drive: se lee del voucher el N° de operación, la fecha y el monto,
            y se comprueba que el depósito sea igual al efectivo del día. Yape, depósitos de clientes y Visa salen con el N° de operación del reporte de caja.
          </p>
        </div>
        <label className={`btn-primary cursor-pointer text-sm ${busy ? "pointer-events-none opacity-50" : ""}`}>
          ⬆ Subir ZIP de sede(s)
          <input type="file" multiple accept=".zip" className="hidden" onChange={(e) => { const f = e.target.files; if (f?.length) subir(f); e.currentTarget.value = ""; }} />
        </label>
        {sedes.length > 0 && <button className="btn-accent text-sm" onClick={excel} disabled={!!busy}>⬇ Excel de la relación</button>}
      </div>
      {busy && <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">⏳ {busy}</div>}
      {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}

      {sedes.length > 0 && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full whitespace-nowrap text-sm">
              <thead><tr className="text-left text-[11px] uppercase text-slate-400">
                <th className="px-2 py-1">Sede</th><th className="px-2 py-1 text-right">Días</th><th className="px-2 py-1 text-right">Comprobantes</th><th className="px-2 py-1 text-right">Total cobrado</th>
                <th className="px-2 py-1 text-right">Efectivo</th><th className="px-2 py-1 text-right">Depositado (vouchers)</th><th className="px-2 py-1 text-right">Cuadran</th><th className="px-2 py-1 text-right">Con diferencia</th><th className="px-2 py-1 text-right">Sin voucher</th><th className="px-2 py-1" />
              </tr></thead>
              <tbody>
                {sedes.map((s) => {
                  const ef = s.operaciones.filter((x) => x.medio.startsWith("EFECTIVO"));
                  const n = (e: string) => ef.filter((x) => x.estado === e).length;
                  return (
                    <tr key={s.sede} className="border-t border-slate-100">
                      <td className="px-2 py-1.5 font-semibold text-slate-800">{s.sede}</td><td className="px-2 py-1.5 text-right tabular-nums">{s.dias}</td><td className="px-2 py-1.5 text-right tabular-nums">{s.comprobantes}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{soles(s.total)}</td><td className="px-2 py-1.5 text-right tabular-nums">{soles(ef.reduce((a, x) => a + x.sumaComprobantes, 0))}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{soles(ef.reduce((a, x) => a + (x.montoVoucher ?? 0), 0))}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-emerald-700">{n("Cuadra")}</td>
                      <td className={`px-2 py-1.5 text-right tabular-nums ${n("Diferencia") ? "font-semibold text-red-600" : "text-slate-400"}`}>{n("Diferencia")}</td>
                      <td className={`px-2 py-1.5 text-right tabular-nums ${n("Sin voucher") ? "font-semibold text-amber-700" : "text-slate-400"}`}>{n("Sin voucher")}</td>
                      <td className="px-2 py-1.5 text-right"><button className="text-xs text-slate-400 hover:text-red-600" disabled={!!busy} onClick={() => setSedes((p) => p.filter((x) => x.sede !== s.sede))}>Quitar</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {sedes.flatMap((s) => s.avisos.map((a) => `${s.sede}: ${a}`)).slice(0, 6).map((a, i) => <p key={i} className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{a}</p>)}

          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1 text-sm">
              {([["efectivo", "Depósitos de efectivo"], ["revisar", "Por revisar"], ["todas", "Todas las operaciones"]] as [Filtro, string][]).map(([k, t]) => (
                <button key={k} onClick={() => setFiltro(k)} className={`rounded-md px-3 py-1.5 font-semibold transition ${filtro === k ? "bg-brand-600 text-white" : "text-slate-500 hover:text-brand-700"}`}>{t}</button>
              ))}
            </div>
            <input className="input ml-auto max-w-xs" placeholder="Buscar N° de operación o comprobante…" value={buscar} onChange={(e) => setBuscar(e.target.value)} />
          </div>

          <div className="max-h-[36rem] overflow-auto rounded-lg border border-slate-200">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-slate-50 text-[10px] uppercase text-slate-500"><tr>
                <th className="px-2 py-1.5 text-left">Sede</th><th className="px-2 py-1.5 text-left">Venta</th><th className="px-2 py-1.5 text-left">Medio</th><th className="px-2 py-1.5 text-left">Banco</th>
                <th className="bg-amber-100 px-2 py-1.5 text-left text-amber-900">N° de operación</th><th className="px-2 py-1.5 text-left">Fecha operación</th><th className="px-2 py-1.5 text-right">Monto voucher</th>
                <th className="px-2 py-1.5 text-right">Suma comprobantes</th><th className="px-2 py-1.5 text-right">Comprob.</th><th className="px-2 py-1.5 text-left">Estado</th><th className="px-2 py-1.5 text-left">Observación</th>
              </tr></thead>
              <tbody>
                {ops.slice(0, 500).map((o) => {
                  const k = clave(o), ab = abierta === k;
                  return [
                    <tr key={k} onClick={() => setAbierta(ab ? null : k)} className={`cursor-pointer border-t border-slate-100 ${ab ? "bg-brand-50" : "hover:bg-slate-50"} ${o.estado === "Diferencia" ? "bg-red-50/50" : ""}`}>
                      <td className="whitespace-nowrap px-2 py-1 text-slate-700">{o.sede}</td><td className="whitespace-nowrap px-2 py-1">{fch(o.fechaVenta)}</td><td className="whitespace-nowrap px-2 py-1">{o.medio}</td><td className="px-2 py-1">{o.banco}</td>
                      <td className="whitespace-nowrap bg-amber-50/70 px-2 py-1 font-semibold text-slate-800">{o.operacion || "—"}</td>
                      <td className="whitespace-nowrap px-2 py-1">{fch(o.fechaOperacion)}{o.horaOperacion && <span className="ml-1 text-slate-400">{o.horaOperacion}</span>}</td>
                      <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums">{soles(o.montoVoucher)}</td><td className="whitespace-nowrap px-2 py-1 text-right tabular-nums">{soles(o.sumaComprobantes)}</td>
                      <td className="px-2 py-1 text-right tabular-nums text-brand-700">{o.comprobantes.length} {ab ? "▲" : "▼"}</td>
                      <td className="px-2 py-1"><span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-bold ${ESTADO[o.estado] ?? ""}`}>{o.estado}</span></td>
                      <td className="min-w-[14rem] px-2 py-1 text-slate-500">{o.obs}</td>
                    </tr>,
                    ab && (
                      <tr key={`${k}-d`} className="bg-brand-50/40"><td colSpan={11} className="px-3 py-2">
                        <p className="mb-1 text-[11px] font-semibold text-slate-600">Comprobantes de la operación {o.operacion || "(sin número)"} · {soles(o.sumaComprobantes)}</p>
                        <div className="flex flex-wrap gap-1.5">{o.comprobantes.map((c) => <span key={c.comprobante} className="rounded border border-slate-200 bg-white px-2 py-0.5 tabular-nums text-slate-700"><span className="text-[10px] text-slate-400">{c.tipoDoc}</span> {c.comprobante} · <b>{soles(c.importe)}</b></span>)}</div>
                      </td></tr>
                    ),
                  ];
                })}
                {!ops.length && <tr><td colSpan={11} className="px-2 py-3 text-slate-500">Sin operaciones con ese filtro.</td></tr>}
                {ops.length > 500 && <tr><td colSpan={11} className="px-2 py-2 text-slate-400">… y {ops.length - 500} más (están todas en el Excel)</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500">Pulsa una fila para ver sus comprobantes. El N° de operación de los depósitos se lee del voucher escaneado: si el escaneo está borroso puede salir un dígito mal; el monto y la fecha sirven para confirmarlo contra el banco.</p>
        </>
      )}
    </div>
  );
}
