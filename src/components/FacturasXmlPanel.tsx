"use client";

import { useRef, useState } from "react";
import { fmtSoles } from "./ui";

interface Linea {
  numero: number;
  codigo: string;
  descripcion: string;
  cantidad: number;
  unidad: string;
  valorUnitario: number;
  valor: number;
  igv: number;
  precioUnitario: number;
  afectacion: string;
}
interface Factura {
  tipo: string;
  tipoDoc: string;
  serie: string;
  numero: string;
  serieNumero: string;
  fecha: string;
  hora: string;
  moneda: string;
  rucEmisor: string;
  razonSocialEmisor: string;
  rucReceptor: string;
  razonSocialReceptor: string;
  gravado: number;
  exonerado: number;
  inafecto: number;
  gratuito: number;
  descuento: number;
  isc: number;
  igv: number;
  otrosTributos: number;
  base: number;
  total: number;
  glosa: string;
  lineas: Linea[];
}

function monto(m: number, moneda: string) {
  const s = fmtSoles(m).replace("S/ ", "");
  return moneda && moneda !== "PEN" ? `${moneda} ${s}` : `S/ ${s}`;
}

export default function FacturasXmlPanel() {
  const [facturas, setFacturas] = useState<Factura[]>([]);
  const [abiertas, setAbiertas] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function leer(files: FileList) {
    setBusy("leer");
    setError(null);
    setInfo(null);
    setFacturas([]);
    setAbiertas(new Set());
    try {
      const fd = new FormData();
      Array.from(files).forEach((f) => fd.append("file", f));
      fd.append("soloDetalle", "1");
      const res = await fetch("/api/facturas-xml", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "No se pudieron leer los XML.");
        return;
      }
      const fs: Factura[] = data.facturas ?? [];
      setFacturas(fs);
      // Abre la primera para que se vea el detalle de una.
      setAbiertas(new Set(fs.length ? [0] : []));
      const errs = (data.errores ?? []).length;
      setInfo(
        `${data.leidas} comprobante(s) leído(s)` + (errs ? ` · ${errs} archivo(s) omitido(s)` : "")
      );
    } catch {
      setError("Error de red al leer los XML.");
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function toggle(i: number) {
    setAbiertas((prev) => {
      const n = new Set(prev);
      n.has(i) ? n.delete(i) : n.add(i);
      return n;
    });
  }
  const todasAbiertas = facturas.length > 0 && abiertas.size === facturas.length;
  function toggleTodas() {
    setAbiertas(todasAbiertas ? new Set() : new Set(facturas.map((_, i) => i)));
  }

  async function descargar() {
    setBusy("excel");
    try {
      const res = await fetch("/api/facturas-xml/excel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ facturas, detalle: true }),
      });
      if (!res.ok) {
        setError("No se pudo generar el Excel.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "detalle-facturas-xml.xlsx";
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
    <section className="card p-5">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="font-semibold text-slate-800">Detalle completo de facturas (XML)</h2>
        <span className="badge bg-slate-100 text-slate-500">XML · UBL 2.1 SUNAT</span>
      </div>
      <p className="mb-4 text-xs text-slate-400">
        Sube los <strong>XML</strong> de los comprobantes (en bloque o en ZIP). Extrae{" "}
        <strong>toda la información</strong>: emisor, receptor, montos por afectación (gravado,
        exonerado, inafecto, IGV, ISC, descuentos, total) y el <strong>detalle de cada ítem</strong>{" "}
        (código, descripción, cantidad, unidad, valor unitario, IGV y precio). Puedes descargarlo en Excel.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept=".xml,.zip,text/xml,application/xml,application/zip"
          multiple
          className="hidden"
          onChange={(e) => e.target.files?.length && leer(e.target.files)}
        />
        <button className="btn-primary" onClick={() => fileRef.current?.click()} disabled={trabajando}>
          {busy === "leer" ? "Leyendo…" : "⬆ Subir XML de facturas"}
        </button>
        {facturas.length > 0 && (
          <>
            <button className="btn-ghost" onClick={toggleTodas} disabled={trabajando}>
              {todasAbiertas ? "▲ Contraer todo" : "▼ Expandir todo"}
            </button>
            <button className="btn-ghost" onClick={descargar} disabled={trabajando}>
              {busy === "excel" ? "Generando…" : "⬇ Excel detalle completo"}
            </button>
          </>
        )}
      </div>

      {info && <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">{info}</div>}
      {error && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}

      <div className="mt-5 space-y-3">
        {facturas.map((f, i) => {
          const abierta = abiertas.has(i);
          return (
            <div key={i} className="rounded-xl border border-slate-200">
              {/* Cabecera del comprobante */}
              <button
                onClick={() => toggle(i)}
                className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="badge bg-brand-50 text-brand-700">{f.tipo}</span>
                    <span className="font-semibold text-slate-800">{f.serieNumero}</span>
                    <span className="text-xs text-slate-400">{f.fecha}{f.hora ? ` ${f.hora}` : ""}</span>
                  </div>
                  <div className="mt-1 truncate text-sm text-slate-600">
                    {f.razonSocialEmisor || f.rucEmisor}{" "}
                    <span className="text-xs text-slate-400">· RUC {f.rucEmisor}</span>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="font-semibold tabular-nums text-slate-800">{monto(f.total, f.moneda)}</div>
                  <div className="text-xs text-slate-400">{abierta ? "▲ ocultar" : "▼ ver detalle"}</div>
                </div>
              </button>

              {abierta && (
                <div className="border-t border-slate-100 px-4 py-3">
                  {/* Datos de cabecera */}
                  <div className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
                    <Dato k="Emisor" v={`${f.razonSocialEmisor || "—"} (RUC ${f.rucEmisor})`} />
                    <Dato k="Cliente" v={`${f.razonSocialReceptor || "—"}${f.rucReceptor ? ` (${f.rucReceptor})` : ""}`} />
                    <Dato k="Tipo de doc." v={`${f.tipo}${f.tipoDoc ? ` (${f.tipoDoc})` : ""}`} />
                    <Dato k="Moneda" v={f.moneda} />
                    <Dato k="Gravado" v={monto(f.gravado, f.moneda)} />
                    <Dato k="IGV" v={monto(f.igv, f.moneda)} />
                    {f.exonerado > 0 && <Dato k="Exonerado" v={monto(f.exonerado, f.moneda)} />}
                    {f.inafecto > 0 && <Dato k="Inafecto" v={monto(f.inafecto, f.moneda)} />}
                    {f.isc > 0 && <Dato k="ISC" v={monto(f.isc, f.moneda)} />}
                    {f.descuento > 0 && <Dato k="Descuentos" v={monto(f.descuento, f.moneda)} />}
                    {f.otrosTributos > 0 && <Dato k="Otros tributos" v={monto(f.otrosTributos, f.moneda)} />}
                    <Dato k="Total" v={monto(f.total, f.moneda)} />
                  </div>

                  {/* Detalle de ítems */}
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full min-w-[720px] text-xs">
                      <thead>
                        <tr className="text-left text-[10px] uppercase text-slate-400">
                          <th className="py-1 pr-2">#</th>
                          <th className="py-1 pr-2">Código</th>
                          <th className="py-1 pr-2">Descripción</th>
                          <th className="py-1 pr-2 text-right">Cant.</th>
                          <th className="py-1 pr-2">Und.</th>
                          <th className="py-1 pr-2 text-right">V. unit.</th>
                          <th className="py-1 pr-2 text-right">Valor</th>
                          <th className="py-1 pr-2 text-right">IGV</th>
                          <th className="py-1 pr-2 text-right">P. unit.</th>
                          <th className="py-1 pr-2">Afect.</th>
                        </tr>
                      </thead>
                      <tbody>
                        {f.lineas.map((l, j) => (
                          <tr key={j} className="border-t border-slate-100 align-top">
                            <td className="py-1 pr-2 text-slate-400">{l.numero}</td>
                            <td className="py-1 pr-2 text-slate-500">{l.codigo || "—"}</td>
                            <td className="py-1 pr-2 text-slate-700">{l.descripcion || "—"}</td>
                            <td className="py-1 pr-2 text-right tabular-nums text-slate-600">{l.cantidad}</td>
                            <td className="py-1 pr-2 text-slate-500">{l.unidad || "—"}</td>
                            <td className="py-1 pr-2 text-right tabular-nums text-slate-600">{l.valorUnitario.toFixed(2)}</td>
                            <td className="py-1 pr-2 text-right tabular-nums text-slate-700">{l.valor.toFixed(2)}</td>
                            <td className="py-1 pr-2 text-right tabular-nums text-slate-500">{l.igv.toFixed(2)}</td>
                            <td className="py-1 pr-2 text-right tabular-nums text-slate-600">{l.precioUnitario.toFixed(2)}</td>
                            <td className="py-1 pr-2 text-slate-400">{l.afectacion || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Dato({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-dashed border-slate-100 py-0.5">
      <span className="text-slate-400">{k}</span>
      <span className="text-right font-medium text-slate-700">{v}</span>
    </div>
  );
}
