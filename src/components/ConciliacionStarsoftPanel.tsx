"use client";

import { useState } from "react";

interface Resumen {
  bancoTotal: number; stdTotal: number; conciliados: number;
  porOperacion: number; porMontoFecha: number; porMontoDia: number;
  bancoSolo: number; stdSolo: number; montoConciliado: number;
}

const TIPO_LABEL: Record<string, string> = {
  standard: "Standard (contable/bancos)",
  ventas: "Ventas",
  anexos: "Anexos (clientes)",
  desconocido: "No reconocido",
};

export default function ConciliacionStarsoftPanel() {
  const [sistema, setSistema] = useState<File[]>([]);
  const [banco, setBanco] = useState<File | null>(null);
  const [hojas, setHojas] = useState<string[]>([]);
  const [hojasSel, setHojasSel] = useState<string[]>([]);
  const [cargandoHojas, setCargandoHojas] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [detectados, setDetectados] = useState<Record<string, string> | null>(null);
  const [descarga, setDescarga] = useState<{ nombre: string; b64: string } | null>(null);

  async function elegirBanco(f: File | null) {
    setBanco(f); setHojas([]); setHojasSel([]); setError(null);
    if (!f) return;
    setCargandoHojas(true);
    try {
      const fd = new FormData(); fd.append("banco", f);
      const res = await fetch("/api/conciliacion-starsoft/hojas", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(data.hojas)) {
        setHojas(data.hojas);
        if (data.hojas.length === 1) setHojasSel(data.hojas);
      } else setError(data.error ?? "No se pudieron leer las hojas del banco.");
    } catch { setError("Error leyendo las hojas del banco."); }
    finally { setCargandoHojas(false); }
  }

  const toggleHoja = (h: string) =>
    setHojasSel((prev) => prev.includes(h) ? prev.filter((x) => x !== h) : [...prev, h]);

  async function procesar() {
    setError(null); setResumen(null); setDescarga(null); setDetectados(null);
    if (!sistema.length) { setError("Sube los Excel del sistema (Standard, Ventas, Anexos)."); return; }
    if (!banco) { setError("Sube el Excel FORMATO BANCO STARSOFT."); return; }
    if (!hojasSel.length) { setError("Elige al menos una pestaña (cuenta) del banco a conciliar."); return; }
    setBusy(true);
    try {
      const fd = new FormData();
      sistema.slice(0, 3).forEach((f) => fd.append("sistema", f));
      fd.append("banco", banco);
      hojasSel.forEach((h) => fd.append("hoja", h));
      const res = await fetch("/api/conciliacion-starsoft", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? "No se pudo conciliar."); setDetectados(data.detectados ?? null); return; }
      setResumen(data.resumen);
      setDetectados(data.detectados ?? null);
      setDescarga({ nombre: data.nombre ?? "Conciliacion_Banco_StarSoft.xlsx", b64: data.excel });
    } catch {
      setError("Error de red al procesar.");
    } finally { setBusy(false); }
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
      <h3 className="font-semibold text-slate-800">🏦 Conciliación Banco StarSoft (banco vs contable)</h3>
      <p className="mt-1 text-xs text-slate-500">
        Sube los <b>3 Excel del sistema</b> (Standard, Ventas y Anexos) en una zona y el
        <b> FORMATO BANCO STARSOFT</b> en la otra; elige <b>una o varias pestañas (cuentas)</b> del banco.
        Cruza por <b>N° de operación</b> (con respaldo por monto y fecha) y descarga el Excel: hoja
        <b>Conciliado</b> y hoja <b>No concilia</b> (banco sin contabilizar + contable sin banco).
      </p>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {/* Zona 1: los 3 del sistema */}
        <div className="rounded-xl border-2 border-dashed border-slate-300 p-4">
          <p className="mb-2 text-sm font-semibold text-slate-700">1) Excel del sistema (hasta 3)</p>
          <p className="mb-2 text-[11px] text-slate-500">S_movStandard (obligatorio), V_movVentas y trama_anexos. Se detectan solos.</p>
          <input
            type="file" multiple accept=".xls,.xlsx"
            onChange={(e) => setSistema(Array.from(e.target.files ?? []).slice(0, 3))}
            className="block w-full text-xs text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-600 file:px-3 file:py-1.5 file:text-white hover:file:bg-brand-700"
          />
          {sistema.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-[11px] text-slate-500">
              {sistema.map((f) => <li key={f.name}>• {f.name}</li>)}
            </ul>
          )}
        </div>

        {/* Zona 2: banco */}
        <div className="rounded-xl border-2 border-dashed border-slate-300 p-4">
          <p className="mb-2 text-sm font-semibold text-slate-700">2) FORMATO BANCO STARSOFT</p>
          <p className="mb-2 text-[11px] text-slate-500">El Excel con una hoja por cuenta (FECHA, REFERENCIA, CARGO, ABONO, N° operación).</p>
          <input
            type="file" accept=".xls,.xlsx"
            onChange={(e) => elegirBanco(e.target.files?.[0] ?? null)}
            className="block w-full text-xs text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-600 file:px-3 file:py-1.5 file:text-white hover:file:bg-brand-700"
          />
          {banco && <p className="mt-2 text-[11px] text-slate-500">• {banco.name}</p>}
          {cargandoHojas && <p className="mt-2 text-[11px] text-slate-400">Leyendo pestañas…</p>}
          {hojas.length > 0 && (
            <div className="mt-2">
              <div className="mb-1 flex items-center justify-between">
                <label className="text-[11px] font-semibold text-slate-600">Cuentas a conciliar ({hojasSel.length})</label>
                <div className="flex gap-2 text-[11px]">
                  <button type="button" className="text-brand-600 hover:underline" onClick={() => setHojasSel([...hojas])}>Todas</button>
                  <button type="button" className="text-slate-400 hover:underline" onClick={() => setHojasSel([])}>Ninguna</button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 rounded-lg border border-slate-200 p-2">
                {hojas.map((h) => {
                  const on = hojasSel.includes(h);
                  return (
                    <button
                      key={h} type="button" onClick={() => toggleHoja(h)}
                      className={`rounded-md px-2 py-1 text-[11px] font-medium ${on ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
                    >
                      {on ? "✓ " : ""}{h}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button className="btn-primary" onClick={procesar} disabled={busy || !hojasSel.length}>
          {busy ? "Conciliando…" : "Conciliar"}
        </button>
        {descarga && (
          <button className="btn-accent" onClick={bajar}>⬇ Descargar Excel conciliado</button>
        )}
      </div>

      {error && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}

      {detectados && (
        <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
          {Object.entries(detectados).map(([n, t]) => (
            <div key={n}>• <b>{n}</b> → {TIPO_LABEL[t] ?? t}</div>
          ))}
        </div>
      )}

      {resumen && (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat t="Conciliados" v={resumen.conciliados} sub={`${resumen.porOperacion} op · ${resumen.porMontoFecha} m+f · ${resumen.porMontoDia} m+día`} ok />
          <Stat t="Monto conciliado" v={`S/ ${resumen.montoConciliado.toLocaleString("es-PE")}`} />
          <Stat t="Banco sin contab." v={resumen.bancoSolo} warn />
          <Stat t="Contable sin banco" v={resumen.stdSolo} warn />
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
