"use client";

import { useRef, useState } from "react";
import { fmtSoles } from "./ui";

interface Prov {
  ruc: string;
  razonSocial?: string;
  rubro?: string;
  cuenta: string;
  nombreCuenta?: string;
  fuente: "aprendido" | "sugerido";
  nuevo: boolean;
  comprobantes: number;
  monto: number;
}
interface Comp {
  serie: string;
  numero: string;
  fecha: string;
  ruc: string;
  razonSocial: string;
  base: number;
  igv: number;
  total: number;
  cuenta: string;
}

export default function ClasificacionPanel() {
  const [proveedores, setProveedores] = useState<Prov[]>([]);
  const [comprobantes, setComprobantes] = useState<Comp[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function clasificar(file: File) {
    setBusy("clasif");
    setError(null);
    setInfo(null);
    setProveedores([]);
    setComprobantes([]);
    try {
      const fd = new FormData();
      fd.append("sireCompras", file);
      const res = await fetch("/api/clasificacion", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "No se pudo clasificar.");
        return;
      }
      setProveedores(data.proveedores ?? []);
      setComprobantes(data.comprobantes ?? []);
      setInfo(
        `${data.comprobantes?.length ?? 0} comprobantes · ${data.totalProveedores} proveedores · ${data.nuevos} nuevo(s) por confirmar`
      );
    } catch {
      setError("Error de red al clasificar.");
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function editar(ruc: string, cuenta: string) {
    setProveedores((prev) => prev.map((p) => (p.ruc === ruc ? { ...p, cuenta } : p)));
    setComprobantes((prev) => prev.map((c) => (c.ruc === ruc ? { ...c, cuenta } : c)));
  }

  async function guardar() {
    setBusy("save");
    setError(null);
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
      const res = await fetch("/api/clasificacion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cuentas }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? "No se pudo guardar.");
        return;
      }
      setProveedores((prev) => prev.map((p) => ({ ...p, fuente: "aprendido", nuevo: false })));
      setInfo("✅ Cuentas aprendidas. La próxima vez se clasifican solas.");
    } finally {
      setBusy(null);
    }
  }

  async function descargar() {
    setBusy("excel");
    try {
      const res = await fetch("/api/clasificacion/excel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comprobantes }),
      });
      if (!res.ok) {
        setError("No se pudo generar el Excel.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "compras-clasificadas.xlsx";
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
  const conocidos = proveedores.filter((p) => !p.nuevo);

  return (
    <section className="card p-5">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="font-semibold text-slate-800">Compras → cuenta automática</h2>
        <span className="badge bg-slate-100 text-slate-500">SIRE · clasifica por rubro</span>
      </div>
      <p className="mb-4 text-xs text-slate-400">
        Sube el <strong>Excel del SIRE de compras (RCE)</strong>. Cada proveedor se clasifica con
        su <strong>cuenta contable</strong> (por rubro de decolecta + lo aprendido). Solo confirmas
        los <strong>nuevos</strong>; el resto sale automático. Descarga el resultado para Contasis.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && clasificar(e.target.files[0])}
        />
        <button className="btn-primary" onClick={() => fileRef.current?.click()} disabled={trabajando}>
          {busy === "clasif" ? "Clasificando…" : "⬆ Subir SIRE compras (Excel)"}
        </button>
        {comprobantes.length > 0 && (
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
        <div className="mt-4">
          <p className="mb-2 text-sm font-semibold text-red-700">
            🆕 Proveedores nuevos por confirmar ({nuevos.length})
          </p>
          <TablaProv lista={nuevos} editar={editar} resaltar />
        </div>
      )}

      {conocidos.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-semibold text-slate-600">
            Proveedores ya conocidos ({conocidos.length}) — clasificados solos
          </summary>
          <div className="mt-2">
            <TablaProv lista={conocidos} editar={editar} />
          </div>
        </details>
      )}
    </section>
  );
}

function TablaProv({
  lista,
  editar,
  resaltar = false,
}: {
  lista: Prov[];
  editar: (ruc: string, cuenta: string) => void;
  resaltar?: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="text-left text-xs uppercase text-slate-400">
            <th className="py-1">Proveedor</th>
            <th className="py-1">Rubro</th>
            <th className="py-1 text-right">Cpbtes.</th>
            <th className="py-1 text-right">Monto</th>
            <th className="py-1 text-right">Cuenta</th>
          </tr>
        </thead>
        <tbody>
          {lista.map((p) => (
            <tr key={p.ruc} className={`border-t border-slate-100 ${resaltar ? "bg-amber-50/40" : ""}`}>
              <td className="py-1">
                <p className="font-medium text-slate-700">{p.razonSocial || p.ruc}</p>
                <p className="text-[11px] text-slate-400">{p.ruc}</p>
              </td>
              <td className="py-1 text-xs text-slate-500">{p.rubro || "—"}</td>
              <td className="py-1 text-right tabular-nums text-slate-600">{p.comprobantes}</td>
              <td className="py-1 text-right tabular-nums text-slate-600">{fmtSoles(p.monto)}</td>
              <td className="py-1 text-right">
                <input
                  className="w-28 rounded-md border border-slate-300 px-2 py-1 text-right text-sm outline-none focus:border-brand-500"
                  value={p.cuenta}
                  onChange={(e) => editar(p.ruc, e.target.value)}
                  title={p.nombreCuenta}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
