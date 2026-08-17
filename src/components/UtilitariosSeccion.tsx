"use client";

import { useState } from "react";

// Sección "Utilitarios" retráctil. Las tarjetas se calculan en el server
// (bloqueo por módulo) y llegan como children; aquí solo se muestran/ocultan.
export default function UtilitariosSeccion({ children }: { children: React.ReactNode }) {
  const [abierto, setAbierto] = useState(true);

  return (
    <div className="pt-2">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        className="mb-3 flex w-full items-center gap-3 text-left"
        aria-expanded={abierto}
      >
        <h2 className="flex items-center gap-1.5 text-sm font-bold uppercase tracking-wide text-slate-500">
          <span className={`inline-block transition-transform ${abierto ? "rotate-90" : ""}`}>▸</span>
          🧰 Utilitarios
        </h2>
        <div className="h-px flex-1 bg-slate-200" />
        <span className="text-xs font-semibold text-brand-600">{abierto ? "Ocultar" : "Mostrar"}</span>
      </button>
      {abierto && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
      )}
    </div>
  );
}
