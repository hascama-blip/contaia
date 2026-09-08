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

export default function HonorariosPanel({ clientes }: { clientes: ClienteMin[] }) {
  const [id, setId] = useState("");
  const [desde, setDesde] = useState(mesActual());
  const [hasta, setHasta] = useState(mesActual());
  const [busy, setBusy] = useState(false);
  const [expBusy, setExpBusy] = useState<"" | "xlsx" | "txt">("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [diagModo, setDiagModo] = useState(false);
  const [diag, setDiag] = useState<string | null>(null);
  const [asientos, setAsientos] = useState<Asiento[]>([]);
  const [nombreBase, setNombreBase] = useState("Honorarios");
  const [aprendidas, setAprendidas] = useState<number | null>(null);
  const [aprendMsg, setAprendMsg] = useState<string | null>(null);
  const [aprendBusy, setAprendBusy] = useState(false);
  const sel = clientes.find((c) => c.id === id) ?? null;

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
    setError(null); setInfo(null); setDiag(null); setAsientos([]);
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
      if (data.nombre) setNombreBase(String(data.nombre).replace(/\.xlsx$/i, ""));
      const n = data.total ?? (data.recibos ?? []).length;
      setInfo(diagModo
        ? `Diagnóstico: ${n} recibo(s) leído(s) (revisa la traza abajo).`
        : `✅ ${n} recibo(s). Completa las cuentas que falten en la tabla y descarga el Excel o el TXT para StarSoft.`);
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

  const faltan = asientos.filter((a) => !a.ctaPagar || !a.ctaGasto).length;

  return (
    <div className="space-y-4">
      <div className="card p-5">
        <h2 className="mb-1 font-semibold text-slate-800">Subida masiva de honorarios (RxH)</h2>
        <p className="mb-4 text-xs text-slate-400">
          El bot inicia sesión en SOL, entra a <strong>Recibo por Honorarios Electrónicos → Consulta Receptor</strong>,
          consulta los recibos <strong>recibidos</strong> por <strong>mes(es) completo(s)</strong> y arma el asiento
          contable. Completa las <strong>cuentas que falten</strong> en la tabla y descarga el <strong>Excel</strong> o el
          <strong> TXT</strong> para importar directo a StarSoft. La <strong>Clave SOL</strong> no se guarda.
        </p>

        <label className="label">Empresa (acceso SOL)</label>
        {clientes.length === 0 ? (
          <p className="text-sm text-slate-500">No tienes empresas. <a href="/clientes/nuevo" className="text-brand-600 hover:underline">Crea una →</a></p>
        ) : (
          <select className="input max-w-sm" value={id} onChange={(e) => setId(e.target.value)}>
            <option value="">— Elige una empresa —</option>
            {clientes.map((c) => <option key={c.id} value={c.id}>{c.razonSocial} · RUC {c.ruc}</option>)}
          </select>
        )}

        {sel && (
          <div className="mt-4 space-y-3">
            <AccesosSol clienteId={sel.id} solUserGuardado={sel.solUser} />
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

      {/* Tabla editable: completar las cuentas que faltan y exportar */}
      {asientos.length > 0 && !diagModo && (
        <div className="card p-5">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold text-slate-800">Asientos ({asientos.length} recibos)</h3>
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
