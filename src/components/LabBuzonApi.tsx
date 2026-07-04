"use client";

import { useState } from "react";

// Prueba AISLADA del buzón por API oficial (HTTP, sin navegador). No toca nada
// de producción. Saca el token y prueba un endpoint con ese Bearer.
export default function LabBuzonApi() {
  const [f, setF] = useState({
    ruc: "",
    solUser: "",
    solPass: "",
    clientId: "",
    clientSecret: "",
    scope: "https://api-sire.sunat.gob.pe",
    endpoint: "https://ww1.sunat.gob.pe/ol-ti-itvisornoti/visor/listNotiMenPag?tipoMsj=2&codCarpeta=00&codEtiqueta=&page=1&des_asunto=&codMensaje=&tipoOrden=NADA",
    metodo: "GET",
    cuerpo: "",
  });
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<any>(null);

  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));

  async function probar() {
    setBusy(true);
    setRes(null);
    try {
      const r = await fetch("/api/diagnostico/buzon-api", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(f),
      });
      setRes(await r.json().catch(() => ({ error: "Respuesta inválida" })));
    } catch {
      setRes({ error: "Error de red." });
    } finally {
      setBusy(false);
    }
  }

  const inp = "w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-brand-500";

  return (
    <section className="card space-y-4 p-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">RUC</label>
          <input className={inp} value={f.ruc} onChange={(e) => set("ruc", e.target.value)} />
        </div>
        <div>
          <label className="label">Usuario SOL</label>
          <input className={inp} value={f.solUser} onChange={(e) => set("solUser", e.target.value)} />
        </div>
        <div>
          <label className="label">Clave SOL</label>
          <input type="password" className={inp} value={f.solPass} onChange={(e) => set("solPass", e.target.value)} />
        </div>
        <div>
          <label className="label">client_id</label>
          <input className={inp} value={f.clientId} onChange={(e) => set("clientId", e.target.value)} />
        </div>
        <div>
          <label className="label">client_secret</label>
          <input className={inp} value={f.clientSecret} onChange={(e) => set("clientSecret", e.target.value)} />
        </div>
        <div>
          <label className="label">scope (permiso a pedir)</label>
          <input className={inp} value={f.scope} onChange={(e) => set("scope", e.target.value)} />
        </div>
      </div>

      <div>
        <label className="label">Endpoint a probar con el token (opcional)</label>
        <input className={inp} value={f.endpoint} onChange={(e) => set("endpoint", e.target.value)} />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" value={f.metodo} onChange={(e) => set("metodo", e.target.value)}>
            <option>GET</option>
            <option>POST</option>
          </select>
          {f.metodo === "POST" && (
            <input
              className={inp + " flex-1"}
              placeholder="cuerpo (form o JSON)"
              value={f.cuerpo}
              onChange={(e) => set("cuerpo", e.target.value)}
            />
          )}
        </div>
      </div>

      <button
        onClick={probar}
        disabled={busy}
        className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
      >
        {busy ? "Probando…" : "🧪 Probar API"}
      </button>

      {res && (
        <div className="space-y-2">
          {res.error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{res.error}</div>}
          {res.conclusion && (
            <div className="rounded-lg bg-brand-50 px-3 py-2 text-sm font-medium text-brand-800">{res.conclusion}</div>
          )}
          {Array.isArray(res.pasos) &&
            res.pasos.map((p: any, i: number) => (
              <pre key={i} className="overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">
                {JSON.stringify(p, null, 2)}
              </pre>
            ))}
        </div>
      )}
    </section>
  );
}
