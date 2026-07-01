"use client";

import { useState, useEffect } from "react";
import { getSolPass } from "@/lib/solSession";
import { usePuedeDiag } from "./SupremoContext";

interface EstadoP { periodo: string; presentadoVentas: boolean | null; presentadoCompras: boolean | null }

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Setiembre", "Octubre", "Noviembre", "Diciembre",
];
function etiqueta(periodo: string): string {
  const anio = periodo.slice(0, 4);
  const mes = Number(periodo.slice(4, 6));
  return `${MESES[mes - 1] ?? "?"} ${anio}`;
}

// Estado SIRE (presentado / no presentado) — check rápido, sin bajar montos.
// Usa la API guardada del cliente + la Clave SOL de la sesión.
export default function EstadoSirePanel({
  clienteId,
  inicialCred,
}: {
  clienteId: string;
  inicialCred?: { solUser: string; clientId: string; clientSecret: string } | null;
}) {
  const hoy = new Date();
  const [mesDesde, setMesDesde] = useState(1);
  const [anioDesde, setAnioDesde] = useState(hoy.getFullYear());
  const [mesHasta, setMesHasta] = useState(hoy.getMonth() + 1);
  const [anioHasta, setAnioHasta] = useState(hoy.getFullYear());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [diag, setDiag] = useState<string | null>(null);
  const [diagModo, setDiagModo] = useState(false);
  const puedeDiag = usePuedeDiag();
  const [estados, setEstados] = useState<EstadoP[] | null>(null);
  const [at, setAt] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // Carga el estado guardado al abrir (sin re-consultar SUNAT).
  useEffect(() => {
    fetch(`/api/clientes/${clienteId}/sire-estado`)
      .then((r) => r.json()).catch(() => ({}))
      .then((d) => { if (Array.isArray(d?.estados) && d.estados.length) { setEstados(d.estados); setAt(d.at ?? null); } });
  }, [clienteId]);

  const apiLista = Boolean(inicialCred?.clientId && inicialCred?.clientSecret);
  const periodoDesde = `${anioDesde}${String(mesDesde).padStart(2, "0")}`;
  const periodoHasta = `${anioHasta}${String(mesHasta).padStart(2, "0")}`;

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

  async function consultar() {
    setError(null); setDiag(null);
    const solPass = getSolPass(clienteId);
    if (!inicialCred?.solUser || !solPass) { setError("Carga tus accesos SOL (arriba) para el estado."); return; }
    if (!apiLista) { setError("Falta el API (client_id/secret). Colócala en el paso de extracción SIRE más abajo."); return; }
    if (periodoDesde > periodoHasta) { setError("El periodo 'Desde' no puede ser mayor que 'Hasta'."); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/clientes/${clienteId}/sire-estado`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ periodos: rangoPeriodos(periodoDesde, periodoHasta), solPass, diagnostico: diagModo }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? "No se pudo consultar el estado."); return; }
      if (data.diag) { setDiag(JSON.stringify(data.diag, null, 2)); return; }
      setEstados(data.estados ?? []);
      setAt(data.at ?? null);
      setInfo(data.limitado ? (data.mensaje ?? null) : null);
    } catch {
      setError("Error de red al consultar el estado del SIRE.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card p-5">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="font-semibold text-slate-800">📋 Estado SIRE (presentado / no presentado)</h3>
        <span className="badge bg-slate-100 text-slate-500">rápido</span>
      </div>
      <p className="mb-3 text-xs text-slate-500">
        Revisa por periodo si el RVIE (ventas) y el RCE (compras) están presentados. No baja montos.
        Se actualiza 1 vez por semana{at ? ` · última: ${new Date(at).toLocaleString("es-PE")}` : ""}.
      </p>
      {info && <div className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">{info}</div>}

      {!apiLista && (
        <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Necesita el <b>API (client_id/secret)</b>. Colócala en <b>“Extracción SIRE”</b> (más abajo) y vuelve aquí.
        </div>
      )}

      <div className="rounded-lg border border-slate-200 p-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Rango (desde → hasta)</p>
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
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button className="btn-primary" onClick={consultar} disabled={busy || !apiLista}>
          {busy ? "Consultando…" : "Ver estado SIRE"}
        </button>
        {puedeDiag && (
          <label className="flex items-center gap-2 text-xs text-slate-500">
            <input type="checkbox" checked={diagModo} onChange={(e) => setDiagModo(e.target.checked)} />
            Modo diagnóstico
          </label>
        )}
      </div>

      {error && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
      {diag && <pre className="mt-3 max-h-72 overflow-auto rounded-lg bg-slate-900 p-3 text-[11px] text-slate-100">{diag}</pre>}

      {estados && estados.length > 0 && (
        <div className="mt-5 overflow-hidden rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-[11px] uppercase text-slate-400">
              <tr>
                <th className="px-3 py-1.5">Periodo</th>
                <th className="px-3 py-1.5">Ventas (RVIE)</th>
                <th className="px-3 py-1.5">Compras (RCE)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {estados.map((e) => (
                <tr key={e.periodo}>
                  <td className="px-3 py-1.5 font-medium text-slate-700">{etiqueta(e.periodo)}</td>
                  <td className="px-3 py-1.5"><EstadoBadge ok={e.presentadoVentas} /></td>
                  <td className="px-3 py-1.5"><EstadoBadge ok={e.presentadoCompras} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function EstadoBadge({ ok }: { ok: boolean | null }) {
  if (ok === null) return <span className="badge bg-slate-100 text-slate-500">? Desconocido</span>;
  return (
    <span className={`badge ${ok ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
      {ok ? "✓ Presentado" : "✕ No presentado"}
    </span>
  );
}
