"use client";

import { useState } from "react";
import type { BuzonMensaje, SireResumen } from "@/lib/types";
import { fmtFecha, fmtSoles } from "./ui";

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Setiembre", "Octubre", "Noviembre", "Diciembre",
];

function etiqueta(periodo: string): string {
  const anio = periodo.slice(0, 4);
  const mes = Number(periodo.slice(4, 6));
  return `${MESES[mes - 1] ?? "?"} ${anio}`;
}

export default function SunatPanel({
  clienteId,
  inicialSire,
}: {
  clienteId: string;
  inicialSire: SireResumen[];
}) {
  const hoy = new Date();
  // Credenciales (se ingresan UNA vez para todo).
  const [solUser, setSolUser] = useState("");
  const [solPass, setSolPass] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  // Periodo SIRE.
  const [mes, setMes] = useState(hoy.getMonth() + 1);
  const [anio, setAnio] = useState(hoy.getFullYear());

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [diag, setDiag] = useState<string | null>(null);
  const [diagModo, setDiagModo] = useState(false);

  const [sire, setSire] = useState<SireResumen[]>(inicialSire ?? []);
  const [buzon, setBuzon] = useState<BuzonMensaje[] | null>(null);
  const [urgentes, setUrgentes] = useState<BuzonMensaje[]>([]);

  const periodo = `${anio}${String(mes).padStart(2, "0")}`;

  function faltanCreds(): boolean {
    if (!solUser || !solPass) {
      setError("Ingresa el Usuario SOL y la Clave SOL.");
      return true;
    }
    return false;
  }

  async function consultarSire(
    simulado: boolean,
    periodoOverride?: string
  ): Promise<boolean> {
    setError(null);
    setDiag(null);
    if (!simulado && faltanCreds()) return false;
    setBusy("sire");
    try {
      const res = await fetch(`/api/clientes/${clienteId}/sire`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          periodo: periodoOverride ?? periodo,
          real: !simulado,
          solUser: simulado ? "" : solUser,
          solPass: simulado ? "" : solPass,
          clientId: simulado ? "" : clientId,
          clientSecret: simulado ? "" : clientSecret,
          diagnostico: !simulado && diagModo,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "No se pudo consultar el SIRE.");
        return false;
      }
      if (data.diag) {
        setDiag(JSON.stringify(data.diag, null, 2));
        return false;
      }
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

  async function consultarBuzon(): Promise<boolean> {
    setError(null);
    setDiag(null);
    if (faltanCreds()) return false;
    setBusy("buzon");
    try {
      const res = await fetch(`/api/clientes/${clienteId}/buzon`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ solUser, solPass, clientId, clientSecret, dias: 15, diagnostico: diagModo }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "No se pudo consultar el buzón.");
        return false;
      }
      if (data.diag) {
        setDiag(JSON.stringify(data.diag, null, 2));
        return false;
      }
      setBuzon(data.mensajes ?? []);
      setUrgentes(data.urgentes ?? []);
      return true;
    } catch {
      setError("Error de red al consultar el buzón.");
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function extraerTodo() {
    if (faltanCreds()) return;
    setBusy("todo");
    setError(null);
    setDiag(null);
    // SIRE de TODOS los meses del año en curso (enero -> mes actual).
    const anioActual = hoy.getFullYear();
    const mesActual = hoy.getMonth() + 1;
    for (let m = 1; m <= mesActual; m++) {
      const per = `${anioActual}${String(m).padStart(2, "0")}`;
      await consultarSire(false, per);
    }
    // Buzón del mes presente (últimos 15 días).
    await consultarBuzon();
    setBusy(null);
    // Limpiamos la clave solo al terminar todo el proceso.
    setSolPass("");
    setClientSecret("");
  }

  const trabajando = busy !== null;

  return (
    <section className="card p-5">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="font-semibold text-slate-800">Consulta SUNAT</h2>
        <span className="badge bg-slate-100 text-slate-500">SIRE + Buzón</span>
      </div>
      <p className="mb-4 text-xs text-slate-400">
        Ingresa las credenciales <strong>una sola vez</strong> y extrae compras/ventas
        (SIRE) y los mensajes del buzón. La Clave SOL se usa solo para la consulta y{" "}
        <strong>no se guarda</strong>.
      </p>

      {/* Credenciales (una vez) */}
      <div className="rounded-lg border border-slate-200 p-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Credenciales SOL
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Usuario SOL</label>
            <input className="input" value={solUser} onChange={(e) => setSolUser(e.target.value)} autoComplete="off" />
          </div>
          <div>
            <label className="label">Clave SOL</label>
            <input className="input" type="password" value={solPass} onChange={(e) => setSolPass(e.target.value)} autoComplete="new-password" />
          </div>
          <div>
            <label className="label">client_id</label>
            <input className="input" value={clientId} onChange={(e) => setClientId(e.target.value)} autoComplete="off" />
          </div>
          <div>
            <label className="label">client_secret</label>
            <input className="input" type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} autoComplete="new-password" />
          </div>
        </div>
      </div>

      {/* Periodo SIRE */}
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <label className="label">Mes (SIRE)</label>
          <select className="input" value={mes} onChange={(e) => setMes(Number(e.target.value))}>
            {MESES.map((m, i) => (
              <option key={m} value={i + 1}>{m}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Año</label>
          <input className="input" type="number" value={anio} min={2018} max={hoy.getFullYear()} onChange={(e) => setAnio(Number(e.target.value))} />
        </div>
      </div>

      <label className="mt-3 flex items-center gap-2 text-xs text-slate-500">
        <input type="checkbox" checked={diagModo} onChange={(e) => setDiagModo(e.target.checked)} />
        Modo diagnóstico (para soporte)
      </label>

      {error && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}

      <div className="mt-4 flex flex-wrap gap-2">
        <button className="btn-primary" onClick={extraerTodo} disabled={trabajando}>
          {busy === "todo" ? "Extrayendo…" : "⚡ Extraer todo de SUNAT"}
        </button>
        <button className="btn-ghost" onClick={() => consultarSire(false)} disabled={trabajando}>
          {busy === "sire" ? "SIRE…" : `Solo SIRE ${etiqueta(periodo)}`}
        </button>
        <button className="btn-ghost" onClick={consultarBuzon} disabled={trabajando}>
          {busy === "buzon" ? "Buzón…" : "Solo buzón"}
        </button>
        <button className="btn-ghost" onClick={() => consultarSire(true)} disabled={trabajando} title="Ejemplo SIRE sin Clave SOL">
          Ver ejemplo
        </button>
      </div>

      {diag && (
        <pre className="mt-3 max-h-72 overflow-auto rounded-lg bg-slate-900 p-3 text-[11px] text-slate-100">{diag}</pre>
      )}

      {/* Resultados SIRE */}
      {sire.length > 0 && (
        <div className="mt-5">
          <h3 className="mb-2 text-sm font-semibold text-slate-700">Compras y Ventas (SIRE)</h3>
          <Acumulado resultados={sire} />
          <div className="mt-3 space-y-3">
            {sire.map((r) => (
              <ResumenCard key={r.periodo} r={r} />
            ))}
          </div>
        </div>
      )}

      {/* Resultados Buzón */}
      {buzon && (
        <div className="mt-6">
          <h3 className="mb-2 text-sm font-semibold text-slate-700">
            Buzón electrónico (últimos 15 días)
          </h3>
          {urgentes.length > 0 && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3">
              <p className="mb-2 text-sm font-semibold text-red-700">
                ⚠ {urgentes.length} urgente(s) — cobranza / valores
              </p>
              <ul className="space-y-2">
                {urgentes.map((m) => <MensajeItem key={m.id} m={m} />)}
              </ul>
            </div>
          )}
          <p className="mb-2 mt-3 text-xs font-semibold uppercase text-slate-400">
            Todos ({buzon.length})
          </p>
          {buzon.length === 0 ? (
            <p className="text-sm text-slate-400">Sin mensajes en los últimos 15 días.</p>
          ) : (
            <ul className="space-y-2">
              {buzon.map((m) => <MensajeItem key={m.id} m={m} />)}
            </ul>
          )}
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

function MensajeItem({ m }: { m: BuzonMensaje }) {
  return (
    <li className={`rounded-md border p-2 text-sm ${m.urgente ? "border-red-200 bg-white" : "border-slate-200"}`}>
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium text-slate-800">{m.asunto || "(sin asunto)"}</span>
        {m.urgente && <span className="badge shrink-0 bg-red-100 text-red-700">urgente</span>}
      </div>
      <p className="text-xs text-slate-500">{m.fecha}{m.tipo && <> · {m.tipo}</>}</p>
    </li>
  );
}
