"use client";

import { useRef, useState } from "react";
import { fmtSoles } from "./ui";

interface Prov {
  ruc: string;
  razonSocial?: string;
  rubro?: string;
  cuenta: string;
  nombreCuenta?: string;
  nuevo: boolean;
}
interface Factura {
  tipo: string;
  serieNumero: string;
  fecha: string;
  ruc: string;
  razonSocial: string;
  glosa: string;
  moneda: string;
  base: number;
  igv: number;
  total: number;
  cuenta: string;
}

export default function FacturasXmlPanel() {
  const [facturas, setFacturas] = useState<Factura[]>([]);
  const [proveedores, setProveedores] = useState<Prov[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function leer(files: FileList) {
    setBusy("leer");
    setError(null);
    setInfo(null);
    setFacturas([]);
    setProveedores([]);
    try {
      const fd = new FormData();
      Array.from(files).forEach((f) => fd.append("file", f));
      const res = await fetch("/api/facturas-xml", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "No se pudieron leer los XML.");
        return;
      }
      setFacturas(data.facturas ?? []);
      setProveedores(data.proveedores ?? []);
      setInfo(`${data.leidas} factura(s) leída(s) · ${data.nuevos} proveedor(es) nuevo(s) por confirmar`);
    } catch {
      setError("Error de red al leer los XML.");
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function editarCuenta(ruc: string, cuenta: string) {
    setProveedores((prev) => prev.map((p) => (p.ruc === ruc ? { ...p, cuenta } : p)));
    setFacturas((prev) => prev.map((f) => (f.ruc === ruc ? { ...f, cuenta } : f)));
  }

  async function guardar() {
    setBusy("save");
    try {
      const cuentas = proveedores.map((p) => ({
        ruc: p.ruc,
        razonSocial: p.razonSocial,
        rubro: p.rubro,
        cuenta: p.cuenta,
        nombreCuenta: p.nombreCuenta,
        fuente: "aprendido" as const,
        actualizadoAt: new Date().toISOString(),
      }));
      const res = await fetch("/api/facturas-xml", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cuentas }),
      });
      if (res.ok) {
        setProveedores((prev) => prev.map((p) => ({ ...p, nuevo: false })));
        setInfo("✅ Cuentas aprendidas. La próxima vez se clasifican solas.");
      }
    } finally {
      setBusy(null);
    }
  }

  async function descargar() {
    setBusy("excel");
    try {
      const res = await fetch("/api/facturas-xml/excel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ facturas }),
      });
      if (!res.ok) {
        setError("No se pudo generar el Excel.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "facturas-xml.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(null);
    }
  }

  const trabajando = busy !== null;
  const nuevos = proveedores.filter((p) => p.nuevo);

  return (
    <section className="card p-5">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="font-semibold text-slate-800">Facturas (XML) → detalle + cuenta</h2>
        <span className="badge bg-slate-100 text-slate-500">XML · descripción exacta</span>
      </div>
      <p className="mb-4 text-xs text-slate-400">
        Sube los <strong>XML</strong> de las facturas (en bloque). Saca <strong>descripción
        (glosa), montos, serie‑número y RUC</strong>, y le pone la <strong>cuenta</strong> por
        rubro. Solo confirmas proveedores nuevos. Descarga listo para Contasis.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept=".xml,text/xml,application/xml"
          multiple
          className="hidden"
          onChange={(e) => e.target.files?.length && leer(e.target.files)}
        />
        <button className="btn-primary" onClick={() => fileRef.current?.click()} disabled={trabajando}>
          {busy === "leer" ? "Leyendo…" : "⬆ Subir XML de facturas"}
        </button>
        {facturas.length > 0 && (
          <>
            <button className="btn-ghost" onClick={guardar} disabled={trabajando}>
              {busy === "save" ? "Guardando…" : "💾 Guardar y aprender"}
            </button>
            <button className="btn-ghost" onClick={descargar} disabled={trabajando}>
              {busy === "excel" ? "Generando…" : "⬇ Excel para Contasis"}
            </button>
          </>
        )}
      </div>

      {info && <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">{info}</div>}
      {error && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}

      {nuevos.length > 0 && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50/40 p-3">
          <p className="mb-2 text-sm font-semibold text-red-700">
            🆕 Proveedores nuevos por confirmar ({nuevos.length})
          </p>
          <div className="space-y-2">
            {nuevos.map((p) => (
              <div key={p.ruc} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <div>
                  <span className="font-medium text-slate-700">{p.razonSocial || p.ruc}</span>
                  <span className="ml-2 text-xs text-slate-400">{p.rubro || "—"}</span>
                </div>
                <input
                  className="w-28 rounded-md border border-slate-300 px-2 py-1 text-right text-sm outline-none focus:border-brand-500"
                  value={p.cuenta}
                  onChange={(e) => editarCuenta(p.ruc, e.target.value)}
                  title={p.nombreCuenta}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {facturas.length > 0 && (
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[760px] text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase text-slate-400">
                <th className="py-1">Fecha</th>
                <th className="py-1">Serie‑Número</th>
                <th className="py-1">Proveedor</th>
                <th className="py-1">Descripción (glosa)</th>
                <th className="py-1 text-right">Total</th>
                <th className="py-1 text-right">Cuenta</th>
              </tr>
            </thead>
            <tbody>
              {facturas.map((f, i) => (
                <tr key={i} className="border-t border-slate-100 align-top">
                  <td className="py-1 text-slate-500">{f.fecha}</td>
                  <td className="py-1 text-slate-600">{f.serieNumero}</td>
                  <td className="py-1 text-slate-600">{f.razonSocial || f.ruc}</td>
                  <td className="py-1 text-slate-500">{f.glosa || "—"}</td>
                  <td className="py-1 text-right tabular-nums text-slate-700">
                    {f.moneda !== "PEN" ? `${f.moneda} ` : ""}
                    {fmtSoles(f.total).replace("S/ ", "")}
                  </td>
                  <td className="py-1 text-right font-semibold text-brand-700">{f.cuenta}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
