"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface FilaRes { fila: number; ruc: string; estado: "creado" | "duplicado" | "error"; razonSocial?: string; motivo?: string }
interface Resumen { creados: number; duplicados: number; errores: number; resultados: FilaRes[] }

const BADGE: Record<string, string> = {
  creado: "bg-emerald-100 text-emerald-700",
  duplicado: "bg-amber-100 text-amber-700",
  error: "bg-red-100 text-red-700",
};

export default function ImportarClientes() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [res, setRes] = useState<Resumen | null>(null);

  async function importar() {
    if (!file) { setError("Elige un archivo .xlsx"); return; }
    setBusy(true); setError(null); setRes(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/clientes/importar", { method: "POST", body: fd });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) { setError(data.error ?? "No se pudo importar."); return; }
      setRes(data);
      router.refresh();
    } catch {
      setError("Se cortó la conexión durante la importación.");
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-5">
      <div className="card p-5">
        <h2 className="font-semibold text-slate-800">Carga masiva de empresas (Excel)</h2>
        <p className="mt-1 text-sm text-slate-500">
          Sube un <b>.xlsx</b> con una empresa por fila. La <b>primera fila son los encabezados</b>.
          Columnas reconocidas (en cualquier orden):
        </p>
        <ul className="mt-2 list-disc pl-5 text-sm text-slate-600">
          <li><b>RUC</b> (obligatorio, 11 dígitos)</li>
          <li><b>Razón social</b> (opcional; si falta, queda "por verificar")</li>
          <li><b>Email</b>, <b>Teléfono</b> (opcionales)</li>
          <li><b>Usuario SOL</b> (opcional)</li>
          <li><b>client_id</b>, <b>client_secret</b> (API SIRE, opcionales)</li>
        </ul>
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          🔒 La <b>Clave SOL no se carga</b> por seguridad (se ingresa por sesión al extraer).
          Tras importar, usa <b>“Actualizar”</b> en cada empresa para traer sus datos SUNAT.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx"
            onChange={(e) => { setFile(e.target.files?.[0] ?? null); setRes(null); setError(null); }}
            className="text-sm"
          />
          <button className="btn-primary" onClick={importar} disabled={busy || !file}>
            {busy ? "Importando…" : "Importar"}
          </button>
        </div>
        {error && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
      </div>

      {res && (
        <div className="card p-5">
          <div className="mb-3 flex flex-wrap gap-2 text-sm">
            <span className="rounded-lg bg-emerald-100 px-3 py-1 font-semibold text-emerald-700">✅ {res.creados} creada(s)</span>
            <span className="rounded-lg bg-amber-100 px-3 py-1 font-semibold text-amber-700">↺ {res.duplicados} duplicada(s)</span>
            <span className="rounded-lg bg-red-100 px-3 py-1 font-semibold text-red-700">⚠ {res.errores} con error</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-400">
                <tr>
                  <th className="px-3 py-2">Fila</th>
                  <th className="px-3 py-2">RUC</th>
                  <th className="px-3 py-2">Estado</th>
                  <th className="px-3 py-2">Detalle</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {res.resultados.map((x, i) => (
                  <tr key={i}>
                    <td className="px-3 py-2 text-slate-500">{x.fila}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-700">{x.ruc}</td>
                    <td className="px-3 py-2"><span className={`badge ${BADGE[x.estado]}`}>{x.estado}</span></td>
                    <td className="px-3 py-2 text-slate-500">{x.razonSocial || x.motivo || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
