"use client";

import { useState } from "react";

interface ClienteOpt {
  id: string;
  razonSocial: string;
  ruc: string;
  solUser: string;
}
interface Mensaje {
  id: string;
  fecha: string;
  asunto: string;
  tipo: string;
  nivel: "peligroso" | "urgente" | "otro";
}

export default function ConsultasFlow({ clientes }: { clientes: ClienteOpt[] }) {
  const [clienteId, setClienteId] = useState(clientes[0]?.id ?? "");
  const [solUser, setSolUser] = useState(clientes[0]?.solUser ?? "");
  const [solPass, setSolPass] = useState("");
  const [mensajes, setMensajes] = useState<Mensaje[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [bajando, setBajando] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const cliente = clientes.find((c) => c.id === clienteId);

  function elegir(id: string) {
    setClienteId(id);
    setSolUser(clientes.find((c) => c.id === id)?.solUser ?? "");
    setMensajes(null);
  }

  async function extraer() {
    if (!clienteId) return setError("Elige una empresa.");
    if (!solPass) return setError("Ingresa la Clave SOL.");
    setBusy(true); setError(null); setInfo("Conectando al portal SOL y leyendo el buzón…");
    try {
      const res = await fetch("/api/consultas/buzon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clienteId, solUser, solPass, dias: 30 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? "No se pudo leer el buzón."); return; }
      setMensajes(data.mensajes ?? []);
      setInfo(`Se encontraron ${data.mensajes?.length ?? 0} mensaje(s).`);
    } catch {
      setError("Se cortó la conexión con SUNAT. Intenta de nuevo.");
    } finally { setBusy(false); }
  }

  async function descargarPdf(m: Mensaje) {
    setBajando(m.id); setError(null);
    try {
      const res = await fetch("/api/consultas/buzon/adjunto", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clienteId, solUser, solPass, codMensaje: m.id }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "No se pudo descargar el PDF de ese mensaje.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(m.asunto || "adjunto").slice(0, 40).replace(/[^\w\s-]/g, "")}.pdf`;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } finally { setBajando(null); }
  }

  return (
    <div className="space-y-5">
      {info && <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">{info}</div>}
      {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}

      {clientes.length === 0 ? (
        <div className="card p-6 text-sm text-slate-500">
          Aún no tienes empresas. Crea una en “+ Nuevo cliente” para usar las consultas.
        </div>
      ) : (
        <section className="card p-5">
          <h2 className="mb-3 font-bold text-slate-800">Extraer mensajes del buzón</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="text-xs font-semibold text-slate-600">Empresa</label>
              <select
                className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm outline-none focus:border-brand-500"
                value={clienteId}
                onChange={(e) => elegir(e.target.value)}
              >
                {clientes.map((c) => (
                  <option key={c.id} value={c.id}>{c.razonSocial} ({c.ruc})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600">Usuario SOL</label>
              <input
                className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm outline-none focus:border-brand-500"
                value={solUser}
                onChange={(e) => setSolUser(e.target.value)}
                placeholder="Usuario SOL"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600">Clave SOL</label>
              <input
                type="password"
                className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm outline-none focus:border-brand-500"
                value={solPass}
                onChange={(e) => setSolPass(e.target.value)}
                placeholder="No se guarda"
              />
            </div>
          </div>
          <button className="btn-primary mt-3" onClick={extraer} disabled={busy}>
            {busy ? "Extrayendo…" : "📨 Extraer buzón"}
          </button>
          {cliente && (
            <p className="mt-2 text-xs text-slate-400">
              La Clave SOL se usa solo para esta consulta y no se guarda.
            </p>
          )}
        </section>
      )}

      {mensajes && (
        <section className="card overflow-hidden p-0">
          <div className="border-b border-slate-100 px-4 py-3">
            <h2 className="font-bold text-slate-800">Mensajes del buzón</h2>
            <p className="text-xs text-slate-400">
              {mensajes.length} mensaje(s) · clic en el ícono PDF para descargar el adjunto.
            </p>
          </div>
          {mensajes.length === 0 ? (
            <p className="px-4 py-6 text-sm text-slate-400">Sin mensajes en el periodo.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-400">
                <tr>
                  <th className="px-4 py-2">Fecha</th>
                  <th className="px-4 py-2">Categoría</th>
                  <th className="px-4 py-2">Asunto</th>
                  <th className="px-4 py-2 text-center">PDF</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {mensajes.map((m) => (
                  <tr key={m.id}>
                    <td className="whitespace-nowrap px-4 py-2 text-slate-500">{m.fecha}</td>
                    <td className="px-4 py-2">
                      {m.nivel === "otro" ? (
                        <span className="text-xs text-slate-400">Informativa</span>
                      ) : (
                        <span className={`badge ${m.nivel === "peligroso" ? "bg-red-100 text-red-700" : "bg-orange-100 text-orange-700"}`}>
                          {m.tipo || "—"}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-slate-700">{m.asunto}</td>
                    <td className="px-4 py-2 text-center">
                      <button
                        onClick={() => descargarPdf(m)}
                        disabled={bajando !== null}
                        title="Descargar PDF adjunto"
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
                      >
                        {bajando === m.id ? "…" : "📄 PDF"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </div>
  );
}
