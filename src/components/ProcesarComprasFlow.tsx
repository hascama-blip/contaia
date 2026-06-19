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
interface Factura {
  serieNumero: string;
  ruc: string;
  glosa: string;
}

const keySire = (c: { serie: string; numero: string; ruc: string }) =>
  `${String(c.serie).toUpperCase().trim()}-${parseInt(String(c.numero), 10) || 0}|${c.ruc}`;
const keyXml = (f: { serieNumero: string; ruc: string }) => {
  const parts = String(f.serieNumero).split("-");
  const serie = (parts[0] || "").toUpperCase().trim();
  const num = parseInt(parts.slice(1).join("-"), 10) || 0;
  return `${serie}-${num}|${f.ruc}`;
};

export default function ProcesarComprasFlow() {
  const [comps, setComps] = useState<Comp[]>([]);
  const [provs, setProvs] = useState<Prov[]>([]);
  const [vinculo, setVinculo] = useState<{ conXml: number; sinXml: number; sobran: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const sireRef = useRef<HTMLInputElement>(null);
  const xmlRef = useRef<HTMLInputElement>(null);

  const paso1Hecho = comps.length > 0;
  const nuevos = provs.filter((p) => p.nuevo);

  // ---- Paso 1: SIRE ----
  async function subirSire(file: File) {
    setBusy("sire");
    setError(null);
    setInfo(null);
    setVinculo(null);
    try {
      const fd = new FormData();
      fd.append("sireCompras", file);
      const res = await fetch("/api/clasificacion", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "No se pudo procesar el SIRE.");
        return;
      }
      setComps(data.comprobantes ?? []);
      setProvs(data.proveedores ?? []);
      setInfo(
        `Paso 1 ✓ — ${data.comprobantes?.length ?? 0} comprobantes · ${data.nuevos} proveedor(es) nuevo(s). Ya puedes subir los XML.`
      );
    } catch {
      setError("Error de red al procesar el SIRE.");
    } finally {
      setBusy(null);
      if (sireRef.current) sireRef.current.value = "";
    }
  }

  function editarCuenta(ruc: string, cuenta: string) {
    setProvs((p) => p.map((x) => (x.ruc === ruc ? { ...x, cuenta } : x)));
    setComps((c) => c.map((x) => (x.ruc === ruc ? { ...x, cuenta } : x)));
  }

  async function aprender() {
    setBusy("save");
    try {
      const cuentas = provs.map((p) => ({
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
      if (res.ok) {
        setProvs((p) => p.map((x) => ({ ...x, nuevo: false })));
        setInfo("✅ Cuentas aprendidas.");
      }
    } finally {
      setBusy(null);
    }
  }

  // ---- Paso 2: XML (vinculado al SIRE) ----
  async function subirXml(files: FileList) {
    if (!paso1Hecho) return;
    setBusy("xml");
    setError(null);
    try {
      const fd = new FormData();
      Array.from(files).forEach((f) => fd.append("file", f));
      const res = await fetch("/api/facturas-xml", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "No se pudieron leer los XML.");
        return;
      }
      const facturas: Factura[] = data.facturas ?? [];
      const glosaMap = new Map<string, string>();
      const xmlKeys = new Set<string>();
      for (const f of facturas) {
        const k = keyXml(f);
        glosaMap.set(k, f.glosa);
        xmlKeys.add(k);
      }
      // Vincula la glosa a cada comprobante del SIRE.
      const merged = comps.map((c) => ({ ...c, glosa: glosaMap.get(keySire(c)) ?? c.glosa ?? "" }));
      setComps(merged);
      const sireKeys = new Set(merged.map(keySire));
      const conXml = merged.filter((c) => glosaMap.has(keySire(c))).length;
      const sobran = facturas.filter((f) => !sireKeys.has(keyXml(f))).length;
      setVinculo({ conXml, sinXml: merged.length - conXml, sobran });
      setInfo(
        `Paso 2 ✓ — ${facturas.length} XML leídos. Vinculados al SIRE: ${conXml} · sin XML: ${merged.length - conXml} · en XML pero no en SIRE: ${sobran}.`
      );
    } catch {
      setError("Error de red al leer los XML.");
    } finally {
      setBusy(null);
      if (xmlRef.current) xmlRef.current.value = "";
    }
  }

  async function descargarMasivo() {
    setBusy("excel");
    try {
      const filas = comps.map((c) => ({
        fecha: c.fecha,
        serie: c.serie,
        numero: c.numero,
        ruc: c.ruc,
        razonSocial: c.razonSocial,
        glosa: c.glosa ?? "",
        base: c.base,
        igv: c.igv,
        total: c.total,
        cuenta: c.cuenta,
        estado: c.glosa ? "Con XML" : "Falta XML",
      }));
      const res = await fetch("/api/masivo/excel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filas }),
      });
      if (!res.ok) {
        setError("No se pudo generar el masivo.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "masivo-compras-contasis.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(null);
    }
  }

  const trabajando = busy !== null;

  return (
    <div className="space-y-5">
      {info && <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">{info}</div>}
      {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}

      {/* PASO 1 — SIRE (obligatorio) */}
      <section className="card p-5">
        <div className="mb-2 flex items-center gap-3">
          <span className="step-num shrink-0">1</span>
          <div>
            <h2 className="font-bold text-slate-800">Subir el SIRE (obligatorio)</h2>
            <p className="text-xs text-slate-400">
              Sube el Excel/ZIP del SIRE de compras. Se procesa y clasifica la cuenta por proveedor.
            </p>
          </div>
        </div>
        <input
          ref={sireRef}
          type="file"
          accept=".xlsx,.xls,.zip,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/zip"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && subirSire(e.target.files[0])}
        />
        <button className="btn-primary" onClick={() => sireRef.current?.click()} disabled={trabajando}>
          {busy === "sire" ? "Procesando…" : paso1Hecho ? "↻ Reemplazar SIRE" : "⬆ Subir SIRE (compras)"}
        </button>

        {nuevos.length > 0 && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50/40 p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-semibold text-red-700">🆕 Proveedores nuevos por confirmar ({nuevos.length})</p>
              <button className="btn-ghost py-1 text-xs" onClick={aprender} disabled={trabajando}>
                {busy === "save" ? "Guardando…" : "💾 Guardar y aprender"}
              </button>
            </div>
            <div className="space-y-2">
              {nuevos.map((p) => (
                <div key={p.ruc} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span>
                    <span className="font-medium text-slate-700">{p.razonSocial || p.ruc}</span>
                    <span className="ml-2 text-xs text-slate-400">{p.rubro || "—"}</span>
                  </span>
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
      </section>

      {/* PASO 2 — XML (vinculado al SIRE) */}
      <section className={`card p-5 ${paso1Hecho ? "" : "pointer-events-none opacity-50"}`}>
        <div className="mb-2 flex items-center gap-3">
          <span className="step-num shrink-0">2</span>
          <div>
            <h2 className="font-bold text-slate-800">
              Subir los XML {paso1Hecho ? "" : "🔒 (primero el SIRE)"}
            </h2>
            <p className="text-xs text-slate-400">
              A cada comprobante del SIRE se le agrega su <strong>glosa</strong> y se valida si la
              factura está o no en el SIRE.
            </p>
          </div>
        </div>
        <input
          ref={xmlRef}
          type="file"
          accept=".xml,.zip,text/xml,application/xml,application/zip"
          multiple
          className="hidden"
          onChange={(e) => e.target.files?.length && subirXml(e.target.files)}
        />
        <button className="btn-primary" onClick={() => xmlRef.current?.click()} disabled={trabajando || !paso1Hecho}>
          {busy === "xml" ? "Leyendo…" : "⬆ Subir XML (ZIP de SUNAT)"}
        </button>

        {vinculo && (
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-emerald-100 px-3 py-1 font-semibold text-emerald-700">
              ✓ {vinculo.conXml} con XML
            </span>
            <span className="rounded-full bg-amber-100 px-3 py-1 font-semibold text-amber-700">
              ⚠ {vinculo.sinXml} sin XML
            </span>
            {vinculo.sobran > 0 && (
              <span className="rounded-full bg-red-100 px-3 py-1 font-semibold text-red-700">
                ✕ {vinculo.sobran} en XML pero NO en SIRE
              </span>
            )}
          </div>
        )}
      </section>

      {/* Resultado + descarga */}
      {paso1Hecho && (
        <section className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-bold text-slate-800">Masivo para Contasis ({comps.length})</h2>
            <button className="btn-primary" onClick={descargarMasivo} disabled={trabajando}>
              {busy === "excel" ? "Generando…" : "⬇ Descargar masivo (Contasis)"}
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase text-slate-400">
                  <th className="py-1">Fecha</th>
                  <th className="py-1">Serie‑Número</th>
                  <th className="py-1">Proveedor</th>
                  <th className="py-1">Glosa</th>
                  <th className="py-1 text-right">Total</th>
                  <th className="py-1 text-right">Cuenta</th>
                  <th className="py-1 text-right">Estado</th>
                </tr>
              </thead>
              <tbody>
                {comps.slice(0, 300).map((c, i) => (
                  <tr key={i} className="border-t border-slate-100 align-top">
                    <td className="py-1 text-slate-500">{c.fecha}</td>
                    <td className="py-1 text-slate-600">{c.serie}-{c.numero}</td>
                    <td className="py-1 text-slate-600">{c.razonSocial || c.ruc}</td>
                    <td className="py-1 text-slate-500">{c.glosa || "—"}</td>
                    <td className="py-1 text-right tabular-nums text-slate-700">{fmtSoles(c.total).replace("S/ ", "")}</td>
                    <td className="py-1 text-right font-semibold text-brand-700">{c.cuenta}</td>
                    <td className="py-1 text-right">
                      {c.glosa ? (
                        <span className="text-emerald-600">Con XML</span>
                      ) : (
                        <span className="text-amber-600">Falta XML</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {comps.length > 300 && (
              <p className="mt-2 text-xs text-slate-400">Mostrando 300 de {comps.length}. El Excel trae todos.</p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
