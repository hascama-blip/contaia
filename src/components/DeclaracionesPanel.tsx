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

/** Borrador editable (DJ sin periodo detectado o ingreso manual). */
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

  // DJ subidas a las que no se les detectó el periodo (o ingreso manual): se
  // completan a mano antes de guardar.
  const [pendientes, setPendientes] = useState<Borrador[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resumen, setResumen] = useState<string | null>(null);
  const [diagModo, setDiagModo] = useState(false);
  const [diag, setDiag] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const sirePorPeriodo = new Map(sire.map((s) => [s.periodo, s]));

  function mergeDeclaracion(prev: DeclaracionMensual[], d: DeclaracionMensual) {
    return [d, ...prev.filter((x) => x.periodo !== d.periodo)].sort((a, b) =>
      b.periodo.localeCompare(a.periodo)
    );
  }

  async function subirArchivos(lista: FileList) {
    setBusy("upload");
    setError(null);
    setResumen(null);
    setDiag(null);
    try {
      const fd = new FormData();
      Array.from(lista).forEach((f) => fd.append("file", f));
      fd.append("autoguardar", "true");
      if (diagModo) fd.append("diagnostico", "true");
      const res = await fetch(`/api/clientes/${clienteId}/declaraciones`, {
        method: "POST",
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "No se pudieron leer los PDF.");
        return;
      }
      if (data.diag) setDiag(JSON.stringify(data.diag, null, 2));

      const resultados: any[] = data.resultados ?? [];
      let guardadas = 0;
      const nuevasPend: Borrador[] = [];
      const errores: string[] = [];
      setDeclaraciones((prev) => {
        let acc = prev;
        for (const r of resultados) {
          if (r.ok && r.declaracion) {
            acc = mergeDeclaracion(acc, r.declaracion);
            guardadas++;
          } else if (r.borrador) {
            nuevasPend.push({ ...BORRADOR_VACIO, ...r.borrador });
          } else {
            errores.push(`${r.archivo}: ${r.motivo ?? "error"}`);
          }
        }
        return acc;
      });
      setPendientes((prev) => [...prev, ...nuevasPend]);

      const partes = [`✅ ${guardadas} guardada(s)`];
      if (nuevasPend.length) partes.push(`⚠ ${nuevasPend.length} sin periodo (complétalas)`);
      if (errores.length) partes.push(`⛔ ${errores.length} con error`);
      setResumen(partes.join(" · "));
      if (errores.length) setError(errores.join(" | "));
      router.refresh();
    } catch {
      setError("Error de red al subir los PDF.");
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function guardarPendiente(idx: number, b: Borrador) {
    if (!/^\d{6}$/.test(b.periodo)) {
      setError("Indica el mes y año de esa declaración.");
      return;
    }
    setBusy("save");
    setError(null);
    try {
      const res = await fetch(`/api/clientes/${clienteId}/declaraciones`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ declaracion: b }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "No se pudo guardar.");
        return;
      }
      setDeclaraciones((prev) => mergeDeclaracion(prev, data.declaracion));
      setPendientes((prev) => prev.filter((_, i) => i !== idx));
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
  const conDiferencias = declaraciones.filter((d) =>
    compararDeclaracionSire(d, sirePorPeriodo.get(d.periodo) ?? null).hayDiferencias
  ).length;

  return (
    <section className="card p-5">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="font-semibold text-slate-800">Declaraciones vs SIRE</h2>
        <span className="badge bg-slate-100 text-slate-500">PDF · Formulario 621</span>
      </div>
      <p className="mb-4 text-xs text-slate-400">
        Sube <strong>una o varias DJ</strong> (PDF con capa de texto). Cada una detecta
        su <strong>periodo</strong> sola, se guarda y se <strong>compara contra el SIRE</strong>
        {" "}del mismo mes. No necesitas elegir mes ni subirlas de a una.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf"
          multiple
          className="hidden"
          onChange={(e) => e.target.files?.length && subirArchivos(e.target.files)}
        />
        <button
          className="btn-primary"
          onClick={() => fileRef.current?.click()}
          disabled={trabajando}
        >
          {busy === "upload" ? "Leyendo…" : "⬆ Subir DJ (una o varias)"}
        </button>
        <button
          className="btn-ghost"
          onClick={() => {
            setPendientes((prev) => [...prev, { ...BORRADOR_VACIO }]);
            setError(null);
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

      {resumen && (
        <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">{resumen}</div>
      )}
      {error && (
        <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>
      )}

      {/* Pendientes: completar periodo (solo si no se detectó) */}
      {pendientes.map((b, i) => (
        <BorradorForm
          key={i}
          borrador={b}
          onChange={(nb) =>
            setPendientes((prev) => prev.map((x, j) => (j === i ? nb : x)))
          }
          onGuardar={() => guardarPendiente(i, b)}
          onDescartar={() => setPendientes((prev) => prev.filter((_, j) => j !== i))}
          guardando={busy === "save"}
        />
      ))}

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
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-700">
              Comparativo por periodo ({declaraciones.length})
            </h3>
            {conDiferencias > 0 ? (
              <span className="badge bg-red-100 text-red-700">
                {conDiferencias} con diferencias
              </span>
            ) : (
              <span className="badge bg-emerald-100 text-emerald-700">Todo cuadra</span>
            )}
          </div>
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
  onChange,
  onGuardar,
  onDescartar,
  guardando,
}: {
  borrador: Borrador;
  onChange: (b: Borrador) => void;
  onGuardar: () => void;
  onDescartar: () => void;
  guardando: boolean;
}) {
  const hoy = new Date();
  const tienePeriodo = /^\d{6}$/.test(borrador.periodo);
  const anio = tienePeriodo ? Number(borrador.periodo.slice(0, 4)) : hoy.getFullYear();
  const mes = tienePeriodo ? Number(borrador.periodo.slice(4, 6)) : hoy.getMonth() + 1;

  function setPeriodo(m: number, a: number) {
    onChange({ ...borrador, periodo: `${a}${String(m).padStart(2, "0")}` });
  }
  function setNum(campo: keyof Borrador, v: string) {
    onChange({ ...borrador, [campo]: Number(v) || 0 } as Borrador);
  }

  return (
    <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50/40 p-4">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
        {borrador.fuente === "pdf"
          ? `${borrador.archivoNombre ?? "PDF"} — indica el periodo`
          : "Ingreso manual"}
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
      <div className="mt-3 flex gap-2">
        <button className="btn-primary" onClick={onGuardar} disabled={guardando}>
          {guardando ? "Guardando…" : "Guardar declaración"}
        </button>
        <button className="btn-ghost" onClick={onDescartar} disabled={guardando}>
          Descartar
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
  const inconsistencias = comp.filas.filter((f) => f.estado === "alerta");
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
            <th className="py-1 text-right">%</th>
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
              <td
                className={`py-1 text-right tabular-nums ${
                  f.estado === "alerta" ? "text-red-600" : "text-slate-400"
                }`}
              >
                {f.estado === "sin-sire" ? "—" : `${f.porcentaje.toFixed(1)}%`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {sire && inconsistencias.length > 0 && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          <span className="font-semibold">Inconsistencias:</span>{" "}
          {inconsistencias
            .map((f) => `${f.concepto} (${f.diferencia > 0 ? "+" : ""}${fmtSoles(f.diferencia)})`)
            .join(" · ")}
        </div>
      )}
    </div>
  );
}
