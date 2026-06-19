"use client";

import { useRef, useState } from "react";

interface Prov {
  ruc: string;
  razonSocial?: string;
  rubro?: string;
  cuenta: string;
  nombreCuenta?: string;
  nuevo: boolean;
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
  glosa?: string;
}

const num = (s: any) => parseInt(String(s), 10) || 0;
const kC = (c: { serie: string; numero: string; ruc: string }) =>
  `${String(c.serie).toUpperCase().trim()}-${num(c.numero)}|${c.ruc}`;
const kV = (c: { serie: string; numero: string }) =>
  `${String(c.serie).toUpperCase().trim()}-${num(c.numero)}`;
const kXml = (f: { serieNumero: string }) => {
  const p = String(f.serieNumero).split("-");
  return `${(p[0] || "").toUpperCase().trim()}-${num(p.slice(1).join("-"))}`;
};

export default function MasivoFlow() {
  const [compras, setCompras] = useState<Comp[]>([]);
  const [provs, setProvs] = useState<Prov[]>([]);
  const [ventas, setVentas] = useState<Comp[]>([]);
  const [cuentaVentas, setCuentaVentas] = useState("70121");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const refSC = useRef<HTMLInputElement>(null);
  const refSV = useRef<HTMLInputElement>(null);
  const refXC = useRef<HTMLInputElement>(null);
  const refXV = useRef<HTMLInputElement>(null);

  const haySire = compras.length > 0 || ventas.length > 0;

  async function subirSireCompras(file: File) {
    setBusy("sc"); setError(null);
    try {
      const fd = new FormData(); fd.append("sireCompras", file);
      const res = await fetch("/api/clasificacion", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setError(data.error ?? "No se pudo procesar el SIRE de compras.");
      setCompras(data.comprobantes ?? []);
      setProvs(data.proveedores ?? []);
      setInfo(`Compras ✓ ${data.comprobantes?.length ?? 0} comprobantes · ${data.nuevos} nuevo(s).`);
    } finally { setBusy(null); if (refSC.current) refSC.current.value = ""; }
  }

  async function subirSireVentas(file: File) {
    setBusy("sv"); setError(null);
    try {
      const fd = new FormData(); fd.append("sireVentas", file);
      const res = await fetch("/api/sire-ventas", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setError(data.error ?? "No se pudo procesar el SIRE de ventas.");
      setVentas((data.comprobantes ?? []).map((c: Comp) => ({ ...c, cuenta: cuentaVentas })));
      setInfo(`Ventas ✓ ${data.comprobantes?.length ?? 0} comprobantes.`);
    } finally { setBusy(null); if (refSV.current) refSV.current.value = ""; }
  }

  async function subirXml(files: FileList, libro: "compras" | "ventas") {
    setBusy("xml"); setError(null); setInfo(`Leyendo ${files.length} archivo(s) XML…`);
    try {
      const fd = new FormData();
      Array.from(files).forEach((f) => fd.append("file", f));
      fd.append("soloGlosa", "1"); // en el masivo la cuenta ya viene del SIRE
      const res = await fetch("/api/facturas-xml", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setError(data.error ?? "No se pudieron leer los XML.");
      const facturas: { serieNumero: string; ruc: string; glosa: string }[] = data.facturas ?? [];
      const avisos = (data.errores ?? []).length ? ` · ${data.errores.length} con aviso` : "";
      if (libro === "compras") {
        const map = new Map<string, string>();
        for (const f of facturas) map.set(`${kXml(f)}|${f.ruc}`, f.glosa);
        const merged = compras.map((c) => ({ ...c, glosa: map.get(kC(c)) ?? c.glosa ?? "" }));
        setCompras(merged);
        setInfo(`XML compras ✓ ${data.leidas ?? facturas.length} leídos · ${merged.filter((c) => c.glosa).length}/${merged.length} comprobantes con glosa${avisos}.`);
      } else {
        const map = new Map<string, string>();
        for (const f of facturas) map.set(kXml(f), f.glosa);
        const merged = ventas.map((c) => ({ ...c, glosa: map.get(kV(c)) ?? c.glosa ?? "" }));
        setVentas(merged);
        setInfo(`XML ventas ✓ ${data.leidas ?? facturas.length} leídos · ${merged.filter((c) => c.glosa).length}/${merged.length} comprobantes con glosa${avisos}.`);
      }
    } catch {
      setError("Se cortó la lectura de los XML. Si es un ZIP muy grande, intenta con menos archivos.");
    } finally {
      setBusy(null);
      if (refXC.current) refXC.current.value = "";
      if (refXV.current) refXV.current.value = "";
    }
  }

  function reclasificar(ruc: string, cuenta: string) {
    setProvs((p) => p.map((x) => (x.ruc === ruc ? { ...x, cuenta } : x)));
    setCompras((c) => c.map((x) => (x.ruc === ruc ? { ...x, cuenta } : x)));
  }
  function setCtaVentas(cuenta: string) {
    setCuentaVentas(cuenta);
    setVentas((v) => v.map((x) => ({ ...x, cuenta })));
  }

  async function aprender() {
    setBusy("save");
    try {
      const cuentas = provs.map((p) => ({
        ruc: p.ruc, razonSocial: p.razonSocial, rubro: p.rubro, cuenta: p.cuenta,
        nombreCuenta: p.nombreCuenta, fuente: "aprendido" as const, actualizadoAt: new Date().toISOString(),
      }));
      const res = await fetch("/api/clasificacion", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cuentas }),
      });
      if (res.ok) { setProvs((p) => p.map((x) => ({ ...x, nuevo: false }))); setInfo("✅ Cuentas aprendidas."); }
    } finally { setBusy(null); }
  }

  async function generar(libro: "compras" | "ventas") {
    setBusy(libro);
    try {
      const lista = libro === "compras" ? compras : ventas;
      const filas = lista.map((c) => ({
        fecha: c.fecha, serie: c.serie, numero: c.numero, ruc: c.ruc,
        razonSocial: c.razonSocial, glosa: c.glosa ?? "", base: c.base, igv: c.igv, total: c.total, cuenta: c.cuenta,
      }));
      const res = await fetch("/api/masivo/excel", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ libro, filas }),
      });
      if (!res.ok) return setError("No se pudo generar el masivo.");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `${libro}-contasis.xlsx`;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } finally { setBusy(null); }
  }

  const trabajando = busy !== null;

  return (
    <div className="space-y-5">
      {info && <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">{info}</div>}
      {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}

      {/* PASO 1 — SIRE compras y ventas */}
      <section className="card p-5">
        <div className="mb-3 flex items-center gap-3">
          <span className="step-num shrink-0">1</span>
          <div>
            <h2 className="font-bold text-slate-800">Subir el SIRE (compras y ventas)</h2>
            <p className="text-xs text-slate-400">Excel o ZIP del SIRE. Las compras se clasifican por rubro; las ventas con su cuenta por defecto.</p>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-slate-200 p-3">
            <p className="mb-2 text-sm font-semibold text-slate-700">Compras (RCE)</p>
            <input ref={refSC} type="file" accept=".xlsx,.xls,.zip" className="hidden" onChange={(e) => e.target.files?.[0] && subirSireCompras(e.target.files[0])} />
            <button className="btn-primary w-full" onClick={() => refSC.current?.click()} disabled={trabajando}>
              {busy === "sc" ? "Procesando…" : compras.length ? `✓ ${compras.length} compras` : "⬆ SIRE compras"}
            </button>
          </div>
          <div className="rounded-lg border border-slate-200 p-3">
            <p className="mb-2 text-sm font-semibold text-slate-700">Ventas (RVIE)</p>
            <input ref={refSV} type="file" accept=".xlsx,.xls,.zip" className="hidden" onChange={(e) => e.target.files?.[0] && subirSireVentas(e.target.files[0])} />
            <button className="btn-primary w-full" onClick={() => refSV.current?.click()} disabled={trabajando}>
              {busy === "sv" ? "Procesando…" : ventas.length ? `✓ ${ventas.length} ventas` : "⬆ SIRE ventas"}
            </button>
          </div>
        </div>
      </section>

      {/* PASO 2 — XML opcional */}
      <section className={`card p-5 ${haySire ? "" : "pointer-events-none opacity-50"}`}>
        <div className="mb-3 flex items-center gap-3">
          <span className="step-num shrink-0">2</span>
          <div>
            <h2 className="font-bold text-slate-800">Subir los XML (opcional) {haySire ? "" : "🔒"}</h2>
            <p className="text-xs text-slate-400">Para agregar la glosa (descripción) a cada comprobante. Acepta el ZIP de SUNAT.</p>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-slate-200 p-3">
            <p className="mb-2 text-sm font-semibold text-slate-700">XML compras</p>
            <input ref={refXC} type="file" accept=".xml,.zip" multiple className="hidden" onChange={(e) => e.target.files?.length && subirXml(e.target.files, "compras")} />
            <button className="btn-ghost w-full" onClick={() => refXC.current?.click()} disabled={trabajando || compras.length === 0}>
              {busy === "xml" ? "Procesando…" : "⬆ XML compras"}
            </button>
          </div>
          <div className="rounded-lg border border-slate-200 p-3">
            <p className="mb-2 text-sm font-semibold text-slate-700">XML ventas</p>
            <input ref={refXV} type="file" accept=".xml,.zip" multiple className="hidden" onChange={(e) => e.target.files?.length && subirXml(e.target.files, "ventas")} />
            <button className="btn-ghost w-full" onClick={() => refXV.current?.click()} disabled={trabajando || ventas.length === 0}>
              {busy === "xml" ? "Procesando…" : "⬆ XML ventas"}
            </button>
          </div>
        </div>
      </section>

      {/* PASO 3 — Reclasificar */}
      {haySire && (
        <section className="card p-5">
          <div className="mb-3 flex items-center gap-3">
            <span className="step-num shrink-0">3</span>
            <h2 className="font-bold text-slate-800">Reclasificar cuentas (si es necesario)</h2>
          </div>

          {provs.length > 0 && (
            <div className="mb-4">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-700">Compras — cuenta por proveedor</p>
                <button className="btn-ghost py-1 text-xs" onClick={aprender} disabled={trabajando}>
                  {busy === "save" ? "Guardando…" : "💾 Guardar y aprender"}
                </button>
              </div>
              <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-200">
                {provs.map((p) => (
                  <div key={p.ruc} className={`flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-1.5 text-sm ${p.nuevo ? "bg-amber-50/40" : ""}`}>
                    <span className="truncate">
                      {p.nuevo && "🆕 "}
                      <span className="font-medium text-slate-700">{p.razonSocial || p.ruc}</span>
                      <span className="ml-2 text-xs text-slate-400">{p.rubro || ""}</span>
                    </span>
                    <input className="w-28 shrink-0 rounded-md border border-slate-300 px-2 py-1 text-right text-sm outline-none focus:border-brand-500"
                      value={p.cuenta} onChange={(e) => reclasificar(p.ruc, e.target.value)} title={p.nombreCuenta} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {ventas.length > 0 && (
            <div className="flex items-center gap-3">
              <p className="text-sm font-semibold text-slate-700">Ventas — cuenta (cctabase):</p>
              <input className="w-32 rounded-md border border-slate-300 px-2 py-1 text-right text-sm outline-none focus:border-brand-500"
                value={cuentaVentas} onChange={(e) => setCtaVentas(e.target.value)} />
            </div>
          )}
        </section>
      )}

      {/* Generar masivos */}
      {haySire && (
        <section className="card flex flex-wrap items-center gap-3 p-5">
          <h2 className="font-bold text-slate-800">Generar masivo para Contasis:</h2>
          <button className="btn-primary" onClick={() => generar("compras")} disabled={trabajando || compras.length === 0}>
            {busy === "compras" ? "Generando…" : "⬇ Masivo Compras"}
          </button>
          <button className="btn-primary" onClick={() => generar("ventas")} disabled={trabajando || ventas.length === 0}>
            {busy === "ventas" ? "Generando…" : "⬇ Masivo Ventas"}
          </button>
        </section>
      )}
    </div>
  );
}
