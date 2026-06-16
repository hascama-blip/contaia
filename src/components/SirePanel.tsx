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
  // Por defecto, el MES EN CURSO (la propuesta SUNAT corresponde al mes actual).
  const refMes = hoy.getMonth() + 1;
  const refAnio = hoy.getFullYear();

  const [mes, setMes] = useState(refMes);
  const [anio, setAnio] = useState(refAnio);
  const [solUser, setSolUser] = useState("");
  const [solPass, setSolPass] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [diagModo, setDiagModo] = useState(false);
  const [diag, setDiag] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultados, setResultados] = useState<SireResumen[]>(inicial ?? []);

  const periodo = `${anio}${String(mes).padStart(2, "0")}`;

  async function consultar(simulado: boolean) {
    setError(null);
    setDiag(null);
    // En consulta real exigimos las credenciales antes de enviar.
    if (!simulado && (!solUser || !solPass)) {
      setError("Ingresa el Usuario SOL y la Clave SOL para la consulta real.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/clientes/${clienteId}/sire`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          periodo,
          real: !simulado,
          // En modo simulado mandamos credenciales vacías a propósito.
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
        return;
      }
      if (data.diag) {
        // Modo diagnóstico: mostramos la traza para calibrar la integración.
        setDiag(JSON.stringify(data.diag, null, 2));
        setSolPass("");
        setClientSecret("");
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

      <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
        <p className="text-xs font-medium text-amber-800">
          Credencial de aplicación SIRE (requerida para datos reales)
        </p>
        <p className="mt-1 text-xs text-amber-700">
          SUNAT exige, además de la Clave SOL, un <strong>client_id</strong> y{" "}
          <strong>client_secret</strong> que el contribuyente genera una sola vez en
          SUNAT SOL. Si solo quieres ver un ejemplo, usa “Ver ejemplo (simulado)”.
        </p>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="label">client_id</label>
            <input
              className="input"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="requerido para datos reales"
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
              placeholder="requerido para datos reales"
              autoComplete="new-password"
            />
          </div>
        </div>
        <p className="mt-2 text-xs text-amber-700">
          Si tu plataforma ya tiene una credencial SIRE configurada (a nivel servidor),
          deja estos campos vacíos.
        </p>
      </div>

      <label className="mt-3 flex items-center gap-2 text-xs text-slate-500">
        <input
          type="checkbox"
          checked={diagModo}
          onChange={(e) => setDiagModo(e.target.checked)}
        />
        Modo diagnóstico (para soporte): muestra la respuesta cruda de SUNAT en
        cada paso, sin guardar nada.
      </label>

      {error && (
        <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </div>
      )}

      {diag && (
        <div className="mt-3">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-600">
              Diagnóstico (cópialo y compártelo con soporte)
            </span>
            <button
              type="button"
              className="text-xs text-brand-600 hover:underline"
              onClick={() => navigator.clipboard?.writeText(diag)}
            >
              Copiar
            </button>
          </div>
          <pre className="max-h-72 overflow-auto rounded-lg bg-slate-900 p-3 text-[11px] leading-relaxed text-slate-100">
            {diag}
          </pre>
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

      {/* Acumulado de todos los periodos consultados */}
      {resultados.length > 0 && <Acumulado resultados={resultados} />}

      {/* Resultados por periodo */}
      {resultados.length > 0 && (
        <div className="mt-4 space-y-4">
          {resultados.map((r) => (
            <ResumenCard key={r.periodo} r={r} />
          ))}
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
    <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
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
