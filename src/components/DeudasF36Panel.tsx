"use client";

import { useEffect, useState, useCallback } from "react";
import { getSolPass } from "@/lib/solSession";

interface Tabla { pestana: string; headers: string[]; filas: string[][] }
type Estado = "sin-pedido" | "en-proceso" | "listo" | "extraido" | "vencido";

interface Inicial {
  tablas?: Tabla[];
  at?: string;
  nota?: string;
  estado?: Estado;
  numPedido?: string;
  fechaPedido?: string;
  generadoAt?: string;
  verificadoAt?: string;
}

const BADGE: Record<Estado, { txt: string; cls: string }> = {
  "sin-pedido": { txt: "Sin pedido", cls: "bg-slate-100 text-slate-500" },
  "en-proceso": { txt: "⏳ En proceso (SUNAT calculando)", cls: "bg-amber-100 text-amber-700" },
  listo: { txt: "✅ Listo para extraer", cls: "bg-emerald-100 text-emerald-700" },
  extraido: { txt: "📥 Extraído", cls: "bg-sky-100 text-sky-700" },
  vencido: { txt: "⚠ Vencido — genera de nuevo", cls: "bg-red-100 text-red-700" },
};

function fmt(iso?: string | null) {
  if (!iso) return "";
  try { return new Date(iso).toLocaleString("es-PE"); } catch { return iso; }
}

// POST con tope de 4 min: si SUNAT cuelga, no deja la pantalla esperando para siempre.
async function postF36(fase: string, body: any): Promise<{ ok: boolean; data: any }> {
  const ctrl = new AbortController();
  const tope = setTimeout(() => ctrl.abort(), 240000);
  try {
    const res = await fetch(`/api/consultas/deudas/${fase}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body), signal: ctrl.signal,
    });
    return { ok: res.ok, data: await res.json().catch(() => ({})) };
  } finally { clearTimeout(tope); }
}

function msgError(e: any): string {
  return e?.name === "AbortError"
    ? "Tardó demasiado (SUNAT puede estar lento o bloqueado). Reintenta en unos minutos; si ya se generó, usa “Verificar estado”."
    : "Se cortó la conexión con SUNAT.";
}

export default function DeudasF36Panel({
  clienteId,
  solUserGuardado,
  inicial,
}: {
  clienteId: string;
  solUserGuardado: string;
  inicial: Inicial | null | undefined;
}) {
  const [tablas, setTablas] = useState<Tabla[]>(inicial?.tablas ?? []);
  const [at, setAt] = useState<string | null>(inicial?.at ?? null);
  const [nota, setNota] = useState<string | null>(inicial?.nota ?? null);
  const [estado, setEstado] = useState<Estado>(inicial?.estado ?? "sin-pedido");
  const [numPedido, setNumPedido] = useState<string | null>(inicial?.numPedido ?? null);
  const [fechaPedido, setFechaPedido] = useState<string | null>(inicial?.fechaPedido ?? null);
  const [verificadoAt, setVerificadoAt] = useState<string | null>(inicial?.verificadoAt ?? null);
  const [busy, setBusy] = useState<"gen" | "ver" | "ext" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [modoDiag, setModoDiag] = useState(false);
  const [diag, setDiag] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      const [e, x] = await Promise.all([
        fetch(`/api/consultas/deudas/estado?clienteId=${encodeURIComponent(clienteId)}`).then((r) => r.json()).catch(() => ({})),
        fetch(`/api/consultas/deudas/extraer?clienteId=${encodeURIComponent(clienteId)}`).then((r) => r.json()).catch(() => ({})),
      ]);
      if (e?.estado) { setEstado(e.estado); setNumPedido(e.numPedido ?? null); setFechaPedido(e.fechaPedido ?? null); setVerificadoAt(e.verificadoAt ?? null); }
      if (Array.isArray(x?.tablas)) { setTablas(x.tablas); setAt(x.at ?? null); setNota(x.nota ?? null); }
    } catch { /* */ }
  }, [clienteId]);
  useEffect(() => { cargar(); }, [cargar]);

  function accesos() {
    const solUser = solUserGuardado;
    const solPass = getSolPass(clienteId);
    if (!solUser || !solPass) { setError("Carga tus accesos SOL (arriba) para continuar."); return null; }
    return { solUser, solPass };
  }

  async function generar() {
    const a = accesos(); if (!a) return;
    setBusy("gen"); setError(null); setDiag(null); setInfo("Generando el pedido de deuda en SUNAT… (puede tardar 1-3 min)");
    try {
      const { ok, data } = await postF36("generar", { clienteId, ...a, forzar: true, diagnostico: modoDiag });
      if (modoDiag) { setDiag(JSON.stringify(data, null, 2)); setInfo(null); return; }
      if (!ok) { setError(data.error ?? "No se pudo generar."); if (data.diag) setDiag(JSON.stringify(data.diag, null, 2)); return; }
      setEstado("en-proceso");
      if (data.numPedido) setNumPedido(data.numPedido);
      if (data.fechaPedido) setFechaPedido(data.fechaPedido);
      setInfo((data.mensaje ?? "Pedido generado.") + " Usa “Verificar estado” hasta que diga Listo.");
    } catch (e) { setError(msgError(e)); }
    finally { setBusy(null); }
  }

  async function verificar() {
    const a = accesos(); if (!a) return;
    setBusy("ver"); setError(null); setDiag(null); setInfo("Verificando el estado del pedido en SUNAT…");
    try {
      const { ok, data } = await postF36("estado", { clienteId, ...a, diagnostico: modoDiag });
      if (modoDiag) { setDiag(JSON.stringify(data, null, 2)); setInfo(null); return; }
      if (!ok) { setError(data.error ?? "No se pudo verificar."); return; }
      if (data.estado) { setEstado(data.estado); setNumPedido(data.numPedido ?? null); setFechaPedido(data.fechaPedido ?? null); setVerificadoAt(new Date().toISOString()); }
      setInfo(data.mensaje ?? "Estado actualizado.");
    } catch (e) { setError(msgError(e)); }
    finally { setBusy(null); }
  }

  async function extraer() {
    const a = accesos(); if (!a) return;
    setBusy("ext"); setError(null); setDiag(null); setInfo("Extrayendo las deudas (las pestañas)…");
    try {
      const { ok, data } = await postF36("extraer", { clienteId, ...a, forzar: true, diagnostico: modoDiag });
      if (modoDiag) { setDiag(JSON.stringify(data, null, 2)); setInfo(null); return; }
      if (!ok) { setError(data.error ?? "No se pudo extraer."); if (data.diag) setDiag(JSON.stringify(data.diag, null, 2)); return; }
      if (Array.isArray(data.tablas)) { setTablas(data.tablas); setNota(data.nota ?? null); if (data.at) setAt(data.at); setEstado("extraido"); }
      setInfo(data.mensaje ?? "Listo.");
    } catch (e) { setError(msgError(e)); }
    finally { setBusy(null); }
  }

  const totalRegistros = tablas.reduce((a, t) => a + t.filas.length, 0);
  const puedeExtraer = estado === "listo" || estado === "extraido";
  const b = BADGE[estado];

  return (
    <section className="card p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-slate-800">Deudas tributarias (Fraccionamiento Art. 36)</h2>
        <span className={`badge ${b.cls}`}>{b.txt}</span>
      </div>
      <p className="mb-3 text-xs text-slate-500">
        Es un proceso en 2 fases: <b>generas</b> el pedido, SUNAT lo procesa (tarda distinto por empresa),
        y cuando queda <b>“Pendiente de Elaborar Solicitud”</b> recién se pueden <b>extraer</b> las deudas.
        Usa <b>“Verificar estado”</b> hasta que diga <b>Listo</b>.
      </p>

      {info && <div className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">{info}</div>}
      {error && <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
      {nota && <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">⚠ <b>SUNAT:</b> {nota}</div>}

      {(numPedido || fechaPedido || verificadoAt) && (
        <p className="mb-3 text-xs text-slate-400">
          {numPedido ? <>Pedido N° <b className="text-slate-600">{numPedido}</b> </> : null}
          {fechaPedido ? <>· {fechaPedido} </> : null}
          {verificadoAt ? <>· verificado {fmt(verificadoAt)} </> : null}
          {at ? <>· extraído {fmt(at)}</> : null}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-ghost" onClick={generar} disabled={busy !== null}>
          {busy === "gen" ? "Generando…" : "1) Generar pedido"}
        </button>
        <button className="btn-ghost" onClick={verificar} disabled={busy !== null}>
          {busy === "ver" ? "Verificando…" : "🔄 Verificar estado"}
        </button>
        <button className="btn-primary" onClick={extraer} disabled={busy !== null || !puedeExtraer} title={puedeExtraer ? "" : "Disponible cuando el pedido esté Listo"}>
          {busy === "ext" ? "Extrayendo…" : "2) Extraer deudas"}
        </button>
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
      ) : estado === "extraido" && at ? (
        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-700">
          ✅ Esta empresa <b>no cuenta con deudas pendientes</b> de acoger al fraccionamiento.
        </div>
      ) : null}
    </section>
  );
}
