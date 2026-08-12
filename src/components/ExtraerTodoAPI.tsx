"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getSolPass } from "@/lib/solSession";

// "Extraer todo (API)" — módulos que dependen de la API SIRE (OAuth2 con
// client_id/secret, NO el login SOL): Estado de presentación + montos
// (compras/ventas) de todo el año, en una sola pasada.
function rango(desde: string, hasta: string): string[] {
  const out: string[] = [];
  let y = Number(desde.slice(0, 4)), m = Number(desde.slice(4, 6));
  const yH = Number(hasta.slice(0, 4)), mH = Number(hasta.slice(4, 6));
  let g = 0;
  while ((y < yH || (y === yH && m <= mH)) && g < 240) {
    out.push(`${y}${String(m).padStart(2, "0")}`);
    m++; if (m > 12) { m = 1; y++; } g++;
  }
  return out;
}

export default function ExtraerTodoAPI({
  clienteId, solUserGuardado, inicialCred,
}: {
  clienteId: string;
  solUserGuardado?: string;
  inicialCred?: { solUser: string; clientId: string; clientSecret: string } | null;
}) {
  const router = useRouter();
  const anio = 2025; // ejercicio a extraer (ajustable a futuro)
  const hoy = new Date();
  const desde = `${anio}01`;
  const hasta = anio === hoy.getFullYear() ? `${anio}${String(hoy.getMonth() + 1).padStart(2, "0")}` : `${anio}12`;

  const [busy, setBusy] = useState(false);
  const [progreso, setProgreso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [res, setRes] = useState<{ estado: boolean; montos: number; total: number } | null>(null);

  const clientId = (inicialCred?.clientId ?? "").trim();
  const clientSecret = (inicialCred?.clientSecret ?? "").trim();
  const solUser = inicialCred?.solUser || solUserGuardado || "";
  const apiLista = Boolean(clientId && clientSecret);

  async function extraer() {
    setError(null); setRes(null);
    const solPass = getSolPass(clienteId);
    if (!solUser || !solPass) { setError("Carga tus accesos SOL (arriba)."); return; }
    if (!apiLista) { setError("Falta el API (client_id/secret). Colócala y guárdala en el paso de Extracción SIRE (abajo)."); return; }
    setBusy(true);
    const periodos = rango(desde, hasta);
    let estadoOk = false, montosOk = 0, total = 0;
    try {
      // 1) Estado de presentación (un solo llamado con todo el rango).
      setProgreso("Estado SIRE (presentado / no presentado)…");
      const e = await fetch(`/api/clientes/${clienteId}/sire-estado`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ periodos, solPass, clientId, clientSecret, forzar: true }),
      });
      estadoOk = e.ok;
      if (!e.ok) { const d = await e.json().catch(() => ({})); setError(d.error ?? "No se pudo el estado SIRE."); }

      // 2) Montos (compras/ventas) mes por mes.
      total = periodos.length;
      for (let i = 0; i < periodos.length; i++) {
        setProgreso(`Montos SIRE ${periodos[i].slice(4)}/${periodos[i].slice(0, 4)} (${i + 1}/${periodos.length})…`);
        const r = await fetch(`/api/clientes/${clienteId}/sire`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ periodo: periodos[i], real: true, solUser, solPass, clientId, clientSecret }),
        });
        if (r.ok) montosOk++;
      }
      setRes({ estado: estadoOk, montos: montosOk, total });
      router.refresh();
    } catch {
      setError("Se cortó la conexión con SUNAT.");
    } finally { setBusy(false); setProgreso(null); }
  }

  return (
    <section className="card border-accent-300 bg-accent-50/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-slate-800">🔑 Extraer todo (API SIRE)</h2>
          <p className="text-xs text-slate-500">
            Módulos que usan la <b>API SIRE</b> (client_id/secret, no el login SOL): <b>Estado de presentación</b> y
            <b> montos</b> (compras/ventas) del ejercicio {anio}. Requiere el API guardado en el paso de Extracción SIRE.
          </p>
        </div>
        <button className="btn-accent" onClick={extraer} disabled={busy}>
          {busy ? "Extrayendo…" : "🔑 Extraer todo (API)"}
        </button>
      </div>
      {progreso && <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">⏳ {progreso}</div>}
      {error && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
      {res && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <div className={`rounded-lg px-3 py-2 text-sm ${res.estado ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
            <b>Estado SIRE:</b> {res.estado ? "actualizado" : "no se pudo"}
          </div>
          <div className={`rounded-lg px-3 py-2 text-sm ${res.montos ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
            <b>Montos:</b> {res.montos} de {res.total} periodo(s)
          </div>
        </div>
      )}
    </section>
  );
}
