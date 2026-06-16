"use client";

import { useState } from "react";
import type { SireResumen } from "@/lib/types";
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

export default function SirePanel({
  clienteId,
  inicial,
}: {
  clienteId: string;
  inicial: SireResumen[];
}) {
  const hoy = new Date();
  // Por defecto, el mes anterior (suele ser el último declarado).
  const refMes = hoy.getMonth() === 0 ? 12 : hoy.getMonth();
  const refAnio = hoy.getMonth() === 0 ? hoy.getFullYear() - 1 : hoy.getFullYear();

  const [mes, setMes] = useState(refMes);
  const [anio, setAnio] = useState(refAnio);
  const [solUser, setSolUser] = useState("");
  const [solPass, setSolPass] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultados, setResultados] = useState<SireResumen[]>(inicial ?? []);

  const periodo = `${anio}${String(mes).padStart(2, "0")}`;

  async function consultar(simulado: boolean) {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/clientes/${clienteId}/sire`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          periodo,
          // En modo simulado mandamos credenciales vacías a propósito.
          solUser: simulado ? "" : solUser,
          solPass: simulado ? "" : solPass,
          clientId: simulado ? "" : clientId,
          clientSecret: simulado ? "" : clientSecret,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "No se pudo consultar el SIRE.");
        return;
      }
      const r: SireResumen = data.resumen;
      setResultados((prev) => [r, ...prev.filter((p) => p.periodo !== r.periodo)]);
      // Por seguridad, limpiamos la contraseña tras la consulta.
      setSolPass("");
      setClientSecret("");
    } catch {
      setError("Error de red al consultar SIRE.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card p-5">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="font-semibold text-slate-800">Compras y Ventas (SIRE)</h2>
        <span className="badge bg-slate-100 text-slate-500">RVIE · RCE</span>
      </div>
      <p className="mb-4 text-xs text-slate-400">
        Resumen mensual desde el SIRE de SUNAT. La Clave SOL se usa solo para esta
        consulta y <strong>no se guarda</strong>.
      </p>

      {/* Selección de periodo */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <label className="label">Mes</label>
          <select
            className="input"
            value={mes}
            onChange={(e) => setMes(Number(e.target.value))}
          >
            {MESES.map((m, i) => (
              <option key={m} value={i + 1}>{m}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Año</label>
          <input
            className="input"
            type="number"
            value={anio}
            min={2018}
            max={hoy.getFullYear()}
            onChange={(e) => setAnio(Number(e.target.value))}
          />
        </div>
        <div className="col-span-2">
          <label className="label">Usuario SOL</label>
          <input
            className="input"
            value={solUser}
            onChange={(e) => setSolUser(e.target.value)}
            placeholder="usuario secundario"
            autoComplete="off"
          />
        </div>
        <div className="col-span-2">
          <label className="label">Clave SOL</label>
          <input
            className="input"
            type="password"
            value={solPass}
            onChange={(e) => setSolPass(e.target.value)}
            placeholder="••••••••"
            autoComplete="new-password"
          />
        </div>
      </div>

      <button
        type="button"
        className="mt-2 text-xs text-brand-600 hover:underline"
        onClick={() => setShowAdvanced((v) => !v)}
      >
        {showAdvanced ? "Ocultar" : "Opciones avanzadas (credencial app SIRE)"}
      </button>
      {showAdvanced && (
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="label">client_id</label>
            <input
              className="input"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              autoComplete="off"
            />
          </div>
          <div>
            <label className="label">client_secret</label>
            <input
              className="input"
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              autoComplete="new-password"
            />
          </div>
          <p className="text-xs text-slate-400 sm:col-span-2">
            Si tu plataforma ya tiene una credencial SIRE configurada, deja estos
            campos vacíos.
          </p>
        </div>
      )}

      {error && (
        <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          className="btn-primary"
          onClick={() => consultar(false)}
          disabled={busy}
        >
          {busy ? "Consultando…" : `Consultar ${etiqueta(periodo)}`}
        </button>
        <button
          className="btn-ghost"
          onClick={() => consultar(true)}
          disabled={busy}
          title="Genera un resumen de ejemplo, sin usar la Clave SOL"
        >
          Ver ejemplo (simulado)
        </button>
      </div>

      {/* Resultados */}
      {resultados.length > 0 && (
        <div className="mt-5 space-y-4">
          {resultados.map((r) => (
            <ResumenCard key={r.periodo} r={r} />
          ))}
        </div>
      )}
    </section>
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
        <h3 className="font-semibold text-slate-800">{etiqueta(r.periodo)}</h3>
        <span
          className={`badge ${r.fuente === "oficial" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}
        >
          {r.fuente === "oficial" ? "SUNAT (real)" : "simulado"}
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Bloque
          titulo="Ventas (RVIE)"
          color="bg-emerald-500"
          total={ventas}
          pct={(ventas / max) * 100}
          igv={r.ventas.igv}
          base={r.ventas.baseImponible}
          comprobantes={r.ventas.comprobantes}
        />
        <Bloque
          titulo="Compras (RCE)"
          color="bg-blue-500"
          total={compras}
          pct={(compras / max) * 100}
          igv={r.compras.igv}
          base={r.compras.baseImponible}
          comprobantes={r.compras.comprobantes}
        />
      </div>

      <div className="mt-3 flex items-center justify-between rounded-md bg-slate-50 px-3 py-2 text-sm">
        <span className="text-slate-500">Diferencia (ventas − compras)</span>
        <span className={`font-semibold ${balance >= 0 ? "text-emerald-600" : "text-red-600"}`}>
          {fmtSoles(balance)}
        </span>
      </div>
      <p className="mt-2 text-right text-xs text-slate-400">
        Consultado: {fmtFecha(r.consultadoAt)}
      </p>
    </div>
  );
}

function Bloque({
  titulo,
  color,
  total,
  pct,
  igv,
  base,
  comprobantes,
}: {
  titulo: string;
  color: string;
  total: number;
  pct: number;
  igv: number;
  base: number;
  comprobantes: number;
}) {
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
