"use client";

import { useEffect, useState, useCallback } from "react";

interface ClienteOpt { id: string; razonSocial: string; ruc: string; solUser: string }
interface Tabla { pestana: string; headers: string[]; filas: string[][] }

export default function DeudasF36Flow({ clientes }: { clientes: ClienteOpt[] }) {
  const [clienteId, setClienteId] = useState(clientes[0]?.id ?? "");
  const [solUser, setSolUser] = useState(clientes[0]?.solUser ?? "");
  const [solPass, setSolPass] = useState("");
  const [tablas, setTablas] = useState<Tabla[]>([]);
  const [at, setAt] = useState<string | null>(null);
  const [puedeActualizar, setPuedeActualizar] = useState(true);
  const [diasParaActualizar, setDiasParaActualizar] = useState(0);
  const [busy, setBusy] = useState<"gen" | "ext" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [modoDiag, setModoDiag] = useState(false);
  const [forzar, setForzar] = useState(false);
  const [diag, setDiag] = useState<string | null>(null);

  const cargarGuardadas = useCallback(async (id: string) => {
    if (!id) return;
    try {
      const res = await fetch(`/api/consultas/deudas/extraer?clienteId=${encodeURIComponent(id)}`);
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setTablas(data.tablas ?? []);
        setAt(data.at ?? null);
        setPuedeActualizar(data.puedeActualizar ?? true);
        setDiasParaActualizar(data.diasParaActualizar ?? 0);
      }
    } catch { /* */ }
  }, []);

  useEffect(() => { cargarGuardadas(clienteId); }, [clienteId, cargarGuardadas]);

  function elegir(id: string) {
    setClienteId(id);
    setSolUser(clientes.find((c) => c.id === id)?.solUser ?? "");
    setTablas([]); setAt(null); setError(null); setInfo(null);
  }

  async function llamar(fase: "generar" | "extraer") {
    if (!clienteId) return setError("Elige una empresa.");
    if (!solPass) return setError("Ingresa la Clave SOL.");
    setBusy(fase === "generar" ? "gen" : "ext"); setError(null); setDiag(null);
    setInfo(fase === "generar" ? "Generando el pedido de deuda en SUNAT…" : "Consultando el estado y extrayendo las deudas…");
    try {
      const res = await fetch(`/api/consultas/deudas/${fase}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clienteId, solUser, solPass, diagnostico: modoDiag, forzar }),
      });
      const data = await res.json().catch(() => ({}));
      if (modoDiag) { setDiag(JSON.stringify(data, null, 2)); setInfo(null); return; }
      if (!res.ok) {
        setError(data.error ?? "No se pudo completar.");
        if (data.diag) setDiag(JSON.stringify(data.diag, null, 2));
        return;
      }
      if (fase === "extraer") {
        if (Array.isArray(data.tablas)) setTablas(data.tablas);
        if (data.at) setAt(data.at);
        if (!data.desdeCache) { setPuedeActualizar(false); setDiasParaActualizar(3); }
      }
      setInfo(data.mensaje ?? "Listo.");
    } catch {
      setError("Se cortó la conexión con SUNAT. Intenta de nuevo.");
    } finally { setBusy(null); }
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-slate-800">Deudas tributarias (Fraccionamiento Art. 36)</h2>
        <p className="text-sm text-slate-500">
          Genera el pedido de deuda en SUNAT, espera ~5 minutos y extrae las deudas (Valores,
          Autoliquidadas/Reliquidadas, Otras y No acogibles).
        </p>
      </div>

      {info && <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">{info}</div>}
      {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
      {diag && (
        <div className="rounded-lg border border-slate-200 bg-slate-900 p-3">
          <p className="mb-1 text-xs font-semibold text-slate-300">Diagnóstico (cópialo y pásamelo para calibrar):</p>
          <pre className="max-h-80 overflow-auto text-[11px] leading-relaxed text-emerald-300">{diag}</pre>
        </div>
      )}

      {clientes.length === 0 ? (
        <div className="card p-6 text-sm text-slate-500">Crea una empresa para usar este módulo.</div>
      ) : (
        <div className="card p-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="text-xs font-semibold text-slate-600">Empresa</label>
              <select className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm outline-none focus:border-brand-500"
                value={clienteId} onChange={(e) => elegir(e.target.value)}>
                {clientes.map((c) => <option key={c.id} value={c.id}>{c.razonSocial} ({c.ruc})</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600">Usuario SOL</label>
              <input className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm outline-none focus:border-brand-500"
                value={solUser} onChange={(e) => setSolUser(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600">Clave SOL</label>
              <input type="password" className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm outline-none focus:border-brand-500"
                value={solPass} onChange={(e) => setSolPass(e.target.value)} placeholder="No se guarda" />
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button className="btn-primary" onClick={() => llamar("generar")} disabled={busy !== null}>
              {busy === "gen" ? "Generando…" : "1) Generar pedido de deuda"}
            </button>
            <button className="btn-primary" onClick={() => llamar("extraer")} disabled={busy !== null || (!puedeActualizar && !forzar)}>
              {busy === "ext" ? "Extrayendo…" : puedeActualizar ? "2) Consultar y extraer" : `2) Actualizar (en ~${diasParaActualizar} día(s))`}
            </button>
            <label className="flex items-center gap-2 text-xs text-slate-500">
              <input type="checkbox" checked={modoDiag} onChange={(e) => setModoDiag(e.target.checked)} />
              Modo diagnóstico
            </label>
            {!puedeActualizar && (
              <label className="flex items-center gap-2 text-xs text-amber-600">
                <input type="checkbox" checked={forzar} onChange={(e) => setForzar(e.target.checked)} />
                Forzar ahora (ignora el límite de 3 días)
              </label>
            )}
          </div>
          <p className="mt-2 text-xs text-amber-600">
            ⏱️ Para no saturar SUNAT (te bloquea por “spam”), las deudas se actualizan <b>cada 3 días</b>.
            Dentro de ese plazo se muestran las guardadas. La nueva extracción <b>reemplaza</b> la anterior.
            {at && !puedeActualizar ? ` Última: ${new Date(at).toLocaleString("es-PE")}.` : ""}
          </p>
        </div>
      )}

      {tablas.length > 0 && (
        <div className="space-y-4">
          {at && <p className="text-xs text-slate-400">Extraído: {new Date(at).toLocaleString("es-PE")}</p>}
          {tablas.map((t) => (
            <div key={t.pestana} className="card overflow-hidden p-0">
              <div className="border-b border-slate-100 px-4 py-2">
                <h3 className="font-semibold text-slate-800">{t.pestana}</h3>
                <p className="text-xs text-slate-400">{t.filas.length} registro(s)</p>
              </div>
              {t.filas.length === 0 ? (
                <p className="px-4 py-4 text-sm text-slate-400">Sin deudas en esta pestaña.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    {t.headers.length > 0 && (
                      <thead className="bg-slate-50 text-left text-xs uppercase text-slate-400">
                        <tr>{t.headers.map((h, i) => <th key={i} className="px-3 py-2 whitespace-nowrap">{h}</th>)}</tr>
                      </thead>
                    )}
                    <tbody className="divide-y divide-slate-100">
                      {t.filas.map((f, r) => (
                        <tr key={r}>{f.map((c, i) => <td key={i} className="px-3 py-2 text-slate-700 whitespace-nowrap">{c}</td>)}</tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
