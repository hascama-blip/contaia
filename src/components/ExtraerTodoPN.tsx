"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getSolPass, getSolUser } from "@/lib/solSession";

// "Extraer todo (persona natural)": en UNA sola sesión SUNAT genera el Reporte
// de Rentas 4ta/5ta y consulta el ITF (el 2º reutiliza el login del 1º).
export default function ExtraerTodoPN({ clienteId, solUserGuardado, personaNatural }: { clienteId: string; solUserGuardado?: string; personaNatural?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [res, setRes] = useState<any>(null);

  async function extraer() {
    setError(null); setRes(null);
    const solPass = getSolPass(clienteId);
    const solUser = getSolUser(clienteId, solUserGuardado);
    if (!solPass) { setError("Carga tu Clave SOL en un apartado de abajo."); return; }
    setBusy(true);
    const ctrl = new AbortController();
    const tope = setTimeout(() => ctrl.abort(), 260000);
    try {
      const r = await fetch(`/api/clientes/${clienteId}/extraer-pn`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ solUser, solPass }), signal: ctrl.signal,
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) { setError(data.error ?? "No se pudo extraer."); setRes(data.parcial ?? null); return; }
      setRes(data);
      router.refresh();
    } catch (e: any) {
      setError(e?.name === "AbortError" ? "Tardó demasiado (SUNAT lento o bloqueado)." : "Error de red.");
    } finally { clearTimeout(tope); setBusy(false); }
  }

  return (
    <section className="card border-brand-200 bg-brand-50/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-slate-800">⚡ Extraer todo (una sola sesión)</h2>
          <p className="text-xs text-slate-500">
            Con <b>un solo inicio de sesión</b> en SUNAT: consulta el <b>buzón</b> y genera el pedido de
            <b> fraccionamiento</b>{personaNatural ? <>, genera el <b>Reporte de Rentas (4ta/5ta)</b> y consulta el <b>ITF</b></> : null}
            {" "}(reduce el riesgo de bloqueo). Usa la Clave SOL que cargues en los apartados de abajo. El
            SIRE se extrae aparte (usa su propia API, no el login SOL).
          </p>
        </div>
        <button className="btn-primary" onClick={extraer} disabled={busy}>
          {busy ? "Extrayendo…" : "⚡ Extraer todo"}
        </button>
      </div>
      {error && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
      {res && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <Estado titulo="Buzón" r={res.buzon} okTxt={res.buzon?.omitido ? (res.buzon.nota ?? "omitido") : `${res.buzon?.mensajes ?? 0} mensaje(s) · ${res.buzon?.peligrosos ?? 0} peligroso(s)`} />
          <Estado titulo="Fraccionamiento" r={res.fraccionamiento} okTxt={res.fraccionamiento?.omitido ? (res.fraccionamiento.nota ?? "omitido") : `Pedido generado${res.fraccionamiento?.numPedido ? ` N° ${res.fraccionamiento.numPedido}` : ""} — usa Verificar/Extraer`} />
          <Estado titulo="Rentas 4ta/5ta" r={res.rentas} okTxt="Solicitado — llegará por la nube" />
          <Estado titulo="ITF" r={res.itf} okTxt={res.itf?.registros ? `${res.itf.registros} registro(s)` : "Sin registros de ITF"} />
        </div>
      )}
    </section>
  );
}

function Estado({ titulo, r, okTxt }: { titulo: string; r: any; okTxt: string }) {
  if (!r) return null;
  return (
    <div className={`rounded-lg px-3 py-2 text-sm ${r.ok ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
      <span className="font-semibold">{titulo}:</span> {r.ok ? okTxt : (r.error ?? "no se pudo")}
    </div>
  );
}
