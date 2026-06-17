"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { DeclaracionMensual, SireResumen } from "@/lib/types";
import { compararDeclaracionSire } from "@/lib/declaracion";
import { fmtSoles } from "./ui";

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Setiembre", "Octubre", "Noviembre", "Diciembre",
];

function etiqueta(periodo: string): string {
  if (!/^\d{6}$/.test(periodo)) return periodo || "—";
  const anio = periodo.slice(0, 4);
  const mes = Number(periodo.slice(4, 6));
  return `${MESES[mes - 1] ?? "?"} ${anio}`;
}

/** Borrador editable de una declaración (antes de guardar). */
interface Borrador {
  periodo: string;
  ruc?: string;
  formulario?: string;
  ventasBase: number;
  ventasIgv: number;
  comprasBase: number;
  comprasIgv: number;
  casillas: { codigo: string; monto: number }[];
  fuente: "pdf" | "manual";
  archivoNombre?: string;
}

const BORRADOR_VACIO: Borrador = {
  periodo: "",
  ventasBase: 0,
  ventasIgv: 0,
  comprasBase: 0,
  comprasIgv: 0,
  casillas: [],
  fuente: "manual",
};

export default function DeclaracionesPanel({
  clienteId,
  inicialDeclaraciones,
  inicialSire,
}: {
  clienteId: string;
  inicialDeclaraciones: DeclaracionMensual[];
  inicialSire: SireResumen[];
}) {
  const router = useRouter();
  const [declaraciones, setDeclaraciones] = useState<DeclaracionMensual[]>(
    inicialDeclaraciones ?? []
  );
  const sire = inicialSire ?? [];

  const [borrador, setBorrador] = useState<Borrador | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nota, setNota] = useState<string | null>(null);
  const [diagModo, setDiagModo] = useState(false);
  const [diag, setDiag] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const sirePorPeriodo = new Map(sire.map((s) => [s.periodo, s]));

  async function subirPdf(file: File) {
    setBusy("upload");
    setError(null);
    setNota(null);
    setDiag(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (diagModo) fd.append("diagnostico", "true");
      const res = await fetch(`/api/clientes/${clienteId}/declaraciones`, {
        method: "POST",
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "No se pudo leer el PDF.");
        return;
      }
      if (data.diag) setDiag(JSON.stringify(data.diag, null, 2));
      if (data.sinTexto) setNota(data.mensaje);
      setBorrador({ ...BORRADOR_VACIO, ...data.borrador });
    } catch {
      setError("Error de red al subir el PDF.");
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function guardar() {
    if (!borrador) return;
    if (!/^\d{6}$/.test(borrador.periodo)) {
      setError("Indica el periodo (mes y año) de la declaración.");
      return;
    }
    setBusy("save");
    setError(null);
    try {
      const res = await fetch(`/api/clientes/${clienteId}/declaraciones`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ declaracion: borrador }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "No se pudo guardar.");
        return;
      }
      const d: DeclaracionMensual = data.declaracion;
      setDeclaraciones((prev) => [d, ...prev.filter((x) => x.periodo !== d.periodo)]);
      setBorrador(null);
      setDiag(null);
      setNota(null);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function eliminar(id: string) {
    setBusy("del");
    try {
      const res = await fetch(
        `/api/clientes/${clienteId}/declaraciones?declId=${id}`,
        { method: "DELETE" }
      );
      if (res.ok) setDeclaraciones((prev) => prev.filter((d) => d.id !== id));
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  const trabajando = busy !== null;

  return (
    <section className="card p-5">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="font-semibold text-slate-800">Declaraciones vs SIRE</h2>
        <span className="badge bg-slate-100 text-slate-500">PDF · Formulario 621</span>
      </div>
      <p className="mb-4 text-xs text-slate-400">
        Sube el <strong>PDF de la declaración mensual</strong> (con capa de texto, no foto):
        se lee directo —sin OCR— y se <strong>compara contra el SIRE</strong> del mismo
        periodo. Confirma los montos antes de guardar.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && subirPdf(e.target.files[0])}
        />
        <button
          className="btn-primary"
          onClick={() => fileRef.current?.click()}
          disabled={trabajando}
        >
          {busy === "upload" ? "Leyendo…" : "⬆ Subir PDF de declaración"}
        </button>
        <button
          className="btn-ghost"
          onClick={() => {
            setBorrador({ ...BORRADOR_VACIO });
            setError(null);
            setNota(null);
            setDiag(null);
          }}
          disabled={trabajando}
        >
          ✎ Ingresar manual
        </button>
        <label className="ml-auto flex items-center gap-2 text-xs text-slate-500">
          <input
            type="checkbox"
            checked={diagModo}
            onChange={(e) => setDiagModo(e.target.checked)}
          />
          Modo diagnóstico
        </label>
      </div>

      {error && (
        <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>
      )}
      {nota && (
        <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">{nota}</div>
      )}

      {/* Borrador editable */}
      {borrador && (
        <BorradorForm
          borrador={borrador}
          setBorrador={setBorrador}
          onGuardar={guardar}
          onCancelar={() => setBorrador(null)}
          guardando={busy === "save"}
        />
      )}

      {diag && (
        <details className="mt-3" open>
          <summary className="cursor-pointer text-xs font-semibold text-slate-500">
            Diagnóstico — texto y casillas detectadas
          </summary>
          <pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-slate-900 p-3 text-[11px] text-slate-100">
            {diag}
          </pre>
        </details>
      )}

      {/* Declaraciones guardadas + comparativo */}
      {declaraciones.length > 0 && (
        <div className="mt-5 space-y-3">
          <h3 className="text-sm font-semibold text-slate-700">
            Comparativo por periodo ({declaraciones.length})
          </h3>
          {declaraciones.map((d) => (
            <ComparativoCard
              key={d.id}
              decl={d}
              sire={sirePorPeriodo.get(d.periodo) ?? null}
              onEliminar={() => eliminar(d.id)}
              eliminando={busy === "del"}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function BorradorForm({
  borrador,
  setBorrador,
  onGuardar,
  onCancelar,
  guardando,
}: {
  borrador: Borrador;
  setBorrador: (b: Borrador) => void;
  onGuardar: () => void;
  onCancelar: () => void;
  guardando: boolean;
}) {
  const hoy = new Date();
  const anio = borrador.periodo ? Number(borrador.periodo.slice(0, 4)) : hoy.getFullYear();
  const mes = borrador.periodo ? Number(borrador.periodo.slice(4, 6)) : hoy.getMonth() + 1;

  function setPeriodo(m: number, a: number) {
    setBorrador({ ...borrador, periodo: `${a}${String(m).padStart(2, "0")}` });
  }
  function setNum(campo: keyof Borrador, v: string) {
    setBorrador({ ...borrador, [campo]: Number(v) || 0 } as Borrador);
  }

  return (
    <div className="mt-4 rounded-lg border border-brand-200 bg-brand-50/40 p-4">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
        {borrador.fuente === "pdf" ? "Leído del PDF — confirma los montos" : "Ingreso manual"}
        {borrador.formulario && <> · Formulario {borrador.formulario}</>}
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <label className="label">Mes</label>
          <select
            className="input"
            value={mes}
            onChange={(e) => setPeriodo(Number(e.target.value), anio)}
          >
            {MESES.map((m, i) => (
              <option key={m} value={i + 1}>{m}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Año</label>
          <input
            className="input"
            type="number"
            min={2018}
            max={hoy.getFullYear()}
            value={anio}
            onChange={(e) => setPeriodo(mes, Number(e.target.value))}
          />
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <NumField label="Ventas · Base" value={borrador.ventasBase} onChange={(v) => setNum("ventasBase", v)} />
        <NumField label="Ventas · IGV" value={borrador.ventasIgv} onChange={(v) => setNum("ventasIgv", v)} />
        <NumField label="Compras · Base" value={borrador.comprasBase} onChange={(v) => setNum("comprasBase", v)} />
        <NumField label="Compras · IGV" value={borrador.comprasIgv} onChange={(v) => setNum("comprasIgv", v)} />
      </div>
      {borrador.casillas.length > 0 && (
        <p className="mt-2 text-xs text-slate-400">
          Casillas detectadas: {borrador.casillas.map((c) => c.codigo).join(", ")}
        </p>
      )}
      <div className="mt-3 flex gap-2">
        <button className="btn-primary" onClick={onGuardar} disabled={guardando}>
          {guardando ? "Guardando…" : "Guardar declaración"}
        </button>
        <button className="btn-ghost" onClick={onCancelar} disabled={guardando}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

function NumField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <input
        className="input"
        type="number"
        step="0.01"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function ComparativoCard({
  decl,
  sire,
  onEliminar,
  eliminando,
}: {
  decl: DeclaracionMensual;
  sire: SireResumen | null;
  onEliminar: () => void;
  eliminando: boolean;
}) {
  const comp = compararDeclaracionSire(decl, sire);
  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h4 className="font-semibold text-slate-800">{etiqueta(decl.periodo)}</h4>
          <p className="text-xs text-slate-400">
            {decl.fuente === "pdf" ? decl.archivoNombre ?? "PDF" : "Ingreso manual"}
            {!sire && " · sin SIRE de este periodo"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {sire &&
            (comp.hayDiferencias ? (
              <span className="badge bg-red-100 text-red-700">⚠ Diferencias</span>
            ) : (
              <span className="badge bg-emerald-100 text-emerald-700">✓ Cuadra</span>
            ))}
          <button
            className="text-xs text-slate-400 hover:text-red-600"
            onClick={onEliminar}
            disabled={eliminando}
            title="Eliminar"
          >
            ✕
          </button>
        </div>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase text-slate-400">
            <th className="py-1">Concepto</th>
            <th className="py-1 text-right">Declarado</th>
            <th className="py-1 text-right">SIRE</th>
            <th className="py-1 text-right">Diferencia</th>
          </tr>
        </thead>
        <tbody>
          {comp.filas.map((f) => (
            <tr key={f.concepto} className="border-t border-slate-100">
              <td className="py-1 text-slate-600">{f.concepto}</td>
              <td className="py-1 text-right tabular-nums text-slate-700">{fmtSoles(f.declarado)}</td>
              <td className="py-1 text-right tabular-nums text-slate-700">
                {f.estado === "sin-sire" ? "—" : fmtSoles(f.sire)}
              </td>
              <td
                className={`py-1 text-right font-medium tabular-nums ${
                  f.estado === "alerta"
                    ? "text-red-600"
                    : f.estado === "sin-sire"
                      ? "text-slate-300"
                      : "text-emerald-600"
                }`}
              >
                {f.estado === "sin-sire" ? "—" : fmtSoles(f.diferencia)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
