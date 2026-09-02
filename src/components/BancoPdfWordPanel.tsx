"use client";

import { useState } from "react";

interface Resumen {
  empresa: string; cuenta: string; periodo: string;
  saldoInicial: number; saldoFinal: number; movimientos: number;
}

export default function BancoPdfWordPanel() {
  const [pdf, setPdf] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [res, setRes] = useState<{ nombre: string; excel: string } | null>(null);

  async function procesar() {
    setError(null); setResumen(null); setRes(null);
    if (!pdf) { setError("Sube el PDF del estado de cuenta."); return; }
    setBusy(true);
    try {
      const fd = new FormData(); fd.append("pdf", pdf);
      const r = await fetch("/api/banco-pdf-word", { method: "POST", body: fd });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) { setError(data.error ?? "No se pudo convertir."); return; }
      setResumen(data.resumen);
      setRes({ nombre: data.nombre ?? "estado_cuenta", excel: data.excel });
      // Descarga automática del Excel al terminar.
      if (data.excel) descargarExcel(data.nombre ?? "estado_cuenta", data.excel);
    } catch { setError("Error de red al procesar."); }
    finally { setBusy(false); }
  }

  function descargarExcel(nombre: string, b64: string) {
    if (!b64) return;
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${nombre}.xlsx`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  const soles = (n: number) => "S/ " + (Number(n) || 0).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <section className="card p-5">
      <h3 className="font-semibold text-slate-800">📊 Estado de cuenta (PDF) → Excel</h3>
      <p className="mt-1 text-xs text-slate-500">
        Sube el <b>PDF del estado de cuenta del banco</b> (BCP, con capa de texto) y descarga en
        <b> Excel</b> la tabla de conciliación: FECHA · DESCRIPCIÓN · NUM OP · HORA · CARGO/ABONO ·
        SALDO CONTABLE · CONCILIACIÓN (esta última en blanco para llenar). El saldo se calcula corrido.
      </p>

      <div className="mt-4 rounded-xl border-2 border-dashed border-slate-300 p-4">
        <input
          type="file" accept=".pdf"
          onChange={(e) => setPdf(e.target.files?.[0] ?? null)}
          className="block w-full text-xs text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-600 file:px-3 file:py-1.5 file:text-white hover:file:bg-brand-700"
        />
        {pdf && <p className="mt-2 text-[11px] text-slate-500">• {pdf.name}</p>}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button className="btn-primary" onClick={procesar} disabled={busy}>{busy ? "Convirtiendo…" : "Convertir a Excel"}</button>
        {res && <button className="btn-accent" onClick={() => descargarExcel(res.nombre, res.excel)}>⬇ Descargar Excel</button>}
      </div>

      {error && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}

      {resumen && (
        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          <p className="font-semibold">{resumen.empresa || "Estado de cuenta"}</p>
          <p className="text-xs">
            {resumen.cuenta && <>Cuenta {resumen.cuenta} · </>}
            {resumen.periodo && <>{resumen.periodo} · </>}
            {resumen.movimientos} movimientos · saldo {soles(resumen.saldoInicial)} → {soles(resumen.saldoFinal)}
          </p>
        </div>
      )}
    </section>
  );
}
