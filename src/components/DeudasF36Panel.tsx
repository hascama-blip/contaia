"use client";

import { useEffect, useState, useCallback } from "react";
import { getSolPass } from "@/lib/solSession";

interface Tabla { pestana: string; headers: string[]; filas: string[][] }

export default function DeudasF36Panel({
  clienteId,
  solUserGuardado,
  inicial,
}: {
  clienteId: string;
  solUserGuardado: string;
  inicial: { tablas: Tabla[]; at: string } | null | undefined;
}) {
  const [tablas, setTablas] = useState<Tabla[]>(inicial?.tablas ?? []);
  const [at, setAt] = useState<string | null>(inicial?.at ?? null);
  const [puedeActualizar, setPuedeActualizar] = useState(true);
  const [diasParaActualizar, setDiasParaActualizar] = useState(0);
  const [nota, setNota] = useState<string | null>((inicial as any)?.nota ?? null);
  const [busy, setBusy] = useState<"gen" | "ext" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [forzar, setForzar] = useState(false);
  const [modoDiag, setModoDiag] = useState(false);
  const [diag, setDiag] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      const res = await fetch(`/api/consultas/deudas/extraer?clienteId=${encodeURIComponent(clienteId)}`);
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setTablas(data.tablas ?? []);
        setAt(data.at ?? null);
        setNota(data.nota ?? null);
        setPuedeActualizar(data.puedeActualizar ?? true);
        setDiasParaActualizar(data.diasParaActualizar ?? 0);
      }
    } catch { /* */ }
  }, [clienteId]);
  useEffect(() => { cargar(); }, [cargar]);

  async function llamar(fase: "generar" | "extraer") {
    const solUser = solUserGuardado;
    const solPass = getSolPass(clienteId);
    if (!solUser || !solPass) return setError("Carga tus accesos SOL (arriba) para continuar.");
    setBusy(fase === "generar" ? "gen" : "ext"); setError(null); setDiag(null);
    setInfo(fase === "generar" ? "Generando el pedido de deuda en SUNAT…" : "Consultando y extrayendo las deudas…");
    try {
      const res = await fetch(`/api/consultas/deudas/${fase}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clienteId, solUser, solPass, forzar, diagnostico: modoDiag }),
      });
      const data = await res.json().catch(() => ({}));
      if (modoDiag) { setDiag(JSON.stringify(data, null, 2)); setInfo(null); return; }
      if (!res.ok) {
        setError(data.error ?? "No se pudo completar.");
        if (data.diag) setDiag(JSON.stringify(data.diag, null, 2));
        return;
      }
      if (fase === "extraer" && Array.isArray(data.tablas)) {
        setTablas(data.tablas);
        setNota(data.nota ?? null);
        if (data.at) setAt(data.at);
        if (!data.desdeCache) { setPuedeActualizar(false); setDiasParaActualizar(3); }
      }
      setInfo(data.mensaje ?? "Listo.");
    } catch {
      setError("Se cortó la conexión con SUNAT. Intenta de nuevo.");
    } finally { setBusy(null); }
  }

  const totalRegistros = tablas.reduce((a, t) => a + t.filas.length, 0);

  return (
    <section className="card p-5">
      <div className="mb-3">
        <h2 className="font-semibold text-slate-800">Deudas tributarias (Fraccionamiento Art. 36)</h2>
        <p className="text-xs text-slate-500">
          Extrae las deudas directo de SUNAT (Valores, Autoliquidadas/Reliquidadas, Otras y No acogibles).
          Se actualiza cada 3 días para no saturar SUNAT.
        </p>
      </div>

      {info && <div className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">{info}</div>}
      {error && <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
      {nota && (
        <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          ⚠ <b>SUNAT:</b> {nota}
        </div>
      )}

      <div className="mt-1 flex flex-wrap items-center gap-3">
        <button className="btn-ghost" onClick={() => llamar("generar")} disabled={busy !== null}>
          {busy === "gen" ? "Generando…" : "1) Generar pedido"}
        </button>
        <button className="btn-primary" onClick={() => llamar("extraer")} disabled={busy !== null || (!puedeActualizar && !forzar)}>
          {busy === "ext" ? "Extrayendo…" : puedeActualizar ? "2) Consultar y extraer" : `2) Actualizar (en ~${diasParaActualizar} día/s)`}
        </button>
        {!puedeActualizar && (
          <label className="flex items-center gap-2 text-xs text-amber-600">
            <input type="checkbox" checked={forzar} onChange={(e) => setForzar(e.target.checked)} />
            Forzar (ignora el límite de 3 días)
          </label>
        )}
        <label className="flex items-center gap-2 text-xs text-slate-500">
          <input type="checkbox" checked={modoDiag} onChange={(e) => setModoDiag(e.target.checked)} />
          Modo diagnóstico
        </label>
      </div>

      {diag && (
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-900 p-3">
          <p className="mb-1 text-xs font-semibold text-slate-300">Diagnóstico (cópialo y pásamelo para calibrar):</p>
          <pre className="max-h-80 overflow-auto text-[11px] leading-relaxed text-emerald-300">{diag}</pre>
        </div>
      )}
      <p className="mt-2 text-xs text-amber-600">
        ⏱️ Tras “Generar pedido”, espera ~5 min antes de “Consultar y extraer”.
        {at ? ` Última extracción: ${new Date(at).toLocaleString("es-PE")}.` : ""}
      </p>

      {tablas.length > 0 ? (
        <div className="mt-4 space-y-4">
          <p className="text-xs text-slate-500">{totalRegistros} deuda(s) en {tablas.length} sección(es).</p>
          {tablas.map((t) => (
            <div key={t.pestana} className="overflow-hidden rounded-lg border border-slate-200">
              <div className="border-b border-slate-100 bg-slate-50 px-3 py-2">
                <h3 className="text-sm font-semibold text-slate-800">{t.pestana}</h3>
                <p className="text-[11px] text-slate-400">{t.filas.length} registro(s)</p>
              </div>
              {t.filas.length === 0 ? (
                <p className="px-3 py-3 text-xs text-slate-400">Sin deudas.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    {t.headers.length > 0 && (
                      <thead className="bg-slate-50 text-left text-[11px] uppercase text-slate-400">
                        <tr>{t.headers.map((h, i) => <th key={i} className="whitespace-nowrap px-3 py-1.5">{h}</th>)}</tr>
                      </thead>
                    )}
                    <tbody className="divide-y divide-slate-100">
                      {t.filas.map((f, r) => (
                        <tr key={r}>{f.map((c, i) => <td key={i} className="whitespace-nowrap px-3 py-1.5 text-slate-700">{c}</td>)}</tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : at ? (
        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-700">
          ✅ Esta empresa <b>no cuenta con deudas pendientes</b> de acoger al fraccionamiento.
        </div>
      ) : null}
    </section>
  );
}
