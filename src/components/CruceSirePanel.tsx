"use client";

import { useState } from "react";
import type {
  CruceLibro,
  EstadoFila,
  FilaCruce,
  ResultadoCruce,
  TipoLibro,
} from "@/lib/cruceSire";
import { fmtSoles } from "./ui";

const CAMPOS = ["sireCompras", "sireVentas", "contableCompras", "contableVentas"] as const;
type Campo = (typeof CAMPOS)[number];

const ESTADO_LABEL: Record<EstadoFila, string> = {
  ok: "Coincide",
  "dif-monto": "Diferencia de montos",
  "dif-fecha": "Diferencia de fecha",
  "solo-sire": "Solo en SIRE",
  "solo-contable": "Solo en contable",
};

const ESTADO_STYLE: Record<EstadoFila, string> = {
  ok: "bg-emerald-100 text-emerald-700",
  "dif-monto": "bg-red-100 text-red-700",
  "dif-fecha": "bg-amber-100 text-amber-700",
  "solo-sire": "bg-orange-100 text-orange-700",
  "solo-contable": "bg-orange-100 text-orange-700",
};

export default function CruceSirePanel({ clienteId }: { clienteId?: string }) {
  const base = clienteId ? `/api/clientes/${clienteId}/cruce-sire` : `/api/cruce-sire`;
  const [files, setFiles] = useState<Record<Campo, File | null>>({
    sireCompras: null,
    sireVentas: null,
    contableCompras: null,
    contableVentas: null,
  });
  const [busy, setBusy] = useState<"cruzar" | "excel" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResultadoCruce | null>(null);

  const algunArchivo = CAMPOS.some((c) => files[c]);

  function setFile(campo: Campo, f: File | null) {
    setFiles((prev) => ({ ...prev, [campo]: f }));
  }

  async function cruzar() {
    setBusy("cruzar");
    setError(null);
    setResultado(null);
    try {
      const fd = new FormData();
      CAMPOS.forEach((c) => {
        const f = files[c];
        if (f) fd.append(c, f);
      });
      const res = await fetch(`${base}`, {
        method: "POST",
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "No se pudo cruzar.");
        return;
      }
      setResultado(data.resultado);
    } catch {
      setError("Error de red al cruzar los archivos.");
    } finally {
      setBusy(null);
    }
  }

  async function descargarExcel() {
    if (!resultado) return;
    setBusy("excel");
    setError(null);
    try {
      const res = await fetch(`${base}/excel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resultado }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "No se pudo generar el Excel.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const periodo = resultado.periodo ?? "comparativo";
      a.download = `cruce-sire-contable-${periodo}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError("Error de red al generar el Excel.");
    } finally {
      setBusy(null);
    }
  }

  const trabajando = busy !== null;

  return (
    <section className="card p-5">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="font-semibold text-slate-800">Cruce SIRE vs Sistema contable</h2>
        <span className="badge bg-slate-100 text-slate-500">Excel · comprobante × comprobante</span>
      </div>
      <p className="mb-4 text-xs text-slate-400">
        Sube el <strong>SIRE</strong> (RCE/RVIE de SUNAT) y el <strong>libro de Contasis</strong>{" "}
        del mismo periodo. Se emparejan por <strong>serie‑número + RUC</strong> y se comparan
        fecha, base, IGV y total para detectar lo que falta o no cuadra antes de declarar.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <GrupoLibro
          titulo="Compras"
          sire={files.sireCompras}
          contable={files.contableCompras}
          onSire={(f) => setFile("sireCompras", f)}
          onContable={(f) => setFile("contableCompras", f)}
          disabled={trabajando}
        />
        <GrupoLibro
          titulo="Ventas"
          sire={files.sireVentas}
          contable={files.contableVentas}
          onSire={(f) => setFile("sireVentas", f)}
          onContable={(f) => setFile("contableVentas", f)}
          disabled={trabajando}
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button className="btn-primary" onClick={cruzar} disabled={trabajando || !algunArchivo}>
          {busy === "cruzar" ? "Cruzando…" : "Cruzar y comparar"}
        </button>
        {resultado && (
          <button className="btn-ghost" onClick={descargarExcel} disabled={trabajando}>
            {busy === "excel" ? "Generando…" : "⬇ Descargar Excel"}
          </button>
        )}
      </div>

      {error && (
        <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>
      )}

      {resultado && (
        <div className="mt-5 space-y-5">
          {resultado.compras && <LibroResultado libro={resultado.compras} />}
          {resultado.ventas && <LibroResultado libro={resultado.ventas} />}
        </div>
      )}
    </section>
  );
}

function GrupoLibro({
  titulo,
  sire,
  contable,
  onSire,
  onContable,
  disabled,
}: {
  titulo: string;
  sire: File | null;
  contable: File | null;
  onSire: (f: File | null) => void;
  onContable: (f: File | null) => void;
  disabled: boolean;
}) {
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <p className="mb-2 text-sm font-semibold text-slate-700">{titulo}</p>
      <FileInput label="SIRE (SUNAT)" file={sire} onChange={onSire} disabled={disabled} />
      <div className="h-2" />
      <FileInput label="Contasis" file={contable} onChange={onContable} disabled={disabled} />
    </div>
  );
}

function FileInput({
  label,
  file,
  onChange,
  disabled,
}: {
  label: string;
  file: File | null;
  onChange: (f: File | null) => void;
  disabled: boolean;
}) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <input
        type="file"
        accept=".xlsx,.xls,.zip,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/zip"
        disabled={disabled}
        className="block w-full text-xs text-slate-500 file:mr-3 file:rounded-md file:border-0 file:bg-brand-50 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-brand-700 hover:file:bg-brand-100"
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
      />
      {file && <span className="mt-1 block truncate text-[11px] text-emerald-600">✓ {file.name}</span>}
    </label>
  );
}

function LibroResultado({ libro }: { libro: CruceLibro }) {
  const titulo = libro.libro === "compras" ? "Compras" : "Ventas";
  const problematicas = libro.filas.filter((f) => f.estado !== "ok");
  const hayDif = problematicas.length > 0;

  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700">{titulo}</h3>
        {hayDif ? (
          <span className="badge bg-red-100 text-red-700">{problematicas.length} por revisar</span>
        ) : (
          <span className="badge bg-emerald-100 text-emerald-700">✓ Todo cuadra</span>
        )}
      </div>

      {/* Resumen de totales SIRE vs contable */}
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase text-slate-400">
            <th className="py-1">Concepto</th>
            <th className="py-1 text-right">SIRE</th>
            <th className="py-1 text-right">Contable</th>
            <th className="py-1 text-right">Diferencia</th>
          </tr>
        </thead>
        <tbody>
          <FilaTotal
            concepto="N° comprobantes"
            sire={libro.totalesSire.comprobantes}
            cont={libro.totalesContable.comprobantes}
            entero
          />
          <FilaTotal concepto="Base gravada" sire={libro.totalesSire.baseGravada} cont={libro.totalesContable.baseGravada} />
          <FilaTotal concepto="IGV" sire={libro.totalesSire.igv} cont={libro.totalesContable.igv} />
          <FilaTotal concepto="No gravadas" sire={libro.totalesSire.noGravado} cont={libro.totalesContable.noGravado} />
          <FilaTotal concepto="Total" sire={libro.totalesSire.total} cont={libro.totalesContable.total} negrita />
        </tbody>
      </table>

      <p className="mt-2 text-[11px] text-slate-400">
        Coinciden: {libro.ok} · Dif. montos: {libro.difMonto} · Dif. fecha: {libro.difFecha} · Solo
        SIRE: {libro.soloSire} · Solo contable: {libro.soloContable}
      </p>

      {hayDif && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase text-slate-400">
                <th className="px-2 py-1">Estado</th>
                <th className="px-2 py-1">Comprobante</th>
                <th className="px-2 py-1">Contraparte</th>
                <th className="px-2 py-1">Detalle</th>
              </tr>
            </thead>
            <tbody>
              {problematicas.slice(0, 50).map((f) => (
                <FilaDif key={f.clave} fila={f} />
              ))}
            </tbody>
          </table>
          {problematicas.length > 50 && (
            <p className="mt-2 text-[11px] text-slate-400">
              … y {problematicas.length - 50} más. Descarga el Excel para verlas todas.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function FilaTotal({
  concepto,
  sire,
  cont,
  entero,
  negrita,
}: {
  concepto: string;
  sire: number;
  cont: number;
  entero?: boolean;
  negrita?: boolean;
}) {
  const dif = Math.round((sire - cont) * 100) / 100;
  const hayDif = Math.abs(dif) > 0.005;
  const fmt = (n: number) => (entero ? String(n) : fmtSoles(n));
  return (
    <tr className={`border-t border-slate-100 ${negrita ? "font-bold text-slate-800" : ""}`}>
      <td className="py-1 text-slate-600">{concepto}</td>
      <td className="py-1 text-right tabular-nums text-slate-700">{fmt(sire)}</td>
      <td className="py-1 text-right tabular-nums text-slate-700">{fmt(cont)}</td>
      <td
        className={`py-1 text-right tabular-nums font-medium ${
          hayDif ? "text-red-600" : "text-emerald-600"
        }`}
      >
        {fmt(dif)}
      </td>
    </tr>
  );
}

function FilaDif({ fila }: { fila: FilaCruce }) {
  return (
    <tr className="border-t border-slate-100 align-top">
      <td className="px-2 py-1">
        <span className={`badge ${ESTADO_STYLE[fila.estado]}`}>{ESTADO_LABEL[fila.estado]}</span>
      </td>
      <td className="px-2 py-1 tabular-nums text-slate-700">
        {fila.serie}-{fila.numero}
        {fila.tipoDoc === "7" && <span className="ml-1 text-slate-400">(NC)</span>}
      </td>
      <td className="px-2 py-1 text-slate-600">
        <span className="block tabular-nums text-slate-500">{fila.rucContraparte}</span>
        <span className="block truncate">{fila.razonSocial}</span>
      </td>
      <td className="px-2 py-1 text-slate-600">{fila.observaciones.join(" · ")}</td>
    </tr>
  );
}
