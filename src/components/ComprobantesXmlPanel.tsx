"use client";

import { useState } from "react";
import { zipSync } from "fflate";
import { getSolPass, getSolUser } from "@/lib/solSession";

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Setiembre", "Octubre", "Noviembre", "Diciembre"];

type EstadoFila = { estado: "pendiente" | "extrayendo" | "ok" | "error"; factura?: any; motivo?: string };

// Descarga los XML de comprobantes RECIBIDOS (compras) desde SUNAT SOL, UNO POR
// UNO a demanda (clic por fila). Extraer de a uno, a ritmo humano, evita que
// SUNAT frene las consultas ("Error del Servidor / reintentar en 5 min"). Al
// final se arma el Excel consolidado y el ZIP con todo lo extraído.
export default function ComprobantesXmlPanel({ clienteId }: { clienteId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busyRel, setBusyRel] = useState(false);
  const [relacion, setRelacion] = useState<any[]>([]);
  const [relNombre, setRelNombre] = useState<string | null>(null);
  const [periodoSire, setPeriodoSire] = useState<string>("");
  const hoyD = new Date();
  const [sireMes, setSireMes] = useState(hoyD.getMonth() + 1);
  const [sireAnio, setSireAnio] = useState(hoyD.getFullYear());

  // Estado por fila (índice de la relación) y control de cupo.
  const [filas, setFilas] = useState<Record<number, EstadoFila>>({});
  const [consumido, setConsumido] = useState(false);
  const [filaBusy, setFilaBusy] = useState<number | null>(null);
  const [auto, setAuto] = useState(false); // "extraer todas" en curso
  const [genBusy, setGenBusy] = useState(false);

  const estadoDe = (i: number): EstadoFila => filas[i] ?? { estado: "pendiente" };
  const facturasOk = () =>
    relacion.map((_, i) => filas[i]).filter((f) => f?.estado === "ok" && f.factura).map((f) => f!.factura);
  const nOk = relacion.filter((_, i) => filas[i]?.estado === "ok").length;

  async function subirRelacion(file: File) {
    setError(null); setInfo(null); setBusyRel(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/comprobantes-xml/parsear", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? "No se pudo leer la relación."); return; }
      setRelacion(data.items ?? []); setFilas({}); setConsumido(false);
      setPeriodoSire(""); setRelNombre(file.name);
      setInfo(`Relación cargada: ${data.total} comprobante(s). Extrae uno por uno con el botón de cada fila.`);
    } catch { setError("Error de red al subir la relación."); }
    finally { setBusyRel(false); }
  }

  // Recupera del servidor los comprobantes YA extraídos de este periodo y marca
  // sus filas como "ok" (para no rehacerlos si se cayó el internet / se recargó).
  async function restaurarGuardados(items: any[], periodo: string): Promise<number> {
    try {
      const res = await fetch(`/api/clientes/${clienteId}/comprobantes-xml?periodo=${periodo}`);
      const data = await res.json().catch(() => ({}));
      const guardadas: any[] = Array.isArray(data.facturas) ? data.facturas : [];
      if (!guardadas.length) return 0;
      const norm = (s: any, n: any) => `${String(s || "").toUpperCase()}-${String(n || "").replace(/^0+/, "")}`;
      const mapa = new Map<string, any>();
      for (const f of guardadas) {
        const sn = String(f.serieNumero || `${f.serie}-${f.numero}`);
        const [s, ...rest] = sn.split("-");
        mapa.set(norm(s, rest.join("-")), f);
      }
      const nuevos: Record<number, EstadoFila> = {};
      items.forEach((it, i) => {
        const f = mapa.get(norm(it.serie, it.numero));
        if (f) nuevos[i] = { estado: "ok", factura: f };
      });
      const n = Object.keys(nuevos).length;
      if (n) { setFilas(nuevos); setConsumido(true); }
      return n;
    } catch { return 0; }
  }

  async function cargarDesdeSire() {
    setError(null); setInfo(null); setBusyRel(true);
    const periodo = `${sireAnio}${String(sireMes).padStart(2, "0")}`;
    try {
      const res = await fetch(`/api/clientes/${clienteId}/sire-detalle/relacion?periodo=${periodo}&tipo=compras`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? "No se pudo cargar la relación del SIRE."); return; }
      const items = data.items ?? [];
      setRelacion(items); setFilas({}); setConsumido(false);
      setPeriodoSire(periodo); setRelNombre(`Detalle SIRE compras ${periodo}`);
      const rec = await restaurarGuardados(items, periodo);
      setInfo(`Relación cargada del SIRE: ${data.total} comprobante(s) (${periodo}).` +
        (rec ? ` ♻ Se recuperaron ${rec} ya extraído(s) — sigue con los que faltan.` : " Extrae uno por uno."));
    } catch { setError("Error de red al cargar la relación del SIRE."); }
    finally { setBusyRel(false); }
  }

  // Extrae UN comprobante (login + consulta + descarga XML/PDF de esa fila).
  async function extraerFila(i: number): Promise<boolean> {
    const item = relacion[i];
    if (!item) return false;
    const solPass = getSolPass(clienteId);
    const solUser = getSolUser(clienteId);
    if (!solPass) { setError("Carga tu Clave SOL (arriba) para extraer."); return false; }
    setError(null);
    setFilas((p) => ({ ...p, [i]: { estado: "extrayendo" } }));
    setFilaBusy(i);
    try {
      // parte 0 = consume 1 cupo (solo la 1ª vez); el resto no consume.
      const parte = consumido ? 1 : 0;
      const res = await fetch(`/api/clientes/${clienteId}/comprobantes-xml`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ solUser, solPass, relacion: [item], parte, periodo: periodoSire }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) { setFilas((p) => ({ ...p, [i]: { estado: "error", motivo: data.error ?? "Login SOL falló" } })); return false; }
      if (res.status === 429) { setError(data.error ?? "Sin consultas disponibles."); setFilas((p) => ({ ...p, [i]: { estado: "pendiente" } })); return false; }
      if (!consumido && res.ok) setConsumido(true);
      const factura = Array.isArray(data.facturas) ? data.facturas[0] : null;
      if (factura) { setFilas((p) => ({ ...p, [i]: { estado: "ok", factura } })); return true; }
      const motivo = (Array.isArray(data.fallidos) && data.fallidos[0]?.motivo) || data.error || "SUNAT no devolvió el comprobante.";
      setFilas((p) => ({ ...p, [i]: { estado: "error", motivo } }));
      return false;
    } catch {
      setFilas((p) => ({ ...p, [i]: { estado: "error", motivo: "Error de red" } }));
      return false;
    } finally { setFilaBusy(null); }
  }

  // Extrae TODAS las pendientes, una por una con una pausa (ritmo humano).
  async function extraerTodas() {
    setAuto(true); setError(null);
    try {
      for (let i = 0; i < relacion.length; i++) {
        const est = filas[i]?.estado;
        if (est === "ok") continue;
        await extraerFila(i);
        // Pausa entre comprobantes para no gatillar el límite de SUNAT.
        await new Promise((r) => setTimeout(r, 6000));
      }
    } finally { setAuto(false); }
  }

  function bajarBlob(blob: Blob, nombre: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = nombre;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }
  function b64ToU8(b64: string): Uint8Array {
    const bin = atob(b64); const by = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) by[i] = bin.charCodeAt(i);
    return by;
  }
  const claveDe = (f: any) => String(f.serieNumero || `${f.serie}-${f.numero}`).replace(/[^\w.-]/g, "_") || "comprobante";

  function descargarXml(f: any) {
    if (!f.xmlBase64) { setError("Este comprobante no tiene el XML guardado."); return; }
    bajarBlob(new Blob([b64ToU8(f.xmlBase64)], { type: "application/xml" }), `${claveDe(f)}.xml`);
  }
  async function descargarPdf(f: any) {
    if (f.pdfBase64) { bajarBlob(new Blob([b64ToU8(f.pdfBase64)], { type: "application/pdf" }), `${claveDe(f)}.pdf`); return; }
    // Sin PDF oficial: generar la representación.
    const res = await fetch("/api/facturas-xml/pdf", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ factura: f }) });
    if (!res.ok) { setError("No se pudo generar el PDF."); return; }
    bajarBlob(await res.blob(), `${claveDe(f)}.pdf`);
  }

  // ZIP con XML + PDF de todo lo extraído.
  function descargarZip() {
    const fs = facturasOk();
    if (!fs.length) { setError("Aún no has extraído comprobantes."); return; }
    const files: Record<string, Uint8Array> = {};
    const usados: Record<string, number> = {};
    for (const f of fs) {
      let base = claveDe(f);
      if (usados[base] != null) { usados[base]++; base = `${base}_${usados[base]}`; } else usados[base] = 0;
      if (f.xmlBase64) files[`${base}.xml`] = b64ToU8(f.xmlBase64);
      if (f.pdfBase64) files[`${base}.pdf`] = b64ToU8(f.pdfBase64);
    }
    if (!Object.keys(files).length) { setError("No hay archivos que empaquetar."); return; }
    const zipped = zipSync(files, { level: 0 });
    bajarBlob(new Blob([zipped], { type: "application/zip" }), periodoSire ? `comprobantes-${periodoSire}.zip` : "comprobantes-xml.zip");
  }

  async function descargarExcel(resumen: boolean) {
    const fs = facturasOk();
    if (!fs.length) { setError("Aún no has extraído comprobantes."); return; }
    setGenBusy(true);
    try {
      const res = await fetch("/api/facturas-xml/excel", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(resumen ? { facturas: fs, resumen: true, periodo: periodoSire } : { facturas: fs, detalle: true }),
      });
      if (!res.ok) { setError("No se pudo generar el Excel."); return; }
      bajarBlob(await res.blob(), resumen ? (periodoSire ? `compras-xml-${periodoSire}.xlsx` : "compras-xml-acumulado.xlsx") : "comprobantes-xml.xlsx");
    } finally { setGenBusy(false); }
  }

  const hayRel = relacion.length > 0;

  return (
    <section className="card p-5">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="font-semibold text-slate-800">Comprobantes recibidos (XML) desde SUNAT</h2>
        <span className="badge bg-slate-100 text-slate-500">Solo Usuario + Clave SOL</span>
      </div>
      <p className="mb-4 text-xs text-slate-400">
        Sube la <strong>relación de comprobantes</strong> (o cárgala del SIRE) y extrae los XML
        <strong> uno por uno</strong> con el botón de cada fila. Extraer de a uno, a tu ritmo, evita que
        SUNAT frene las consultas. Al final descargas el <strong>Excel consolidado</strong> y el ZIP.
      </p>

      {/* Relación: plantilla + subir + SIRE */}
      <div className="mb-4 rounded-lg border border-brand-200 bg-brand-50/40 p-3">
        <p className="mb-2 text-xs font-semibold text-brand-800">Relación de comprobantes a extraer</p>
        <div className="flex flex-wrap items-center gap-2">
          <a href="/api/comprobantes-xml/plantilla" className="btn-ghost text-sm" download>⬇ Descargar plantilla (Excel)</a>
          <label className={`btn-primary cursor-pointer text-sm ${busyRel ? "pointer-events-none opacity-50" : ""}`}>
            ⬆ Subir relación llena
            <input type="file" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) subirRelacion(f); e.currentTarget.value = ""; }} />
          </label>
          {relNombre && (
            <span className="text-xs text-emerald-700">
              ✓ {relNombre} · {relacion.length} comprobante(s)
              <button className="ml-2 text-slate-400 underline" onClick={() => { setRelacion([]); setRelNombre(null); setFilas({}); }}>quitar</button>
            </span>
          )}
        </div>
        <div className="mt-3 border-t border-brand-200 pt-3">
          <p className="mb-1 text-[11px] font-semibold text-brand-800">…o usa el Detalle SIRE (compras) ya extraído</p>
          <div className="flex flex-wrap items-center gap-2">
            <select className="input h-8 py-0 text-xs" value={sireMes} onChange={(e) => setSireMes(Number(e.target.value))}>
              {MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
            <select className="input h-8 py-0 text-xs" value={sireAnio} onChange={(e) => setSireAnio(Number(e.target.value))}>
              {[hoyD.getFullYear(), hoyD.getFullYear() - 1, hoyD.getFullYear() - 2].map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <button className="btn-ghost text-sm" onClick={cargarDesdeSire} disabled={busyRel}>📋 Cargar del SIRE</button>
          </div>
        </div>
      </div>

      {info && <div className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">{info}</div>}
      {error && <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}

      {hayRel && (
        <>
          {/* Acciones globales */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <button className="btn-primary text-sm" onClick={extraerTodas} disabled={auto || filaBusy !== null}>
              {auto ? "Extrayendo todas…" : "▶ Extraer todas (una por una)"}
            </button>
            <span className="text-xs text-slate-500">{nOk}/{relacion.length} extraídos</span>
            {nOk > 0 && (
              <>
                <button className="btn-ghost text-sm" onClick={() => descargarExcel(true)} disabled={genBusy}>⬇ Excel consolidado</button>
                <button className="btn-ghost text-sm" onClick={() => descargarExcel(false)} disabled={genBusy}>⬇ Excel detalle</button>
                <button className="btn-ghost text-sm" onClick={descargarZip}>⬇ Todo (ZIP)</button>
              </>
            )}
          </div>

          {/* Tabla por fila */}
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full min-w-[640px] text-xs">
              <thead className="bg-slate-50">
                <tr className="text-left text-[10px] uppercase text-slate-400">
                  <th className="px-3 py-1">RUC Emisor</th>
                  <th className="px-3 py-1">Tipo</th>
                  <th className="px-3 py-1">Serie-Número</th>
                  <th className="px-3 py-1">Proveedor / estado</th>
                  <th className="px-3 py-1 text-right">Acción</th>
                </tr>
              </thead>
              <tbody>
                {relacion.map((r, i) => {
                  const e = estadoDe(i);
                  return (
                    <tr key={i} className="border-t border-slate-100">
                      <td className="px-3 py-1 text-slate-600">{r.rucEmisor}</td>
                      <td className="px-3 py-1 text-slate-600">{r.tipo}</td>
                      <td className="px-3 py-1 font-medium text-slate-700">{r.serie}-{r.numero}</td>
                      <td className="px-3 py-1">
                        {e.estado === "ok" && <span className="text-slate-600">{e.factura?.razonSocialEmisor || "✓ extraído"}</span>}
                        {e.estado === "extrayendo" && <span className="text-amber-600">Extrayendo…</span>}
                        {e.estado === "error" && <span className="text-red-600" title={e.motivo}>⚠ {e.motivo?.slice(0, 60)}</span>}
                        {e.estado === "pendiente" && <span className="text-slate-400">—</span>}
                      </td>
                      <td className="px-3 py-1 text-right">
                        {e.estado === "ok" ? (
                          <span className="inline-flex gap-1">
                            <button className="rounded border border-brand-200 bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-700 hover:bg-brand-100" onClick={() => descargarXml(e.factura)}>XML</button>
                            <button className="rounded border border-brand-200 bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-700 hover:bg-brand-100" onClick={() => descargarPdf(e.factura)}>PDF</button>
                          </span>
                        ) : (
                          <button
                            className="rounded-md border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                            onClick={() => extraerFila(i)}
                            disabled={auto || filaBusy !== null}
                          >
                            {e.estado === "extrayendo" ? "…" : e.estado === "error" ? "🔁 Reintentar" : "⬇ Extraer"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[10px] text-slate-400">
            Consejo: si SUNAT responde “Error del Servidor”, espera unos minutos y reintenta esa fila. Extraer de a
            uno (o con la pausa de “Extraer todas”) reduce ese bloqueo.
          </p>
        </>
      )}
    </section>
  );
}
