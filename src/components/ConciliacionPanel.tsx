"use client";

import { useState } from "react";

const soles = (n: any) => "S/ " + (Number(n) || 0).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Conciliación bancaria: extracto (PDF) + libro banco (Excel) + caja virtual
// (Excel, opcional) → Excel conciliado. El match es por N° de operación del
// banco (que aparece como "Nro. Doc." en el libro y "Nro. Referencia" en caja),
// con respaldo por fecha + monto.
export default function ConciliacionPanel() {
  const [fExtracto, setFExtracto] = useState<File | null>(null);
  const [fLibro, setFLibro] = useState<File | null>(null);
  const [fCaja, setFCaja] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [res, setRes] = useState<any>(null);

  async function conciliar() {
    if (!fExtracto) return setError("Adjunta el extracto bancario (PDF o Excel).");
    if (!fLibro) return setError("Adjunta el libro banco (Excel).");
    setBusy(true); setError(null); setRes(null);
    try {
      const fd = new FormData();
      fd.append("extracto", fExtracto);
      fd.append("libro", fLibro);
      if (fCaja) fd.append("caja", fCaja);
      const r = await fetch("/api/conciliacion", { method: "POST", body: fd });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) { setError(data.error ?? "No se pudo conciliar."); return; }
      setRes(data);
    } catch { setError("Error de red (¿archivo muy pesado?)."); }
    finally { setBusy(false); }
  }

  function descargar() {
    if (!res?.excelBase64) return;
    const bin = atob(res.excelBase64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `conciliacion-${(res.periodo?.desde || "").slice(0, 7) || "banco"}.xlsx`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  const rs = res?.resumen;

  return (
    <div className="space-y-4">
      <div className="card p-5">
        <div className="grid gap-4 md:grid-cols-3">
          <Uploader
            titulo="1 · Extracto bancario"
            detalle="PDF del banco (BCP, con capa de texto) o Excel (FORMATO BANCO STARSOFT o export del banco)."
            accept=".pdf,.xlsx,.xls"
            file={fExtracto}
            onFile={setFExtracto}
            obligatorio
          />
          <Uploader
            titulo="2 · Libro banco (contabilidad)"
            detalle="Excel con Fecha, Nro. Doc., Glosa, Ingreso, Egreso."
            accept=".xlsx,.xls"
            file={fLibro}
            onFile={setFLibro}
            obligatorio
          />
          <Uploader
            titulo="3 · Caja virtual (opcional)"
            detalle="Excel de ingresos con Nro. Referencia y Comprobante."
            accept=".xlsx,.xls"
            file={fCaja}
            onFile={setFCaja}
          />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button className="btn-primary" onClick={conciliar} disabled={busy}>
            {busy ? "Conciliando…" : "⚖ Conciliar"}
          </button>
          {res && (
            <button className="btn-accent" onClick={descargar}>
              ⬇ Descargar Excel conciliado
            </button>
          )}
        </div>
        {error && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
      </div>

      {rs && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi titulo="% conciliado" valor={`${rs.pctConciliado}%`} tono={rs.pctConciliado >= 90 ? "ok" : rs.pctConciliado >= 70 ? "warn" : "bad"} />
            <Kpi titulo="Conciliados" valor={String(rs.conciliadosOp + rs.conciliadosFechaMonto)} sub={`${rs.conciliadosOp} por N° op · ${rs.conciliadosFechaMonto} por fecha+monto`} tono="ok" />
            <Kpi titulo="Banco sin contabilizar" valor={String(rs.bancoSinLibro)} sub="movimientos del extracto sin registro" tono={rs.bancoSinLibro ? "warn" : "ok"} />
            <Kpi titulo="Libro sin banco" valor={String(rs.libroSinBanco)} sub="registros contables sin respaldo" tono={rs.libroSinBanco ? "warn" : "ok"} />
          </div>
          <div className="card p-4 text-sm text-slate-600">
            <p className="mb-1 font-semibold text-slate-700">Periodo {res.periodo?.desde} al {res.periodo?.hasta}</p>
            <div className="grid gap-1 sm:grid-cols-2">
              <p>Extracto: {rs.movsBanco} movs · abonos {soles(rs.totalAbonos)} · cargos {soles(rs.totalCargos)}</p>
              <p>Libro banco: {rs.filasLibro} registros · ingresos {soles(rs.totalIngresos)} · egresos {soles(rs.totalEgresos)}</p>
              {rs.filasCaja > 0 && <p>Caja virtual: {rs.filasCaja} filas ({rs.cajaConRef} con referencia bancaria) · {rs.cajaSinBanco} sin aparecer en el banco</p>}
            </div>
            <p className="mt-2 text-xs text-slate-400">
              El detalle completo (conciliados, banco sin contabilizar, libro sin banco, caja sin banco) está en el Excel.
            </p>
          </div>

          {res.muestraBancoSinLibro?.length > 0 && (
            <Muestra titulo={`Banco sin contabilizar (primeros ${res.muestraBancoSinLibro.length})`}>
              {res.muestraBancoSinLibro.map((m: any, i: number) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="px-3 py-1 text-slate-600">{m.fecha}</td>
                  <td className="px-3 py-1 text-slate-600">{m.desc}</td>
                  <td className="px-3 py-1 text-slate-500">{m.numOp}</td>
                  <td className="px-3 py-1 text-slate-600">{m.tipo}</td>
                  <td className="px-3 py-1 text-right tabular-nums text-slate-700">{soles(m.monto)}</td>
                </tr>
              ))}
            </Muestra>
          )}
          {res.muestraLibroSinBanco?.length > 0 && (
            <Muestra titulo={`Libro sin banco (primeros ${res.muestraLibroSinBanco.length})`} cab={["Fecha", "Doc", "Glosa", "Ingreso", "Egreso"]}>
              {res.muestraLibroSinBanco.map((l: any, i: number) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="px-3 py-1 text-slate-600">{l.fecha}</td>
                  <td className="px-3 py-1 text-slate-500">{l.doc}</td>
                  <td className="px-3 py-1 text-slate-600">{l.glosa}</td>
                  <td className="px-3 py-1 text-right tabular-nums text-slate-700">{l.ingreso ? soles(l.ingreso) : ""}</td>
                  <td className="px-3 py-1 text-right tabular-nums text-slate-700">{l.egreso ? soles(l.egreso) : ""}</td>
                </tr>
              ))}
            </Muestra>
          )}
        </>
      )}
    </div>
  );
}

function Uploader({ titulo, detalle, accept, file, onFile, obligatorio }: {
  titulo: string; detalle: string; accept: string; file: File | null;
  onFile: (f: File | null) => void; obligatorio?: boolean;
}) {
  return (
    <label className={`block cursor-pointer rounded-xl border-2 border-dashed p-4 transition hover:border-brand-400 ${file ? "border-emerald-300 bg-emerald-50/40" : "border-slate-300"}`}>
      <p className="text-sm font-semibold text-slate-700">
        {titulo} {obligatorio ? <span className="text-red-500">*</span> : <span className="text-xs font-normal text-slate-400">(opcional)</span>}
      </p>
      <p className="mt-0.5 text-xs text-slate-500">{detalle}</p>
      <p className="mt-2 truncate text-xs font-medium text-slate-600">{file ? `✓ ${file.name}` : "Haz clic para elegir el archivo…"}</p>
      <input type="file" accept={accept} className="hidden" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
    </label>
  );
}

function Kpi({ titulo, valor, sub, tono }: { titulo: string; valor: string; sub?: string; tono: "ok" | "warn" | "bad" }) {
  const cls = tono === "ok" ? "text-emerald-600" : tono === "warn" ? "text-amber-600" : "text-red-600";
  return (
    <div className="card p-4">
      <p className="text-xs uppercase text-slate-400">{titulo}</p>
      <p className={`text-2xl font-extrabold ${cls}`}>{valor}</p>
      {sub && <p className="text-[11px] text-slate-400">{sub}</p>}
    </div>
  );
}

function Muestra({ titulo, cab, children }: { titulo: string; cab?: string[]; children: React.ReactNode }) {
  return (
    <div className="card overflow-hidden p-0">
      <div className="border-b border-slate-100 px-4 py-2">
        <h3 className="text-sm font-semibold text-slate-800">{titulo}</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-left text-[10px] uppercase text-slate-400">
            <tr>{(cab ?? ["Fecha", "Descripción", "N° op", "Tipo", "Monto"]).map((h, i) => <th key={i} className="px-3 py-2">{h}</th>)}</tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </div>
  );
}
