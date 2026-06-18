"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Deuda } from "@/lib/types";
import { fmtSoles } from "./ui";

const SECCIONES = [
  "Valores",
  "Deudas autoliquidadas/reliquidadas",
  "Otras deudas",
  "Deudas no acogibles",
  "Otra",
];

interface Borrador {
  tipo: string;
  seccion: string;
  codigoTributo?: string;
  numero?: string;
  descripcion: string;
  periodo: string;
  monto: number;
  entidad: string;
  fuente: "ocr" | "manual";
  archivo?: string;
}

const VACIO: Borrador = {
  tipo: "",
  seccion: "",
  descripcion: "",
  periodo: "",
  monto: 0,
  entidad: "SUNAT",
  fuente: "manual",
};

export default function DeudasPanel({
  clienteId,
  inicial,
}: {
  clienteId: string;
  inicial: Deuda[];
}) {
  const router = useRouter();
  const [deudas, setDeudas] = useState<Deuda[]>(inicial ?? []);
  const [borradores, setBorradores] = useState<Borrador[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nota, setNota] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const total = deudas.reduce((a, d) => a + d.monto, 0);

  async function subirFotos(files: FileList) {
    setBusy("ocr");
    setError(null);
    setNota(null);
    try {
      const fd = new FormData();
      Array.from(files).forEach((f) => fd.append("file", f));
      const res = await fetch(`/api/clientes/${clienteId}/deudas`, { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "No se pudieron leer las imágenes.");
        return;
      }
      const nuevos: Borrador[] = (data.borradores ?? []).map((b: any) => ({ ...VACIO, ...b }));
      setBorradores((prev) => [...prev, ...nuevos]);
      setNota(
        data.detectados
          ? `Se detectaron ${data.detectados} fila(s) de deuda. Revisa la sección y el monto, y guarda.`
          : "No se reconocieron filas. Ingresa la deuda a mano."
      );
    } catch {
      setError("Error de red al subir las fotos.");
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function setB(idx: number, patch: Partial<Borrador>) {
    setBorradores((prev) => prev.map((b, i) => (i === idx ? { ...b, ...patch } : b)));
  }

  async function guardarTodas() {
    const validas = borradores.filter((b) => b.monto > 0 || b.tipo.trim());
    if (validas.length === 0) {
      setError("No hay deudas con monto o tipo para guardar.");
      return;
    }
    setBusy("save");
    setError(null);
    try {
      const res = await fetch(`/api/clientes/${clienteId}/deudas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deudas: validas }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "No se pudo guardar.");
        return;
      }
      setDeudas((prev) => [...(data.guardadas ?? []), ...prev]);
      setBorradores([]);
      setNota(null);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function eliminar(id: string) {
    setBusy("del");
    try {
      const res = await fetch(`/api/clientes/${clienteId}/deudas?deudaId=${id}`, { method: "DELETE" });
      if (res.ok) setDeudas((prev) => prev.filter((d) => d.id !== id));
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  const trabajando = busy !== null;
  // Agrupa las deudas guardadas por sección.
  const grupos = new Map<string, Deuda[]>();
  for (const d of deudas) {
    const k = d.seccion || "Sin sección";
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k)!.push(d);
  }

  return (
    <section className="card p-5">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="font-semibold text-slate-800">Deudas tributarias</h2>
        <span className="badge bg-slate-100 text-slate-500">Fotos · OCR · F36</span>
      </div>
      <p className="mb-4 text-xs text-slate-400">
        Sube <strong>una o varias capturas</strong> del F36 (Valores, Autoliquidadas, Otras
        deudas, No acogibles). Cada foto se clasifica por su <strong>sección</strong> y se extrae
        cada fila (<strong>periodo y monto</strong>). Revisa y guarda. También puedes ingresar a mano.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => e.target.files?.length && subirFotos(e.target.files)}
        />
        <button className="btn-primary" onClick={() => fileRef.current?.click()} disabled={trabajando}>
          {busy === "ocr" ? "Leyendo fotos…" : "📷 Subir fotos de deudas"}
        </button>
        <button
          className="btn-ghost"
          onClick={() => setBorradores((prev) => [...prev, { ...VACIO }])}
          disabled={trabajando}
        >
          ✎ Ingresar a mano
        </button>
      </div>

      {error && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
      {nota && <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">{nota}</div>}

      {/* Borradores en revisión */}
      {borradores.length > 0 && (
        <div className="mt-4 rounded-lg border border-brand-200 bg-brand-50/40 p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Revisar {borradores.length} deuda(s) antes de guardar
          </p>
          <div className="space-y-2">
            {borradores.map((b, i) => (
              <div key={i} className="grid grid-cols-2 gap-2 rounded-md border border-slate-200 bg-white p-2 sm:grid-cols-12">
                <select
                  className="input sm:col-span-3"
                  value={b.seccion}
                  onChange={(e) => setB(i, { seccion: e.target.value })}
                >
                  <option value="">Sección…</option>
                  {SECCIONES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                <input
                  className="input sm:col-span-4"
                  value={b.tipo}
                  placeholder="Concepto / tributo"
                  onChange={(e) => setB(i, { tipo: e.target.value })}
                />
                <input
                  className="input sm:col-span-2"
                  value={b.periodo}
                  placeholder="Periodo"
                  onChange={(e) => setB(i, { periodo: e.target.value })}
                />
                <input
                  className="input sm:col-span-2"
                  type="number"
                  step="0.01"
                  value={b.monto}
                  onChange={(e) => setB(i, { monto: Number(e.target.value) || 0 })}
                />
                <button
                  className="text-slate-400 hover:text-red-600 sm:col-span-1"
                  onClick={() => setBorradores((prev) => prev.filter((_, j) => j !== i))}
                  title="Quitar"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <button className="btn-primary" onClick={guardarTodas} disabled={busy === "save"}>
              {busy === "save" ? "Guardando…" : `Guardar ${borradores.length} deuda(s)`}
            </button>
            <button className="btn-ghost" onClick={() => setBorradores([])} disabled={busy === "save"}>
              Descartar
            </button>
          </div>
        </div>
      )}

      {/* Deudas guardadas, agrupadas por sección */}
      {deudas.length > 0 && (
        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-700">Deudas registradas ({deudas.length})</h3>
            <span className="text-sm font-bold text-red-600">Total: {fmtSoles(total)}</span>
          </div>
          <div className="space-y-3">
            {Array.from(grupos.entries()).map(([seccion, lista]) => {
              const sub = lista.reduce((a, d) => a + d.monto, 0);
              return (
                <div key={seccion} className="overflow-hidden rounded-lg border border-slate-200">
                  <div className="flex items-center justify-between bg-brand-700 px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-white">
                    <span>{seccion}</span>
                    <span>{fmtSoles(sub)}</span>
                  </div>
                  <ul className="divide-y divide-slate-100">
                    {lista.map((d) => (
                      <li key={d.id} className="flex items-start justify-between gap-2 px-3 py-2 text-sm">
                        <div>
                          <p className="font-medium text-slate-700">{d.tipo}</p>
                          <p className="text-xs text-slate-400">
                            {d.periodo && <>Periodo {d.periodo} · </>}
                            {d.codigoTributo && <>Cód. {d.codigoTributo} · </>}
                            {d.numero && <>N° {d.numero}</>}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="font-semibold text-slate-800">{fmtSoles(d.monto)}</span>
                          <button
                            className="text-xs text-slate-400 hover:text-red-600"
                            onClick={() => eliminar(d.id)}
                            disabled={busy === "del"}
                            title="Eliminar"
                          >
                            ✕
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
