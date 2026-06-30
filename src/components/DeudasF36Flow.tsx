"use client";

import { useEffect, useState, useCallback } from "react";
import { getSolPass, setSolPass as setSolPassSesion } from "@/lib/solSession";
import { usePuedeDiag } from "./SupremoContext";

interface ClienteOpt { id: string; razonSocial: string; ruc: string; solUser: string }
interface Tabla { pestana: string; headers: string[]; filas: string[][] }
type Estado = "sin-pedido" | "en-proceso" | "listo" | "extraido" | "vencido";

const BADGE: Record<Estado, { txt: string; cls: string }> = {
  "sin-pedido": { txt: "Sin pedido", cls: "bg-slate-100 text-slate-500" },
  "en-proceso": { txt: "⏳ En proceso (SUNAT calculando)", cls: "bg-amber-100 text-amber-700" },
  listo: { txt: "✅ Listo para extraer", cls: "bg-emerald-100 text-emerald-700" },
  extraido: { txt: "📥 Extraído", cls: "bg-sky-100 text-sky-700" },
  vencido: { txt: "⚠ Vencido — genera de nuevo", cls: "bg-red-100 text-red-700" },
};

export default function DeudasF36Flow({ clientes }: { clientes: ClienteOpt[] }) {
  const [clienteId, setClienteId] = useState(clientes[0]?.id ?? "");
  const [solUser, setSolUser] = useState(clientes[0]?.solUser ?? "");
  const [solPass, setSolPass] = useState("");
  const [tablas, setTablas] = useState<Tabla[]>([]);
  const [at, setAt] = useState<string | null>(null);
  const [estado, setEstado] = useState<Estado>("sin-pedido");
  const [numPedido, setNumPedido] = useState<string | null>(null);
  const [busy, setBusy] = useState<"gen" | "ver" | "ext" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [modoDiag, setModoDiag] = useState(false);
  const [diag, setDiag] = useState<string | null>(null);
  const puedeDiag = usePuedeDiag();

  const cargarGuardadas = useCallback(async (id: string) => {
    if (!id) return;
    try {
      const [x, e] = await Promise.all([
        fetch(`/api/consultas/deudas/extraer?clienteId=${encodeURIComponent(id)}`).then((r) => r.json()).catch(() => ({})),
        fetch(`/api/consultas/deudas/estado?clienteId=${encodeURIComponent(id)}`).then((r) => r.json()).catch(() => ({})),
      ]);
      if (Array.isArray(x?.tablas)) { setTablas(x.tablas); setAt(x.at ?? null); }
      if (e?.estado) { setEstado(e.estado); setNumPedido(e.numPedido ?? null); }
    } catch { /* */ }
  }, []);

  useEffect(() => {
    cargarGuardadas(clienteId);
    setSolPass(getSolPass(clienteId));
  }, [clienteId, cargarGuardadas]);
  useEffect(() => { if (solPass) setSolPassSesion(clienteId, solPass); }, [clienteId, solPass]);

  function elegir(id: string) {
    setClienteId(id);
    setSolUser(clientes.find((c) => c.id === id)?.solUser ?? "");
    setTablas([]); setAt(null); setError(null); setInfo(null); setEstado("sin-pedido"); setNumPedido(null);
  }

  async function llamar(fase: "generar" | "extraer" | "estado") {
    if (!clienteId) return setError("Elige una empresa.");
    if (!solPass) return setError("Ingresa la Clave SOL.");
    setBusy(fase === "generar" ? "gen" : fase === "estado" ? "ver" : "ext"); setError(null); setDiag(null);
    setInfo(fase === "generar" ? "Generando el pedido de deuda… (puede tardar 1-3 min)" : fase === "estado" ? "Verificando el estado del pedido…" : "Extrayendo las deudas…");
    const ctrl = new AbortController();
    const tope = setTimeout(() => ctrl.abort(), 240000); // 4 min máx
    try {
      const res = await fetch(`/api/consultas/deudas/${fase}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clienteId, solUser, solPass, diagnostico: modoDiag, forzar: true }),
        signal: ctrl.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (modoDiag) { setDiag(JSON.stringify(data, null, 2)); setInfo(null); return; }
      if (!res.ok) {
        setError(data.error ?? "No se pudo completar.");
        if (data.diag) setDiag(JSON.stringify(data.diag, null, 2));
        return;
      }
      if (fase === "generar") { setEstado("en-proceso"); if (data.numPedido) setNumPedido(data.numPedido); }
      if (fase === "estado" && data.estado) { setEstado(data.estado); setNumPedido(data.numPedido ?? null); }
      if (fase === "extraer") {
        if (Array.isArray(data.tablas)) setTablas(data.tablas);
        if (data.at) setAt(data.at);
        setEstado("extraido");
      }
      setInfo(data.mensaje ?? "Listo.");
    } catch (e: any) {
      if (e?.name === "AbortError") setError("Tardó demasiado (SUNAT puede estar lento o bloqueado). Reintenta en unos minutos; si ya se generó, usa “Verificar estado”.");
      else setError("Se cortó la conexión con SUNAT. Intenta de nuevo.");
    } finally { clearTimeout(tope); setBusy(null); }
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Deudas tributarias (Fraccionamiento Art. 36)</h2>
          <p className="text-sm text-slate-500">
            Generas el pedido, SUNAT lo procesa (tarda distinto por empresa) y, cuando queda
            “Pendiente de Elaborar Solicitud”, recién se extraen las deudas. Verifica el estado
            hasta que diga <b>Listo</b>.
          </p>
        </div>
        <span className={`badge ${BADGE[estado].cls}`}>{BADGE[estado].txt}{numPedido ? ` · N° ${numPedido}` : ""}</span>
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
            <button className="btn-ghost" onClick={() => llamar("generar")} disabled={busy !== null}>
              {busy === "gen" ? "Generando…" : "1) Generar pedido"}
            </button>
            <button className="btn-ghost" onClick={() => llamar("estado")} disabled={busy !== null}>
              {busy === "ver" ? "Verificando…" : "🔄 Verificar estado"}
            </button>
            <button className="btn-primary" onClick={() => llamar("extraer")} disabled={busy !== null || !(estado === "listo" || estado === "extraido")} title={estado === "listo" || estado === "extraido" ? "" : "Disponible cuando el pedido esté Listo"}>
              {busy === "ext" ? "Extrayendo…" : "2) Extraer deudas"}
            </button>
            {puedeDiag && (
              <label className="flex items-center gap-2 text-xs text-slate-500">
                <input type="checkbox" checked={modoDiag} onChange={(e) => setModoDiag(e.target.checked)} />
                Modo diagnóstico
              </label>
            )}
          </div>
          <p className="mt-2 text-xs text-slate-400">
            Flujo: <b>Generar</b> → <b>Verificar estado</b> (las veces que haga falta, cada empresa
            tarda distinto) → cuando diga <b>Listo</b>, <b>Extraer deudas</b>.
            {at ? ` Última extracción: ${new Date(at).toLocaleString("es-PE")}.` : ""}
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
