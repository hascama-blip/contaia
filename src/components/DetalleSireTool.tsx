"use client";

import { useState } from "react";
import AccesosSol from "./AccesosSol";
import DetalleSirePanel from "./DetalleSirePanel";

interface ClienteMin { id: string; razonSocial: string; ruc: string; solUser: string }

// Herramienta suelta (menú de inicio): elige la empresa, pon la Clave SOL y
// extrae el detalle SIRE (propuesta) de la API oficial de SUNAT.
export default function DetalleSireTool({ clientes }: { clientes: ClienteMin[] }) {
  const [id, setId] = useState("");
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
          <DetalleSirePanel clienteId={sel.id} />
        </>
      )}
    </div>
  );
}
