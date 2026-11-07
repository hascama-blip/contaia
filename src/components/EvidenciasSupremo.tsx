"use client";

import { useEffect, useState } from "react";

// Panel del supremo: descarga el registro de accesos (filtrable por RUC o
// correo) y las constancias de aceptación de las políticas, en CSV.
export default function EvidenciasSupremo() {
  const [meses, setMeses] = useState<string[]>([]);
  const [mes, setMes] = useState(new Date().toISOString().slice(0, 7));
  const [ruc, setRuc] = useState("");
  const [email, setEmail] = useState("");

  useEffect(() => {
    fetch("/api/supremo/accesos?tipo=meses").then((r) => r.json()).then((d) => {
      if (Array.isArray(d.meses) && d.meses.length) { setMeses(d.meses); setMes(d.meses[0]); }
    }).catch(() => {});
  }, []);

  const qs = new URLSearchParams({ tipo: "accesos", mes, ...(ruc.trim() ? { ruc: ruc.trim() } : {}), ...(email.trim() ? { email: email.trim() } : {}) });
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-slate-800">Registro de accesos y aceptaciones</h3>
      <p className="mt-1 text-xs text-slate-500">
        Evidencia para atender un reclamo o requerimiento: quién entró, cuándo, desde qué IP y qué empresa (RUC) consultó o
        descargó. Cada línea está firmada; la columna “Firma válida” indica si fue alterada. Se conserva 5 años y va incluida
        en el backup completo.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select className="input w-auto" value={mes} onChange={(e) => setMes(e.target.value)}>
          {(meses.length ? meses : [mes]).map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <input className="input w-40" placeholder="RUC (opcional)" inputMode="numeric" value={ruc} onChange={(e) => setRuc(e.target.value.replace(/\D/g, "").slice(0, 11))} />
        <input className="input w-56" placeholder="Correo (opcional)" value={email} onChange={(e) => setEmail(e.target.value)} />
        <a href={`/api/supremo/accesos?${qs}`} className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700">Descargar accesos (CSV)</a>
        <a href="/api/supremo/accesos?tipo=aceptaciones" className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">Constancias de aceptación (CSV)</a>
      </div>
    </div>
  );
}
