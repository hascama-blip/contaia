"use client";

import { useEffect, useState } from "react";
import AccesosSol from "./AccesosSol";
import { getSolPass, getSolUser } from "@/lib/solSession";

interface ClienteMin { id: string; razonSocial: string; ruc: string; solUser: string }

interface Asiento {
  comprobante: string; anioMes: string; subdiario: string; fechaDoc: string; fechaReg: string;
  tipoAnexo: string; codProveedor: string; nroDoc: string; importe: number; conv: string; tc: string;
  glosa: string; destino: string; glosaMov: string; anulado: string;
  ctaPagar: string; ctaGasto: string; centro: string; nro: string; nombre: string;
}

// Recibo tal cual lo lee el bot en SUNAT (Consulta Receptor), sin tocar.
interface Recibo {
  fecha: string; td: string; nro: string; estado: string; tipoDocEmisor: string; nroDocEmisor: string; nombre: string;
  tipoRenta: string; gratuito: string; moneda: string; rentaBruta: string; impRenta: string; rentaNeta: string; pendiente: string;
  concepto?: string;
}

const esAnulado = (estado: string) => /anulad/i.test(estado || "") && !/no\s*anulad/i.test(estado || "");
const fmtMonto = (s: string) => {
  const t = String(s || "").trim();
  const limpio = t.lastIndexOf(",") > t.lastIndexOf(".") ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  const n = Number(limpio.replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) && t ? n.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : (t || "—");
};

// Mes actual en formato YYYY-MM (valor de <input type="month">).
function mesActual(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function descargar(b64: string, nombre: string, mime: string) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = nombre;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

// `clienteFijo`: cuando el panel va EMBEBIDO (Descarga masiva de comprobantes),
// la empresa y la Clave SOL ya se eligieron arriba: no se repiten aquí.
export default function HonorariosPanel({ clientes, clienteFijo }: { clientes: ClienteMin[]; clienteFijo?: ClienteMin }) {
  const [id, setId] = useState(clienteFijo?.id ?? "");
  const [desde, setDesde] = useState(mesActual());
  const [hasta, setHasta] = useState(mesActual());
  const [busy, setBusy] = useState(false);
  const [expBusy, setExpBusy] = useState<"" | "xlsx" | "txt" | "detalle">("");
  const [recibos, setRecibos] = useState<Recibo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [diagModo, setDiagModo] = useState(false);
  const [diag, setDiag] = useState<string | null>(null);
  const [asientos, setAsientos] = useState<Asiento[]>([]);
  const [nombreBase, setNombreBase] = useState("Honorarios");
  const [aprendidas, setAprendidas] = useState<number | null>(null);
  const [aprendMsg, setAprendMsg] = useState<string | null>(null);
  const [aprendBusy, setAprendBusy] = useState(false);
  const sel = clienteFijo ?? clientes.find((c) => c.id === id) ?? null;

  useEffect(() => {
    fetch("/api/honorarios/aprender", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && typeof d.total === "number") setAprendidas(d.total); })
      .catch(() => {});
  }, []);

  async function aprender(file: File) {
    setAprendBusy(true); setAprendMsg(null);
    try {
      const fd = new FormData(); fd.append("archivo", file);
      const res = await fetch("/api/honorarios/aprender", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setAprendMsg(data.error ?? "No se pudo aprender."); return; }
      setAprendidas(data.total ?? null);
      setAprendMsg(`✅ Aprendidas ${data.aprendidas} combinaciones (memoria total: ${data.total}).`);
    } catch { setAprendMsg("Error de red al subir la plantilla."); }
    finally { setAprendBusy(false); }
  }

  async function extraer() {
    setError(null); setInfo(null); setDiag(null); setAsientos([]); setRecibos([]);
    if (!sel) { setError("Elige la empresa con la que inicias sesión en SOL."); return; }
    const solPass = getSolPass(sel.id);
    const solUser = getSolUser(sel.id, sel.solUser);
    if (!solPass) { setError("Carga tu Clave SOL (arriba)."); return; }
    if (!/^\d{11}$/.test(sel.ruc.replace(/\D/g, ""))) { setError("La empresa no tiene un RUC válido."); return; }
    if (!desde) { setError("Elige el mes inicial."); return; }
    const h = hasta || desde;
    if (h < desde) { setError("El mes final no puede ser anterior al inicial."); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/honorarios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ruc: sel.ruc, rucLogin: sel.ruc, solUser, solPass, desde, hasta: h, diagnostico: diagModo }),
      });
      const data = await res.json().catch(() => ({}));
      if (diagModo && data.diag) setDiag(JSON.stringify(data.diag, null, 2));
      if (!res.ok) { setError(data.error ?? "No se pudo extraer los honorarios."); return; }
      const arr: Asiento[] = Array.isArray(data.asientos) ? data.asientos : [];
      setAsientos(arr);
      setRecibos(Array.isArray(data.recibos) ? data.recibos : []);
      if (data.nombre) setNombreBase(String(data.nombre).replace(/\.xlsx$/i, ""));
      const n = data.total ?? (data.recibos ?? []).length;
      setInfo(diagModo
        ? `Diagnóstico: ${n} recibo(s) leído(s) (revisa la traza abajo).`
        : `✅ ${n} recibo(s) leído(s). Descarga el detalle en Excel (sin cuentas) o completa las cuentas que falten y baja el Excel/TXT para StarSoft.` +
          (data.avisoTope ? ` ⚠ ${data.avisoTope}` : ""));
    } catch { setError("Error de red al extraer."); }
    finally { setBusy(false); }
  }

  function editar(i: number, campo: keyof Asiento, valor: string) {
    setAsientos((prev) => prev.map((a, j) => (j === i ? { ...a, [campo]: valor } : a)));
  }

  async function exportar(formato: "xlsx" | "txt") {
    if (!asientos.length) return;
    setExpBusy(formato); setError(null);
    try {
      const res = await fetch("/api/honorarios/exportar", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ asientos, formato, nombre: nombreBase }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? "No se pudo exportar."); return; }
      descargar(data.archivo, data.nombre, data.mime || "application/octet-stream");
    } catch { setError("Error de red al exportar."); }
    finally { setExpBusy(""); }
  }

  // Detalle en Excel de los recibos tal cual (sin cuentas contables ni formato
  // de importación): para cuando solo se quiere la relación de recibos.
  async function exportarDetalle() {
    if (!recibos.length) return;
    setExpBusy("detalle"); setError(null);
    try {
      const res = await fetch("/api/honorarios/exportar", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          formato: "detalle", recibos, nombre: nombreBase,
          meta: { ruc: sel?.ruc ?? "", razonSocial: sel?.razonSocial ?? "", desde, hasta: hasta || desde },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? "No se pudo generar el detalle."); return; }
      descargar(data.archivo, data.nombre, data.mime || "application/octet-stream");
    } catch { setError("Error de red al exportar."); }
    finally { setExpBusy(""); }
  }

  const faltan = asientos.filter((a) => !a.ctaPagar || !a.ctaGasto).length;
  const validos = recibos.filter((r) => !esAnulado(r.estado));
  const anulados = recibos.length - validos.length;

  return (
    <div className="space-y-4">
      <div className="card p-5">
        <h2 className="mb-1 font-semibold text-slate-800">Subida masiva de honorarios (RxH)</h2>
        <p className="mb-4 text-xs text-slate-400">
          El bot inicia sesión en SOL, entra a <strong>Recibo por Honorarios Electrónicos → Consulta Receptor</strong>,
          lee los recibos <strong>recibidos</strong> por <strong>mes(es) completo(s)</strong> (con el concepto de cada uno)
          y te da dos salidas: el <strong>detalle en Excel</strong> tal cual (sin cuentas contables) y el asiento contable,
          donde completas las <strong>cuentas que falten</strong> y descargas el <strong>Excel</strong> o el
          <strong> TXT</strong> para importar directo a StarSoft. La <strong>Clave SOL</strong> no se guarda.
        </p>

        {!clienteFijo && (
          <>
            <label className="label">Empresa (acceso SOL)</label>
            {clientes.length === 0 ? (
              <p className="text-sm text-slate-500">No tienes empresas. <a href="/clientes/nuevo" className="text-brand-600 hover:underline">Crea una →</a></p>
            ) : (
              <select className="input max-w-sm" value={id} onChange={(e) => setId(e.target.value)}>
                <option value="">— Elige una empresa —</option>
                {clientes.map((c) => <option key={c.id} value={c.id}>{c.razonSocial} · RUC {c.ruc}</option>)}
              </select>
            )}
          </>
        )}

        {sel && (
          <div className={`${clienteFijo ? "" : "mt-4 "}space-y-3`}>
            {!clienteFijo && <AccesosSol clienteId={sel.id} solUserGuardado={sel.solUser} />}
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="label">Mes inicial</label>
                <input type="month" className="input w-44" value={desde} onChange={(e) => setDesde(e.target.value)} />
              </div>
              <div>
                <label className="label">Mes final</label>
                <input type="month" className="input w-44" value={hasta} onChange={(e) => setHasta(e.target.value)} />
              </div>
              <p className="pb-2 text-[11px] text-slate-400">Siempre se consultan meses completos (la fecha fin se topa a hoy).</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button className="btn-primary" onClick={extraer} disabled={busy}>
                {busy ? "Extrayendo…" : "📥 Extraer honorarios"}
              </button>
              <label className="flex items-center gap-2 text-xs text-slate-500">
                <input type="checkbox" checked={diagModo} onChange={(e) => setDiagModo(e.target.checked)} /> Modo diagnóstico
              </label>
            </div>
          </div>
        )}

        {info && <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">{info}</div>}
        {error && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
        {diag && diagModo && <pre className="mt-3 max-h-96 overflow-auto rounded-lg bg-slate-900 p-3 text-[11px] text-slate-100">{diag}</pre>}
      </div>

      {/* Lectura de los recibos: lo que se leyó de SUNAT + detalle en Excel (sin cuentas) */}
      {recibos.length > 0 && !diagModo && (
        <div className="card p-5">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold text-slate-800">📄 Recibos leídos ({recibos.length})</h3>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">{validos.length} válidos</span>
              {anulados > 0 && <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-500">{anulados} anulados</span>}
              <button className="btn-accent" onClick={exportarDetalle} disabled={!!expBusy} title="Excel con una fila por recibo (fecha, serie-número, emisor, renta bruta, retención, neta, T.C., concepto) y hoja Resumen por emisor y por mes. Sin cuentas contables.">
                {expBusy === "detalle" ? "Generando…" : "⬇ Detalle en Excel (sin cuentas)"}
              </button>
            </div>
          </div>
          <p className="mb-2 text-[11px] text-slate-500">
            Es la relación tal cual la lee SUNAT: una fila por recibo con fecha, serie-número, estado, emisor, moneda, renta bruta,
            retención, renta neta, pendiente de pago, T.C. SUNAT (si es en dólares) y el concepto completo. Trae además la hoja{" "}
            <b>Resumen</b> con totales, por emisor y por mes. Si solo necesitas el detalle, no hace falta llenar cuentas.
          </p>
          <div className="sin-barra max-h-72 overflow-auto rounded-lg border border-slate-200">
            <table className="min-w-full text-[12px]">
              <thead className="sticky top-0 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-2 py-1.5 text-left">Fecha</th>
                  <th className="px-2 py-1.5 text-left">Recibo</th>
                  <th className="px-2 py-1.5 text-left">Estado</th>
                  <th className="px-2 py-1.5 text-left">Emisor</th>
                  <th className="px-2 py-1.5 text-left">Moneda</th>
                  <th className="px-2 py-1.5 text-right">Renta bruta</th>
                  <th className="px-2 py-1.5 text-right">Retención</th>
                  <th className="px-2 py-1.5 text-right">Renta neta</th>
                  <th className="px-2 py-1.5 text-left">Concepto</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recibos.map((r, i) => {
                  const anul = esAnulado(r.estado);
                  return (
                    <tr key={i} className={anul ? "text-slate-400 line-through" : "hover:bg-slate-50"}>
                      <td className="px-2 py-1 whitespace-nowrap">{r.fecha}</td>
                      <td className="px-2 py-1 whitespace-nowrap font-medium text-slate-700">{r.td} {r.nro}</td>
                      <td className="px-2 py-1 whitespace-nowrap">{r.estado}</td>
                      <td className="px-2 py-1" title={r.nombre}>{r.nroDocEmisor}<div className="max-w-[180px] truncate text-[10px] text-slate-400">{r.nombre}</div></td>
                      <td className="px-2 py-1 whitespace-nowrap">{r.moneda}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{fmtMonto(r.rentaBruta)}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{fmtMonto(r.impRenta)}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{fmtMonto(r.rentaNeta)}</td>
                      <td className="px-2 py-1 text-slate-500" title={r.concepto || ""}><div className="max-w-[260px] truncate">{r.concepto || "—"}</div></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tabla editable: completar las cuentas que faltan y exportar */}
      {asientos.length > 0 && !diagModo && (
        <div className="card p-5">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold text-slate-800">Asiento contable para StarSoft ({asientos.length} recibos)</h3>
            <div className="flex items-center gap-2">
              {faltan > 0
                ? <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-700">⚠ {faltan} sin cuenta</span>
                : <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">✅ Cuentas completas</span>}
              <button className="btn-accent" onClick={() => exportar("xlsx")} disabled={!!expBusy}>{expBusy === "xlsx" ? "…" : "⬇ Excel (.xls)"}</button>
              <button className="btn-primary" onClick={() => exportar("txt")} disabled={!!expBusy}>{expBusy === "txt" ? "…" : "⬇ TXT (StarSoft)"}</button>
            </div>
          </div>
          <p className="mb-2 text-[11px] text-slate-500">
            Edita la <b>Cta. por pagar (H)</b>, la <b>Cta. gasto (D)</b> y el <b>Centro</b> donde falten. Lo aprendido del
            mes anterior ya viene lleno. El concepto se recorta a 60 caracteres (límite de StarSoft).
          </p>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="min-w-full text-[12px]">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-2 py-1.5 text-left">Comp.</th>
                  <th className="px-2 py-1.5 text-left">Fecha</th>
                  <th className="px-2 py-1.5 text-left">Recibo</th>
                  <th className="px-2 py-1.5 text-left">Emisor</th>
                  <th className="px-2 py-1.5 text-right">Importe</th>
                  <th className="px-2 py-1.5 text-right">TC</th>
                  <th className="px-2 py-1.5 text-left">Cta. por pagar (H)</th>
                  <th className="px-2 py-1.5 text-left">Cta. gasto (D)</th>
                  <th className="px-2 py-1.5 text-left">Centro</th>
                  <th className="px-2 py-1.5 text-left">Dest.</th>
                  <th className="px-2 py-1.5 text-left">Concepto (glosa)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {asientos.map((a, i) => (
                  <tr key={i} className={!a.ctaPagar || !a.ctaGasto ? "bg-amber-50/40" : "hover:bg-slate-50"}>
                    <td className="px-2 py-1 text-slate-500">{a.comprobante}</td>
                    <td className="px-2 py-1 text-slate-500">{a.fechaDoc}</td>
                    <td className="px-2 py-1 font-medium text-slate-700">{a.nro}</td>
                    <td className="px-2 py-1 text-slate-600" title={a.nombre}>{a.codProveedor}<div className="max-w-[160px] truncate text-[10px] text-slate-400">{a.nombre}</div></td>
                    <td className="px-2 py-1 text-right tabular-nums text-slate-600">{a.importe.toLocaleString("es-PE", { minimumFractionDigits: 2 })}</td>
                    <td className="px-2 py-1 text-right tabular-nums text-slate-400">{a.tc || "—"}</td>
                    <td className="px-2 py-1"><input value={a.ctaPagar} onChange={(e) => editar(i, "ctaPagar", e.target.value)} className={`w-24 rounded border px-1.5 py-0.5 text-[12px] ${a.ctaPagar ? "border-slate-200" : "border-amber-300 bg-amber-50"}`} placeholder="——" /></td>
                    <td className="px-2 py-1"><input value={a.ctaGasto} onChange={(e) => editar(i, "ctaGasto", e.target.value)} className={`w-24 rounded border px-1.5 py-0.5 text-[12px] ${a.ctaGasto ? "border-slate-200" : "border-amber-300 bg-amber-50"}`} placeholder="——" /></td>
                    <td className="px-2 py-1"><input value={a.centro} onChange={(e) => editar(i, "centro", e.target.value)} className="w-20 rounded border border-slate-200 px-1.5 py-0.5 text-[12px]" placeholder="——" /></td>
                    <td className="px-2 py-1"><input value={a.destino} onChange={(e) => editar(i, "destino", e.target.value)} className="w-14 rounded border border-slate-200 px-1.5 py-0.5 text-[12px]" /></td>
                    <td className="px-2 py-1"><input value={a.glosaMov} maxLength={60} onChange={(e) => editar(i, "glosaMov", e.target.value)} className="w-64 rounded border border-slate-200 px-1.5 py-0.5 text-[12px]" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-slate-400">
            El TXT sale separado por “|”, codificación ANSI y nombre <b>H_…</b>, listo para importar en StarSoft.
          </p>
        </div>
      )}

      {/* Aprender cuentas del mes anterior */}
      <div className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold text-slate-800">🧠 Heredar cuentas del mes anterior</h3>
          {aprendidas != null && (
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${aprendidas > 0 ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
              {aprendidas > 0 ? `✅ Memoria activa: ${aprendidas} combinaciones` : "Sin memoria aún"}
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-slate-500">
          {aprendidas && aprendidas > 0
            ? <>Ya hay cuentas aprendidas — <strong>no necesitas volver a subir</strong> la plantilla. Solo sube una nueva si quieres <strong>actualizar</strong>.</>
            : <>Sube la <strong>plantilla YA LLENA del mes pasado</strong>. Se aprende, por <strong>emisor + concepto</strong>, qué cuentas usar. Solo se sube <strong>una vez</strong>.</>}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className={`btn-ghost cursor-pointer ${aprendBusy ? "pointer-events-none opacity-50" : ""}`}>
            {aprendBusy ? "Aprendiendo…" : (aprendidas && aprendidas > 0 ? "⬆ Actualizar memoria (opcional)" : "⬆ Subir plantilla del mes pasado")}
            <input type="file" accept=".xlsx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) aprender(f); e.currentTarget.value = ""; }} />
          </label>
        </div>
        {aprendMsg && <p className="mt-2 text-xs text-slate-600">{aprendMsg}</p>}
      </div>
    </div>
  );
}
