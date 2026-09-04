"use client";

import { useState } from "react";

interface Fila { empresa: string; eecc: number | null; starsoft: number | null; caja: number | null }
interface Resultado {
  filas: Fila[];
  fuentes: { eecc: number; starsoft: number; caja: number };
  avisos: string[];
}

const money = (n: number | null) =>
  n == null ? "—" : n.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dif = (a: number | null, b: number | null): number | null => (a != null && b != null ? +(a - b).toFixed(2) : null);

function DifCell({ v }: { v: number | null }) {
  if (v == null) return <td className="px-2 py-1 text-right text-slate-300">—</td>;
  const off = Math.abs(v) >= 0.5;
  return <td className={`px-2 py-1 text-right tabular-nums ${off ? "font-semibold text-amber-600" : "text-slate-400"}`}>{money(v)}</td>;
}

export default function ComparativoIngresosPanel() {
  const [eecc, setEecc] = useState<File[]>([]);
  const [starsoft, setStarsoft] = useState<File[]>([]);
  const [caja, setCaja] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [res, setRes] = useState<Resultado | null>(null);
  const [descarga, setDescarga] = useState<{ nombre: string; b64: string } | null>(null);

  async function generar() {
    setError(null); setRes(null); setDescarga(null);
    if (!eecc.length && !starsoft.length && !caja.length) {
      setError("Sube al menos una fuente (EECC, StarSoft o Caja Virtual)."); return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      eecc.forEach((f) => fd.append("eecc", f));
      starsoft.forEach((f) => fd.append("starsoft", f));
      caja.forEach((f) => fd.append("caja", f));
      const r = await fetch("/api/comparativo-ingresos", { method: "POST", body: fd });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) { setError(data.error ?? "No se pudo generar el comparativo."); return; }
      setRes(data.resultado);
      setDescarga({ nombre: data.nombre ?? "Comparativo_Ingresos.xlsx", b64: data.excel });
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

  const zonas: { key: "eecc" | "starsoft" | "caja"; titulo: string; sub: string; files: File[]; set: (f: File[]) => void }[] = [
    { key: "eecc", titulo: "1) Estado de cuenta (EECC / banco)", sub: "FORMATO BANCO STARSOFT. Ingreso = suma de ABONOS por empresa.", files: eecc, set: setEecc },
    { key: "starsoft", titulo: "2) StarSoft (Registro de Ventas)", sub: 'Ingreso = columna "Total". Nombra el archivo "starsoft - empresa - periodo".', files: starsoft, set: setStarsoft },
    { key: "caja", titulo: "3) Caja Virtual", sub: 'Export contable "Resultado". Ingreso = líneas D. Nombra "caja - empresa - periodo".', files: caja, set: setCaja },
  ];

  return (
    <section className="card p-5">
      <h3 className="font-semibold text-slate-800">📊 Comparativo de ingresos por fuente (EECC · StarSoft · Caja Virtual)</h3>
      <p className="mt-1 text-xs text-slate-500">
        Sube los Excel de cada fuente. El comparativo muestra <b>solo la(s) empresa(s) de los documentos
        StarSoft/Caja</b> que subes (el extracto del banco puede traer muchas empresas, pero solo se toma la
        que coincide). Arma un Excel de 2 hojas: <b>Ingresos por fuente</b> (resumen) y <b>Conciliación</b>
        (detallada: diferencias EECC − StarSoft, EECC − Caja y StarSoft − Caja + cuentas del banco).
        Las empresas se emparejan por nombre (sin S.A.C./S.A.).
      </p>

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        {zonas.map((z) => (
          <div key={z.key} className="rounded-xl border-2 border-dashed border-slate-300 p-4">
            <p className="mb-1 text-sm font-semibold text-slate-700">{z.titulo}</p>
            <p className="mb-2 text-[11px] text-slate-500">{z.sub}</p>
            <input
              type="file" multiple accept=".xls,.xlsx"
              onChange={(e) => z.set(Array.from(e.target.files ?? []))}
              className="block w-full text-xs text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-600 file:px-3 file:py-1.5 file:text-white hover:file:bg-brand-700"
            />
            {z.files.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-[11px] text-slate-500">
                {z.files.map((f) => <li key={f.name}>• {f.name}</li>)}
              </ul>
            )}
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button className="btn-primary" onClick={generar} disabled={busy}>
          {busy ? "Procesando…" : "Comparar ingresos"}
        </button>
        {descarga && <button className="btn-accent" onClick={bajar}>⬇ Descargar Excel</button>}
      </div>

      {error && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}

      {res && (
        <div className="mt-4 space-y-3">
          {res.avisos.length > 0 && (
            <div className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
              {res.avisos.map((a, i) => <div key={i}>• {a}</div>)}
            </div>
          )}
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="min-w-full text-[12px]">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-2 py-1.5 text-left">Empresa</th>
                  <th className="px-2 py-1.5 text-right">EECC</th>
                  <th className="px-2 py-1.5 text-right">StarSoft</th>
                  <th className="px-2 py-1.5 text-right">Caja Virtual</th>
                  <th className="px-2 py-1.5 text-right">EECC − StarSoft</th>
                  <th className="px-2 py-1.5 text-right">EECC − Caja</th>
                  <th className="px-2 py-1.5 text-right">StarSoft − Caja</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {res.filas.map((f) => (
                  <tr key={f.empresa} className="hover:bg-slate-50">
                    <td className="px-2 py-1 font-medium text-slate-700">{f.empresa}</td>
                    <td className="px-2 py-1 text-right tabular-nums text-slate-600">{money(f.eecc)}</td>
                    <td className="px-2 py-1 text-right tabular-nums text-slate-600">{money(f.starsoft)}</td>
                    <td className="px-2 py-1 text-right tabular-nums text-slate-600">{money(f.caja)}</td>
                    <DifCell v={dif(f.eecc, f.starsoft)} />
                    <DifCell v={dif(f.eecc, f.caja)} />
                    <DifCell v={dif(f.starsoft, f.caja)} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-slate-400">
            Diferencias en <span className="font-semibold text-amber-600">ámbar</span> ≥ S/ 0.50. El Excel trae ambas hojas con el detalle.
          </p>
        </div>
      )}
    </section>
  );
}
