"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { SireResumen } from "@/lib/types";
import { fmtFecha, fmtSoles } from "./ui";
import { getSolPass } from "@/lib/solSession";

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Setiembre", "Octubre", "Noviembre", "Diciembre",
];

function etiqueta(periodo: string): string {
  const anio = periodo.slice(0, 4);
  const mes = Number(periodo.slice(4, 6));
  return `${MESES[mes - 1] ?? "?"} ${anio}`;
}

// Panel SIRE (Fase 2): extrae compras/ventas y el estado presentado/no presentado.
// Requiere la API (client_id/secret) COLOCADA Y BLOQUEADA. Usuario SOL viene del
// alta; la Clave SOL se pide 1 vez por sesión (nunca se guarda).
export default function SunatPanel({
  clienteId,
  inicialSire,
  inicialCred,
}: {
  clienteId: string;
  inicialSire: SireResumen[];
  inicialCred?: { solUser: string; clientId: string; clientSecret: string } | null;
}) {
  const router = useRouter();
  const hoy = new Date();
  // Usuario SOL viene de los accesos guardados; la Clave SOL se lee de la sesión.
  const solUser = inicialCred?.solUser ?? "";
  const [clientId, setClientId] = useState(inicialCred?.clientId ?? "");
  const [clientSecret, setClientSecret] = useState(inicialCred?.clientSecret ?? "");
  // La API guardada queda BLOQUEADA (solo lectura) y habilita la extracción.
  const [apiBloqueada, setApiBloqueada] = useState(Boolean(inicialCred?.clientId && inicialCred?.clientSecret));
  const [guardandoApi, setGuardandoApi] = useState(false);

  const [mesDesde, setMesDesde] = useState(1);
  const [anioDesde, setAnioDesde] = useState(hoy.getFullYear());
  const [mesHasta, setMesHasta] = useState(hoy.getMonth() + 1);
  const [anioHasta, setAnioHasta] = useState(hoy.getFullYear());

  const [busy, setBusy] = useState<string | null>(null);
  const [progreso, setProgreso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [diag, setDiag] = useState<string | null>(null);
  const [diagModo, setDiagModo] = useState(false);
  const [sire, setSire] = useState<SireResumen[]>(inicialSire ?? []);

  const periodoDesde = `${anioDesde}${String(mesDesde).padStart(2, "0")}`;
  const periodoHasta = `${anioHasta}${String(mesHasta).padStart(2, "0")}`;
  const apiLista = Boolean(clientId && clientSecret && apiBloqueada);

  function rangoPeriodos(desde: string, hasta: string): string[] {
    const out: string[] = [];
    let y = Number(desde.slice(0, 4));
    let m = Number(desde.slice(4, 6));
    const yH = Number(hasta.slice(0, 4));
    const mH = Number(hasta.slice(4, 6));
    let guard = 0;
    while ((y < yH || (y === yH && m <= mH)) && guard < 240) {
      out.push(`${y}${String(m).padStart(2, "0")}`);
      m++;
      if (m > 12) { m = 1; y++; }
      guard++;
    }
    return out;
  }

  async function guardarApi() {
    if (!solUser.trim()) { setError("Carga el Usuario SOL en los accesos de arriba."); return; }
    if (!clientId.trim() || !clientSecret.trim()) { setError("Ingresa el client_id y el client_secret."); return; }
    setGuardandoApi(true);
    setError(null);
    try {
      const res = await fetch(`/api/clientes/${clienteId}/credenciales`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ solUser, clientId, clientSecret }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? "No se pudo guardar la API."); return; }
      setApiBloqueada(true);
      router.refresh();
    } catch {
      setError("Error de red al guardar la API.");
    } finally {
      setGuardandoApi(false);
    }
  }

  async function consultarSire(simulado: boolean, periodoOverride?: string): Promise<boolean> {
    setError(null); setDiag(null);
    const solPass = simulado ? "" : getSolPass(clienteId);
    if (!simulado && (!solUser || !solPass)) { setError("Carga tus accesos SOL (arriba) para extraer."); return false; }
    if (!simulado && !apiLista) { setError("Coloca y guarda la API (client_id/secret) para extraer el SIRE."); return false; }
    setBusy("sire");
    try {
      const res = await fetch(`/api/clientes/${clienteId}/sire`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          periodo: periodoOverride ?? periodoHasta,
          real: !simulado,
          solUser: simulado ? "" : solUser,
          solPass: simulado ? "" : solPass,
          clientId: simulado ? "" : clientId,
          clientSecret: simulado ? "" : clientSecret,
          diagnostico: !simulado && diagModo,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? "No se pudo consultar el SIRE."); return false; }
      if (data.diag) { setDiag(JSON.stringify(data.diag, null, 2)); return false; }
      const r: SireResumen = data.resumen;
      setSire((prev) => [r, ...prev.filter((p) => p.periodo !== r.periodo)]);
      return true;
    } catch {
      setError("Error de red al consultar el SIRE.");
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function recorrerRango() {
    const solPass = getSolPass(clienteId);
    if (!solUser || !solPass) { setError("Carga tus accesos SOL (arriba) para extraer."); return; }
    if (!apiLista) { setError("Coloca y guarda la API (client_id/secret) para extraer el SIRE."); return; }
    if (periodoDesde > periodoHasta) { setError("El periodo 'Desde' no puede ser mayor que 'Hasta'."); return; }
    setBusy("todo"); setError(null); setDiag(null);
    const periodos = rangoPeriodos(periodoDesde, periodoHasta);
    for (let i = 0; i < periodos.length; i++) {
      setProgreso(`SIRE ${etiqueta(periodos[i])} (${i + 1}/${periodos.length})`);
      await consultarSire(false, periodos[i]);
    }
    setProgreso(null); setBusy(null);
    router.refresh();
  }

  async function limpiarSire() {
    if (sire.length === 0) return;
    if (!confirm("¿Borrar el SIRE descargado de este cliente para bajar otro?")) return;
    setBusy("limpiar"); setError(null); setDiag(null);
    try {
      const res = await fetch(`/api/clientes/${clienteId}/sire`, { method: "DELETE" });
      if (!res.ok) { setError("No se pudo limpiar el SIRE."); return; }
      setSire([]);
      router.refresh();
    } catch {
      setError("Error de red al limpiar el SIRE.");
    } finally {
      setBusy(null);
    }
  }

  const trabajando = busy !== null;

  return (
    <section className="card p-5">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="font-semibold text-slate-800">📊 SIRE — compras/ventas y estado</h3>
        <span className="badge bg-slate-100 text-slate-500">Requiere API</span>
      </div>
      <p className="mb-4 text-xs text-slate-400">
        Extrae los montos (RVIE/RCE) y el estado <b>presentado / no presentado</b> por periodo.
        Necesita la <b>API (client_id/secret)</b> colocada y bloqueada.
      </p>

      {/* API: colocar y bloquear */}
      <div className="rounded-lg border border-slate-200 p-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          API SUNAT (SIRE)
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="label">
              client_id {apiBloqueada && <span className="ml-1 text-xs font-normal text-emerald-600">🔒 bloqueado</span>}
            </label>
            <input className={`input ${apiBloqueada ? "cursor-not-allowed bg-slate-100 text-slate-500" : ""}`} value={clientId} onChange={(e) => setClientId(e.target.value)} readOnly={apiBloqueada} autoComplete="off" />
          </div>
          <div>
            <label className="label">
              client_secret {apiBloqueada && <span className="ml-1 text-xs font-normal text-emerald-600">🔒 bloqueado</span>}
            </label>
            <input className={`input ${apiBloqueada ? "cursor-not-allowed bg-slate-100 text-slate-500" : ""}`} type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} readOnly={apiBloqueada} autoComplete="new-password" />
          </div>
        </div>
        {apiBloqueada ? (
          <p className="mt-2 text-xs text-slate-400">
            API guardada y bloqueada. Para extraer solo se pide la <b>Clave SOL</b>.{" "}
            <button type="button" className="text-brand-600 hover:underline" onClick={() => setApiBloqueada(false)}>Editar API</button>
          </p>
        ) : (
          <div className="mt-2 flex items-center gap-3">
            <button type="button" className="btn-primary" onClick={guardarApi} disabled={guardandoApi}>
              {guardandoApi ? "Guardando…" : "Guardar y bloquear API"}
            </button>
            <span className="text-xs text-slate-400">Coloca la API en campo para habilitar el SIRE.</span>
          </div>
        )}
      </div>

      {/* Rango de periodos SIRE */}
      <div className="mt-3 rounded-lg border border-slate-200 p-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Rango SIRE (desde → hasta)
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <label className="label">Mes desde</label>
            <select className="input" value={mesDesde} onChange={(e) => setMesDesde(Number(e.target.value))}>
              {MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Año desde</label>
            <input className="input" type="number" value={anioDesde} min={2018} max={hoy.getFullYear()} onChange={(e) => setAnioDesde(Number(e.target.value))} />
          </div>
          <div>
            <label className="label">Mes hasta</label>
            <select className="input" value={mesHasta} onChange={(e) => setMesHasta(Number(e.target.value))}>
              {MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Año hasta</label>
            <input className="input" type="number" value={anioHasta} min={2018} max={hoy.getFullYear()} onChange={(e) => setAnioHasta(Number(e.target.value))} />
          </div>
        </div>
        <p className="mt-2 text-xs text-slate-400">
          Ej.: Enero 2025 → Diciembre 2025 · Enero 2026 → Junio 2026.
        </p>
      </div>

      <label className="mt-3 flex items-center gap-2 text-xs text-slate-500">
        <input type="checkbox" checked={diagModo} onChange={(e) => setDiagModo(e.target.checked)} />
        Modo diagnóstico (para soporte)
      </label>

      {error && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
      {progreso && <div className="mt-3 rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-700">Extrayendo… {progreso}</div>}

      <div className="mt-4 flex flex-wrap gap-2">
        <button className="btn-primary" onClick={recorrerRango} disabled={trabajando || !apiLista}>
          {busy === "todo" ? "Extrayendo…" : "⚡ Extraer SIRE del rango"}
        </button>
        <button className="btn-ghost" onClick={() => consultarSire(true, periodoHasta)} disabled={trabajando} title="Ejemplo SIRE sin Clave SOL">
          Ver ejemplo
        </button>
      </div>

      {diag && <pre className="mt-3 max-h-72 overflow-auto rounded-lg bg-slate-900 p-3 text-[11px] text-slate-100">{diag}</pre>}

      {sire.length > 0 && (
        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-sm font-semibold text-slate-700">Compras y Ventas (SIRE)</h4>
            <button className="text-xs text-slate-400 hover:text-red-600" onClick={limpiarSire} disabled={trabajando} title="Borrar el SIRE descargado para bajar otro">
              {busy === "limpiar" ? "Limpiando…" : "🧹 Limpiar SIRE"}
            </button>
          </div>
          <Acumulado resultados={sire} />
          <div className="mt-3 space-y-3">
            {sire.map((r) => <ResumenCard key={r.periodo} r={r} />)}
          </div>
        </div>
      )}
    </section>
  );
}

function Acumulado({ resultados }: { resultados: SireResumen[] }) {
  const ventas = resultados.reduce((a, r) => a + r.ventas.importeTotal, 0);
  const compras = resultados.reduce((a, r) => a + r.compras.importeTotal, 0);
  const n = resultados.length;
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Acumulado ({n} mes{n > 1 ? "es" : ""})
      </p>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <div>
          <p className="text-xs text-slate-500">Ventas acumuladas</p>
          <p className="text-xl font-bold text-emerald-600">{fmtSoles(ventas)}</p>
        </div>
        <div>
          <p className="text-xs text-slate-500">Compras acumuladas</p>
          <p className="text-xl font-bold text-blue-600">{fmtSoles(compras)}</p>
        </div>
        <div>
          <p className="text-xs text-slate-500">Diferencia</p>
          <p className={`text-xl font-bold ${ventas - compras >= 0 ? "text-emerald-600" : "text-red-600"}`}>
            {fmtSoles(ventas - compras)}
          </p>
        </div>
      </div>
    </div>
  );
}

function PresentadoBadge({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span className={`badge ${ok ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
      {label}: {ok ? "✓ Presentado" : "✕ No presentado"}
    </span>
  );
}

function ResumenCard({ r }: { r: SireResumen }) {
  const ventas = r.ventas.importeTotal;
  const compras = r.compras.importeTotal;
  const max = Math.max(ventas, compras, 1);
  const balance = ventas - compras;
  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="font-semibold text-slate-800">{etiqueta(r.periodo)}</h4>
        <span className={`badge ${r.fuente === "oficial" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
          {r.fuente === "oficial" ? "SUNAT (real)" : "simulado"}
        </span>
      </div>
      <div className="mb-3 flex flex-wrap gap-2 text-xs">
        <PresentadoBadge label="Ventas (RVIE)" ok={r.presentadoVentas} />
        <PresentadoBadge label="Compras (RCE)" ok={r.presentadoCompras} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Bloque titulo="Ventas (RVIE)" color="bg-emerald-500" total={ventas} pct={(ventas / max) * 100} igv={r.ventas.igv} base={r.ventas.baseImponible} comprobantes={r.ventas.comprobantes} />
        <Bloque titulo="Compras (RCE)" color="bg-blue-500" total={compras} pct={(compras / max) * 100} igv={r.compras.igv} base={r.compras.baseImponible} comprobantes={r.compras.comprobantes} />
      </div>
      <div className="mt-3 flex items-center justify-between rounded-md bg-slate-50 px-3 py-2 text-sm">
        <span className="text-slate-500">Diferencia (ventas − compras)</span>
        <span className={`font-semibold ${balance >= 0 ? "text-emerald-600" : "text-red-600"}`}>{fmtSoles(balance)}</span>
      </div>
      <p className="mt-2 text-right text-xs text-slate-400">Consultado: {fmtFecha(r.consultadoAt)}</p>
    </div>
  );
}

function Bloque({ titulo, color, total, pct, igv, base, comprobantes }: { titulo: string; color: string; total: number; pct: number; igv: number; base: number; comprobantes: number; }) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-slate-600">{titulo}</span>
        <span className="text-xs text-slate-400">{comprobantes} cpe</span>
      </div>
      <p className="mt-1 text-xl font-bold text-slate-800">{fmtSoles(total)}</p>
      <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full ${color}`} style={{ width: `${Math.max(2, pct)}%` }} />
      </div>
      <div className="mt-2 flex justify-between text-xs text-slate-500">
        <span>Base: {fmtSoles(base)}</span>
        <span>IGV: {fmtSoles(igv)}</span>
      </div>
    </div>
  );
}
