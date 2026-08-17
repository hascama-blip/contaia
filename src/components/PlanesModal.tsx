"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PLANES } from "@/lib/planes";

// Ventana de planes que aparece al INGRESAR (el login setea localStorage
// "mostrar_planes"). Se muestra una vez por ingreso; el usuario elige o cierra.
export default function PlanesModal() {
  const [abierto, setAbierto] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem("mostrar_planes") === "1") {
        localStorage.removeItem("mostrar_planes");
        setAbierto(true);
      }
    } catch { /* */ }
  }, []);

  if (!abierto) return null;

  const cerrar = () => setAbierto(false);

  return (
    <div className="no-print fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/60 p-4 backdrop-blur-sm">
      <div className="my-6 w-full max-w-5xl rounded-2xl bg-white p-5 shadow-xl sm:p-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-slate-800">Elige tu plan</h2>
            <p className="text-sm text-slate-500">Empieza gratis y amplía cuando quieras. Puedes cambiar de plan en cualquier momento.</p>
          </div>
          <button onClick={cerrar} className="shrink-0 rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-100" aria-label="Cerrar">✕</button>
        </div>

        <div className="grid items-stretch gap-3 md:grid-cols-2 xl:grid-cols-4">
          {PLANES.map((p) => (
            <div
              key={p.nombre}
              className={`relative flex flex-col rounded-xl border bg-white p-4 ${
                p.destacado ? "border-accent-300 ring-2 ring-accent-200" : "border-slate-200"
              }`}
            >
              {p.destacado && (
                <span className="absolute -top-2.5 left-4 rounded-full bg-accent-400 px-2 py-0.5 text-[10px] font-bold text-brand-900 shadow">
                  Más popular
                </span>
              )}
              <h3 className="text-base font-bold text-slate-800">{p.nombre}</h3>
              <div className="mt-0.5 flex items-end gap-1.5">
                <span className="text-xl font-extrabold text-slate-900">{p.precio}</span>
                {p.periodo && <span className="pb-0.5 text-[11px] text-slate-400">{p.periodo}</span>}
                {p.precioAntes && <span className="pb-0.5 text-xs text-slate-400 line-through">{p.precioAntes}</span>}
              </div>
              {p.etiqueta && (
                <span className="mt-1 inline-flex w-fit rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                  {p.etiqueta}
                </span>
              )}

              <ul className="mt-3 flex-1 space-y-1">
                {p.incluidos.map((g, gi) => (
                  <li key={gi} className="flex gap-1.5 text-[11px] text-slate-600">
                    <span className="mt-0.5 text-emerald-500">✓</span>
                    <span>{g.titulo}</span>
                  </li>
                ))}
                {p.proximamente && (
                  <li className="flex gap-1.5 text-[11px] text-slate-400">
                    <span className="mt-0.5">🔜</span>
                    <span>{p.proximamente.titulo}: Comprobantes XML</span>
                  </li>
                )}
              </ul>

              {p.gratis ? (
                <button
                  onClick={cerrar}
                  className="btn-ghost mt-3 w-full text-center text-xs"
                >
                  {p.cta}
                </button>
              ) : (
                <Link
                  href="/planes"
                  onClick={cerrar}
                  className={`mt-3 w-full text-center text-xs ${p.ctaEstilo === "accent" ? "btn-accent" : "btn-primary"}`}
                >
                  {p.cta}
                </Link>
              )}
            </div>
          ))}
        </div>

        <div className="mt-4 flex items-center justify-between">
          <Link href="/planes" onClick={cerrar} className="text-sm text-brand-600 hover:underline">
            Ver comparación completa →
          </Link>
          <button onClick={cerrar} className="text-sm text-slate-400 hover:text-slate-600">
            Seguir con el plan gratis
          </button>
        </div>
      </div>
    </div>
  );
}
