"use client";

import { useState } from "react";
import AccesosSol from "./AccesosSol";
import ComprobantesXmlPanel from "./ComprobantesXmlPanel";

interface ClienteMin { id: string; razonSocial: string; ruc: string; solUser: string }

// Herramienta suelta (menú de inicio): elige una empresa, pon la Clave SOL y
// descarga los XML de sus comprobantes recibidos. Reusa los mismos componentes
// que hay dentro de la ficha del cliente.
export default function ComprobantesXmlTool({ clientes }: { clientes: ClienteMin[] }) {
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
              <option key={c.id} value={c.id}>
                {c.razonSocial} · RUC {c.ruc}
              </option>
            ))}
          </select>
        )}
      </div>

      {sel && (
        <>
          <AccesosSol clienteId={sel.id} solUserGuardado={sel.solUser} />
          <ComprobantesXmlPanel clienteId={sel.id} />
        </>
      )}
    </div>
  );
}
