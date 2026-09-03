"use client";

import { useState } from "react";
import AccesosSol from "./AccesosSol";
import { getSolPass, getSolUser } from "@/lib/solSession";

interface ClienteMin { id: string; razonSocial: string; ruc: string; solUser: string }

// Mes actual en formato YYYY-MM (valor de <input type="month">).
function mesActual(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function HonorariosPanel({ clientes }: { clientes: ClienteMin[] }) {
  const [id, setId] = useState("");
  const [desde, setDesde] = useState(mesActual());
  const [hasta, setHasta] = useState(mesActual());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [diagModo, setDiagModo] = useState(false);
  const [diag, setDiag] = useState<string | null>(null);
  const [aprendidas, setAprendidas] = useState<number | null>(null);
  const [aprendMsg, setAprendMsg] = useState<string | null>(null);
  const [aprendBusy, setAprendBusy] = useState(false);
  const sel = clientes.find((c) => c.id === id) ?? null;

  // Sube la plantilla YA LLENA del mes anterior para aprender las cuentas.
  async function aprender(file: File) {
    setAprendBusy(true); setAprendMsg(null);
    try {
      const fd = new FormData(); fd.append("archivo", file);
      const res = await fetch("/api/honorarios/aprender", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setAprendMsg(data.error ?? "No se pudo aprender."); return; }
      setAprendidas(data.total ?? null);
      setAprendMsg(`✅ Aprendidas ${data.aprendidas} combinaciones (memoria total: ${data.total}). Se aplicarán en la próxima extracción.`);
    } catch { setAprendMsg("Error de red al subir la plantilla."); }
    finally { setAprendBusy(false); }
  }

  async function extraer() {
    setError(null); setInfo(null); setDiag(null);
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
      // Descargar el Excel generado (plantilla Contasis) si vino en la respuesta.
      if (!diagModo && data.archivo) {
        const bin = atob(data.archivo);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = data.nombre || "Honorarios.xlsx";
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(url);
      }
      const n = data.total ?? (data.recibos ?? []).length;
      setInfo(diagModo ? `Diagnóstico: ${n} recibo(s) leído(s) (revisa la traza abajo).` : `✅ ${n} recibo(s) extraído(s). Se descargó el Excel (plantilla Contasis).`);
    } catch {
      setError("Error de red al extraer.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="card p-5">
        <h2 className="mb-1 font-semibold text-slate-800">Subida masiva de honorarios (RxH)</h2>
        <p className="mb-4 text-xs text-slate-400">
          El bot inicia sesión en SOL y entra a <strong>Recibo por Honorarios Electrónicos → Consulta Receptor</strong>,
          consulta los recibos <strong>recibidos</strong> por <strong>mes(es) completo(s)</strong> y arma la plantilla de
          importación (Contasis). La <strong>Clave SOL</strong> no se guarda.
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
              <p className="pb-2 text-[11px] text-slate-400">Siempre se consultan meses completos (del día 1 al último día).</p>
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

      {/* Aprender cuentas del mes anterior */}
      <div className="card p-5">
        <h3 className="font-semibold text-slate-800">🧠 Heredar cuentas del mes anterior</h3>
        <p className="mt-1 text-xs text-slate-500">
          Sube la <strong>plantilla YA LLENA del mes pasado</strong> (con las cuentas que puso el contador).
          El sistema aprende, por <strong>emisor + concepto</strong>, qué cuentas usar. En la próxima extracción,
          si el mismo emisor repite el mismo servicio, las <strong>cuentas se llenan solas</strong>; si no hay
          antecedente, quedan en blanco para el contador.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className={`btn-ghost cursor-pointer ${aprendBusy ? "pointer-events-none opacity-50" : ""}`}>
            {aprendBusy ? "Aprendiendo…" : "⬆ Subir plantilla del mes pasado"}
            <input
              type="file" accept=".xlsx" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) aprender(f); e.currentTarget.value = ""; }}
            />
          </label>
          {aprendidas != null && <span className="text-xs text-slate-500">Memoria: {aprendidas} combinaciones</span>}
        </div>
        {aprendMsg && <p className="mt-2 text-xs text-slate-600">{aprendMsg}</p>}
      </div>
    </div>
  );
}
