"use client";

import { useState } from "react";

interface Resumen {
  ventasTotal: number; cajaTotal: number;
  conciliados: number; faltanEnCaja: number; cajaSinVenta: number;
  montoVentas: number; montoConciliado: number; montoFaltante: number;
  conDiferencia: number;
}
interface Detalle { archivo: string; filas: number; periodo: string }

export default function VentasCajaPanel() {
  const [ventas, setVentas] = useState<File[]>([]);
  const [caja, setCaja] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [detalle, setDetalle] = useState<Detalle[] | null>(null);
  const [descarga, setDescarga] = useState<{ nombre: string; b64: string } | null>(null);

  async function procesar() {
    setError(null); setResumen(null); setDescarga(null); setDetalle(null);
    if (!ventas.length) { setError("Sube el/los Libro(s) de Ventas (Excel o ZIP)."); return; }
    if (!caja) { setError("Sube el Excel de la Caja Virtual."); return; }
    setBusy(true);
    try {
      const fd = new FormData();
      ventas.forEach((f) => fd.append("ventas", f));
      fd.append("caja", caja);
      const res = await fetch("/api/ventas-caja", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? "No se pudo conciliar."); return; }
      setResumen(data.resumen); setDetalle(data.detalle ?? null);
      setDescarga({ nombre: data.nombre ?? "Conciliacion_Ventas_vs_Caja.xlsx", b64: data.excel });
    } catch { setError("Error de red al procesar."); }
    finally { setBusy(false); }
  }

  function bajar() {
    if (!descarga) return;
    const bin = atob(descarga.b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = descarga.nombre;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="card p-5">
      <h3 className="font-semibold text-slate-800">🧾 Ventas vs Caja Virtual</h3>
      <p className="mt-1 text-xs text-slate-500">
        Sube el <b>Libro de Ventas por mes</b> (uno o varios Excel, o un <b>ZIP</b> con todos) y la
        <b> Caja Virtual</b> de la empresa. Cruza por <b>N° de comprobante</b> (serie‑número, suma
        pagos parciales) y descarga el Excel: hoja <b>Conciliado</b>, hoja <b>Faltan en Caja</b>
        (ventas sin cobro) y <b>En Caja sin Venta</b>.
      </p>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border-2 border-dashed border-slate-300 p-4">
          <p className="mb-2 text-sm font-semibold text-slate-700">1) Libro(s) de Ventas</p>
          <p className="mb-2 text-[11px] text-slate-500">Uno por mes (ene–jul) o un ZIP. .xlsx / .zip</p>
          <input
            type="file" multiple accept=".xls,.xlsx,.zip"
            onChange={(e) => setVentas(Array.from(e.target.files ?? []))}
            className="block w-full text-xs text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-600 file:px-3 file:py-1.5 file:text-white hover:file:bg-brand-700"
          />
          {ventas.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-[11px] text-slate-500">
              {ventas.map((f) => <li key={f.name}>• {f.name}</li>)}
            </ul>
          )}
        </div>

        <div className="rounded-xl border-2 border-dashed border-slate-300 p-4">
          <p className="mb-2 text-sm font-semibold text-slate-700">2) Caja Virtual</p>
          <p className="mb-2 text-[11px] text-slate-500">El reporte de ingresos (todo el periodo). .xlsx</p>
          <input
            type="file" accept=".xls,.xlsx"
            onChange={(e) => setCaja(e.target.files?.[0] ?? null)}
            className="block w-full text-xs text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-600 file:px-3 file:py-1.5 file:text-white hover:file:bg-brand-700"
          />
          {caja && <p className="mt-2 text-[11px] text-slate-500">• {caja.name}</p>}
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button className="btn-primary" onClick={procesar} disabled={busy}>{busy ? "Conciliando…" : "Conciliar"}</button>
        {descarga && <button className="btn-accent" onClick={bajar}>⬇ Descargar Excel</button>}
      </div>

      {error && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}

      {detalle && (
        <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
          {detalle.map((d) => (
            <div key={d.archivo}>• <b>{d.archivo}</b> → {d.filas} ventas · periodo {d.periodo}</div>
          ))}
        </div>
      )}

      {resumen && (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat t="Conciliados" v={resumen.conciliados} sub={`de ${resumen.ventasTotal} ventas`} ok />
          <Stat t="Faltan en Caja" v={resumen.faltanEnCaja} sub={`S/ ${resumen.montoFaltante.toLocaleString("es-PE")}`} warn />
          <Stat t="En Caja sin Venta" v={resumen.cajaSinVenta} warn />
          <Stat t="Con dif. de monto" v={resumen.conDiferencia} />
        </div>
      )}
    </section>
  );
}

function Stat({ t, v, sub, ok, warn }: { t: string; v: any; sub?: string; ok?: boolean; warn?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${ok ? "border-emerald-200 bg-emerald-50" : warn ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-white"}`}>
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{t}</p>
      <p className={`text-lg font-bold ${ok ? "text-emerald-700" : warn ? "text-amber-700" : "text-slate-800"}`}>{v}</p>
      {sub && <p className="text-[10px] text-slate-400">{sub}</p>}
    </div>
  );
}
