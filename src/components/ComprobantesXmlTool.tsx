"use client";

import { useState } from "react";
import AccesosSol from "./AccesosSol";
import ComprobantesXmlPanel from "./ComprobantesXmlPanel";
import HonorariosPanel from "./HonorariosPanel";
import { TopeComprobantes } from "./CuposEmpresa";

interface ClienteMin { id: string; razonSocial: string; ruc: string; solUser: string }

type Pestana = "facturas" | "honorarios";

// Descarga masiva de comprobantes (menú de inicio): elige una empresa, pon la
// Clave SOL UNA vez y descarga en bloque sus FACTURAS (XML / PDF oficial) o sus
// RECIBOS POR HONORARIOS. Cada pestaña reusa el panel que ya existía (el de la
// ficha del cliente y el de honorarios); aquí solo se comparten empresa y acceso.
export default function ComprobantesXmlTool({ clientes }: { clientes: ClienteMin[] }) {
  const [id, setId] = useState("");
  const [pestana, setPestana] = useState<Pestana>("facturas");
  const sel = clientes.find((c) => c.id === id) ?? null;

  const tabs: { key: Pestana; label: string; hint: string }[] = [
    { key: "facturas", label: "🧾 Facturas (XML / PDF)", hint: "Comprobantes recibidos desde una relación o el SIRE" },
    { key: "honorarios", label: "📝 Honorarios (RxH)", hint: "Recibos por honorarios recibidos por mes completo" },
  ];

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

      <TopeComprobantes />

      {sel && (
        <>
          <AccesosSol key={sel.id} clienteId={sel.id} solUserGuardado={sel.solUser} />

          {/* Pestañas: facturas | honorarios */}
          <div className="flex flex-wrap gap-2 border-b border-slate-200">
            {tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setPestana(t.key)}
                title={t.hint}
                className={`-mb-px rounded-t-lg border px-4 py-2 text-sm font-semibold transition ${
                  pestana === t.key
                    ? "border-slate-200 border-b-white bg-white text-brand-700"
                    : "border-transparent text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {pestana === "facturas" ? (
            <ComprobantesXmlPanel clienteId={sel.id} />
          ) : (
            <HonorariosPanel clientes={clientes} clienteFijo={sel} />
          )}
        </>
      )}
    </div>
  );
}
