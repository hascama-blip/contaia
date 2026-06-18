"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Deuda } from "@/lib/types";
import { fmtSoles } from "./ui";

const TIPOS = [
  "Cobranza coactiva",
  "Multa / infracción",
  "Fraccionamiento",
  "IGV",
  "Renta",
  "EsSalud",
  "ONP",
  "Detracción",
  "Valor / resolución",
  "Otra",
];

interface Borrador {
  tipo: string;
  descripcion: string;
  monto: number;
  periodo: string;
  entidad: string;
  fuente: "ocr" | "manual";
  ocrTexto?: string;
}

const VACIO: Borrador = {
  tipo: "",
  descripcion: "",
  monto: 0,
  periodo: "",
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
  const [borrador, setBorrador] = useState<Borrador | null>(null);
  const [montosDet, setMontosDet] = useState<number[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nota, setNota] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const total = deudas.reduce((a, d) => a + d.monto, 0);

  async function subirFoto(file: File) {
    setBusy("ocr");
    setError(null);
    setNota(null);
    setMontosDet([]);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/clientes/${clienteId}/deudas`, { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "No se pudo leer la imagen.");
        return;
      }
      setBorrador({ ...VACIO, ...data.borrador });
      setMontosDet(data.montosDetectados ?? []);
      if (data.sinTexto)
        setNota("No se reconoció texto en la foto. Indica el tipo y el monto a mano.");
    } catch {
      setError("Error de red al subir la foto.");
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function guardar() {
    if (!borrador) return;
    if (!borrador.tipo.trim()) {
      setError("Elige el tipo de deuda.");
      return;
    }
    setBusy("save");
    setError(null);
    try {
      const res = await fetch(`/api/clientes/${clienteId}/deudas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deuda: borrador }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "No se pudo guardar.");
        return;
      }
      setDeudas((prev) => [data.deuda, ...prev]);
      setBorrador(null);
      setMontosDet([]);
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

  return (
    <section className="card p-5">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="font-semibold text-slate-800">Deudas tributarias</h2>
        <span className="badge bg-slate-100 text-slate-500">Foto · OCR</span>
      </div>
      <p className="mb-4 text-xs text-slate-400">
        Sube una <strong>foto o captura</strong> de la deuda (notificación, estado de cuenta,
        resolución): se lee con OCR y tú <strong>confirmas el tipo y el monto</strong>. También
        puedes ingresarla a mano.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && subirFoto(e.target.files[0])}
        />
        <button className="btn-primary" onClick={() => fileRef.current?.click()} disabled={trabajando}>
          {busy === "ocr" ? "Leyendo foto…" : "📷 Subir foto de deuda"}
        </button>
        <button
          className="btn-ghost"
          onClick={() => {
            setBorrador({ ...VACIO });
            setMontosDet([]);
            setError(null);
            setNota(null);
          }}
          disabled={trabajando}
        >
          ✎ Ingresar a mano
        </button>
      </div>

      {error && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
      {nota && <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">{nota}</div>}

      {/* Borrador editable */}
      {borrador && (
        <div className="mt-4 rounded-lg border border-brand-200 bg-brand-50/40 p-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
            {borrador.fuente === "ocr" ? "Leído de la foto — confirma los datos" : "Ingreso manual"}
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="col-span-2">
              <label className="label">Tipo de deuda</label>
              <select
                className="input"
                value={borrador.tipo}
                onChange={(e) => setBorrador({ ...borrador, tipo: e.target.value })}
              >
                <option value="">— Elige —</option>
                {TIPOS.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Monto (S/)</label>
              <input
                className="input"
                type="number"
                step="0.01"
                value={borrador.monto}
                onChange={(e) => setBorrador({ ...borrador, monto: Number(e.target.value) || 0 })}
              />
            </div>
            <div>
              <label className="label">Periodo</label>
              <input
                className="input"
                value={borrador.periodo}
                placeholder="03/2024"
                onChange={(e) => setBorrador({ ...borrador, periodo: e.target.value })}
              />
            </div>
            <div className="col-span-2 sm:col-span-3">
              <label className="label">Descripción</label>
              <input
                className="input"
                value={borrador.descripcion}
                placeholder="Detalle de la deuda"
                onChange={(e) => setBorrador({ ...borrador, descripcion: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Entidad</label>
              <input
                className="input"
                value={borrador.entidad}
                onChange={(e) => setBorrador({ ...borrador, entidad: e.target.value })}
              />
            </div>
          </div>

          {montosDet.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <span className="text-slate-400">Montos detectados:</span>
              {montosDet.map((m, i) => (
                <button
                  key={i}
                  className="rounded-full border border-slate-200 bg-white px-2 py-0.5 hover:border-brand-300"
                  onClick={() => setBorrador({ ...borrador, monto: m })}
                >
                  {fmtSoles(m)}
                </button>
              ))}
            </div>
          )}

          <div className="mt-3 flex gap-2">
            <button className="btn-primary" onClick={guardar} disabled={busy === "save"}>
              {busy === "save" ? "Guardando…" : "Guardar deuda"}
            </button>
            <button className="btn-ghost" onClick={() => setBorrador(null)} disabled={busy === "save"}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Lista de deudas */}
      {deudas.length > 0 && (
        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-700">Deudas registradas ({deudas.length})</h3>
            <span className="text-sm font-bold text-red-600">Total: {fmtSoles(total)}</span>
          </div>
          <ul className="space-y-2">
            {deudas.map((d) => (
              <li key={d.id} className="flex items-start justify-between gap-2 rounded-lg border border-slate-200 p-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="badge bg-red-100 text-red-700">{d.tipo}</span>
                    {d.periodo && <span className="text-xs text-slate-400">{d.periodo}</span>}
                    {d.entidad && <span className="text-xs text-slate-400">· {d.entidad}</span>}
                  </div>
                  {d.descripcion && <p className="mt-1 text-sm text-slate-600">{d.descripcion}</p>}
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
      )}
    </section>
  );
}
