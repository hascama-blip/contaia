"use client";

import { useState } from "react";
import AccesosSol from "./AccesosSol";
import DetalleSirePanel from "./DetalleSirePanel";

interface ClienteMin { id: string; razonSocial: string; ruc: string; solUser: string }

// Herramienta única de Detalle SIRE: elige la empresa una vez y alterna entre
// Compras (RCE) y Ventas (RVIE). Cada libro se EXTRAE por separado (su propio
// botón); ambos paneles quedan montados para no perder lo ya extraído al cambiar.
export default function DetalleSireTool({ clientes }: { clientes: ClienteMin[] }) {
  const [id, setId] = useState("");
  const [tab, setTab] = useState<"compras" | "ventas">("compras");
  const sel = clientes.find((c) => c.id === id) ?? null;

  return (
    <div className="space-y-4">
      <div className="card p-5">
        <label className="label">Empresa</label>
        {clientes.length === 0 ? (
          <p className="text-sm text-slate-500">
            No tienes empresas registradas.{" "}
            <a href="/clientes/nuevo" className="text-brand-600 hover:underline">Crea una primero →</a>
          </p>
        ) : (
          <select className="input max-w-lg" value={id} onChange={(e) => setId(e.target.value)}>
            <option value="">— Elige una empresa —</option>
            {clientes.map((c) => (
              <option key={c.id} value={c.id}>{c.razonSocial} · RUC {c.ruc}</option>
            ))}
          </select>
        )}
      </div>

      {sel && (
        <>
          <AccesosSol clienteId={sel.id} solUserGuardado={sel.solUser} />

          {/* Selector de libro (la extracción de cada uno es independiente). */}
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1">
            {(["compras", "ventas"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`rounded-md px-4 py-1.5 text-sm font-semibold transition ${
                  tab === t ? "bg-brand-600 text-white" : "text-slate-500 hover:text-brand-700"
                }`}
              >
                {t === "compras" ? "Compras (RCE)" : "Ventas (RVIE)"}
              </button>
            ))}
          </div>

          {/* Ambos paneles montados; se oculta el inactivo para conservar estado. */}
          <div className={tab === "compras" ? "" : "hidden"}>
            <DetalleSirePanel clienteId={sel.id} tipo="compras" />
          </div>
          <div className={tab === "ventas" ? "" : "hidden"}>
            <DetalleSirePanel clienteId={sel.id} tipo="ventas" />
          </div>
        </>
      )}
    </div>
  );
}
