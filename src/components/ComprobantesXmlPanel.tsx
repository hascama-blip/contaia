"use client";

import { useState } from "react";
import { getSolPass, getSolUser } from "@/lib/solSession";

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Setiembre", "Octubre", "Noviembre", "Diciembre"];

// Descarga los XML de comprobantes RECIBIDOS (compras) de un periodo desde SUNAT
// SOL y los arma en un Excel (reusa el Excel de detalle de facturas XML).
export default function ComprobantesXmlPanel({ clienteId }: { clienteId: string }) {
  const hoy = new Date();
  const [mes, setMes] = useState(hoy.getMonth() + 1);
  const [anio, setAnio] = useState(hoy.getFullYear());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [diagModo, setDiagModo] = useState(false);
  const [diag, setDiag] = useState<string | null>(null);
  const [facturas, setFacturas] = useState<any[]>([]);
  const [relacion, setRelacion] = useState<any[]>([]);
  const [relNombre, setRelNombre] = useState<string | null>(null);

  async function subirRelacion(file: File) {
    setError(null); setInfo(null);
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/comprobantes-xml/parsear", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? "No se pudo leer la relación."); return; }
      setRelacion(data.items ?? []);
      setRelNombre(file.name);
      setInfo(`Relación cargada: ${data.total} comprobante(s) por descargar.`);
    } catch {
      setError("Error de red al subir la relación.");
    } finally {
      setBusy(false);
    }
  }

  async function extraer() {
    setError(null); setInfo(null); setDiag(null);
    const solPass = getSolPass(clienteId);
    const solUser = getSolUser(clienteId);
    if (!solPass) { setError("Carga tus accesos SOL (arriba) para descargar los XML."); return; }
    const periodo = `${anio}${String(mes).padStart(2, "0")}`;
    setBusy(true);
    setFacturas([]);
    try {
      const res = await fetch(`/api/clientes/${clienteId}/comprobantes-xml`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ solUser, solPass, periodo, relacion, diagnostico: diagModo }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.diag) setDiag(JSON.stringify(data.diag, null, 2));
      if (!res.ok) { setError(data.error ?? "No se pudo descargar los comprobantes."); return; }
      setFacturas(data.facturas ?? []);
      setInfo(
        data.descargados
          ? `${data.descargados} comprobante(s) descargado(s).`
          : data.error ?? "Sin comprobantes (revisa el diagnóstico)."
      );
    } catch {
      setError("Error de red al descargar los comprobantes.");
    } finally {
      setBusy(false);
    }
  }

  async function descargarExcel() {
    setBusy(true);
    try {
      const res = await fetch("/api/facturas-xml/excel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ facturas, detalle: true }),
      });
      if (!res.ok) { setError("No se pudo generar el Excel."); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `comprobantes-${anio}${String(mes).padStart(2, "0")}.xlsx`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  }

  const anios = [hoy.getFullYear(), hoy.getFullYear() - 1, hoy.getFullYear() - 2];

  return (
    <section className="card p-5">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="font-semibold text-slate-800">Comprobantes recibidos (XML) desde SUNAT</h2>
        <span className="badge bg-slate-100 text-slate-500">Solo Usuario + Clave SOL</span>
      </div>
      <p className="mb-4 text-xs text-slate-400">
        Sube una <strong>relación de comprobantes</strong> (o elige un periodo). El sistema descarga sus
        <strong> XML de compras</strong> directo de SUNAT (Consulta de comprobantes, SEE-SOL) y los arma
        en un <strong>Excel</strong> con el detalle de cada factura.
      </p>

      {/* Relación de comprobantes: descargar plantilla + subir la llena */}
      <div className="mb-4 rounded-lg border border-brand-200 bg-brand-50/40 p-3">
        <p className="mb-2 text-xs font-semibold text-brand-800">Relación de comprobantes a descargar</p>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href="/api/comprobantes-xml/plantilla"
            className="btn-ghost text-sm"
            download
          >
            ⬇ Descargar plantilla (Excel)
          </a>
          <label className={`btn-primary cursor-pointer text-sm ${busy ? "pointer-events-none opacity-50" : ""}`}>
            ⬆ Subir relación llena
            <input
              type="file"
              accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) subirRelacion(f); e.currentTarget.value = ""; }}
            />
          </label>
          {relNombre && (
            <span className="text-xs text-emerald-700">
              ✓ {relNombre} · {relacion.length} comprobante(s)
              <button className="ml-2 text-slate-400 underline" onClick={() => { setRelacion([]); setRelNombre(null); }}>quitar</button>
            </span>
          )}
        </div>
        <p className="mt-2 text-[10px] text-slate-400">
          Descarga la plantilla, complétala (RUC emisor, tipo, serie, número, fecha, monto) y súbela.
          Si no subes relación, se usa el periodo de abajo.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="label">Mes</label>
          <select className="input" value={mes} onChange={(e) => setMes(Number(e.target.value))}>
            {MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Año</label>
          <select className="input" value={anio} onChange={(e) => setAnio(Number(e.target.value))}>
            {anios.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <button className="btn-primary" onClick={extraer} disabled={busy}>
          {busy ? "Descargando…" : "⬇ Descargar XML de SUNAT"}
        </button>
        {facturas.length > 0 && (
          <button className="btn-ghost" onClick={descargarExcel} disabled={busy}>
            ⬇ Excel con el detalle
          </button>
        )}
        <label className="ml-auto flex items-center gap-2 text-xs text-slate-500">
          <input type="checkbox" checked={diagModo} onChange={(e) => setDiagModo(e.target.checked)} />
          Modo diagnóstico
        </label>
      </div>

      {info && <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">{info}</div>}
      {error && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
      {diag && <pre className="mt-3 max-h-96 overflow-auto rounded-lg bg-slate-900 p-3 text-[11px] text-slate-100">{diag}</pre>}

      {facturas.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[560px] text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase text-slate-400">
                <th className="py-1">Serie-Número</th>
                <th className="py-1">Fecha</th>
                <th className="py-1">Proveedor</th>
                <th className="py-1 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {facturas.map((f, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="py-1 text-slate-600">{f.serieNumero}</td>
                  <td className="py-1 text-slate-500">{f.fecha}</td>
                  <td className="py-1 text-slate-600">{f.razonSocialEmisor || f.rucEmisor}</td>
                  <td className="py-1 text-right tabular-nums text-slate-700">{Number(f.total).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
