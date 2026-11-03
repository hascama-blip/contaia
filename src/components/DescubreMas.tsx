"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export interface ModuloResumen {
  titulo: string;
  detalle: string;
  icono: string;
  /** Qué contiene el módulo (viñetas). */
  contenido: string[];
  /** Solo para los bloqueados. */
  badge?: string;
  boton?: string;
  /** Plan mínimo legible ("Regular", "Premium"…). */
  planMin?: string;
}

// Botón "Descubre qué más puedes hacer" → VENTANA FLOTANTE con el contenido de
// cada módulo. Versión según el plan: si faltan módulos, muestra los que puede
// sumar (con su plan y botón a planes) y, debajo, los que ya tiene; si ya tiene
// todo, lo celebra y lista lo que incluye cada uno.
export default function DescubreMas({ bloqueados, activos, planNombre }: { bloqueados: ModuloResumen[]; activos: ModuloResumen[]; planNombre: string }) {
  const [abierto, setAbierto] = useState(false);
  useEffect(() => {
    if (!abierto) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setAbierto(false); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [abierto]);

  const completo = bloqueados.length === 0;

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="sheen flex w-full items-center justify-between gap-3 rounded-2xl bg-gradient-to-r from-brand-700 to-brand-500 px-4 py-3 text-left text-white shadow-md"
      >
        <span>
          <span className="block text-sm font-bold">✨ Descubre qué más puedes hacer</span>
          <span className="block text-[11px] text-brand-100">
            {completo ? "Tu plan incluye todos los módulos" : `${bloqueados.length} módulo(s) disponibles en planes superiores`}
          </span>
        </span>
        <span className="text-lg" aria-hidden>↗</span>
      </button>

      {abierto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Descubre qué más puedes hacer">
          <div className="absolute inset-0 bg-brand-900/60 backdrop-blur-sm" onClick={() => setAbierto(false)} />
          <div className="relative flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
            {/* Cabecera */}
            <div className="flex items-start justify-between gap-4 bg-gradient-to-r from-brand-800 to-brand-600 px-6 py-5 text-white">
              <div>
                <h2 className="text-xl font-bold">✨ Descubre qué más puedes hacer</h2>
                <p className="mt-1 text-sm text-brand-100">
                  {completo
                    ? `Tu plan ${planNombre} incluye todos los módulos. Esto es lo que contiene cada uno.`
                    : `Tu plan ${planNombre} incluye ${activos.length} módulo(s). Puedes sumar ${bloqueados.length} más.`}
                </p>
              </div>
              <button onClick={() => setAbierto(false)} className="rounded-lg p-1.5 text-white/80 hover:bg-white/10 hover:text-white" aria-label="Cerrar">
                <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" /></svg>
              </button>
            </div>

            {/* Cuerpo (se desplaza dentro de la ventana, sin barra visible) */}
            <div className="sin-barra min-h-0 flex-1 overflow-y-auto px-6 py-5">
              {completo && (
                <div className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
                  🎉 Ya tienes todos los módulos, pronto habrán más novedades.
                </div>
              )}

              {bloqueados.length > 0 && (
                <section>
                  <h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-accent-700">Disponibles en planes superiores</h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {bloqueados.map((m) => <Tarjeta key={m.titulo} m={m} bloqueado />)}
                  </div>
                  <div className="mt-4 flex justify-end">
                    <Link href="/planes" onClick={() => setAbierto(false)} className="btn-accent">Ver planes y precios →</Link>
                  </div>
                </section>
              )}

              {activos.length > 0 && (
                <section className={bloqueados.length ? "mt-6" : ""}>
                  <h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500">{completo ? "Tus módulos" : "Ya incluidos en tu plan"}</h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {activos.map((m) => <Tarjeta key={m.titulo} m={m} />)}
                  </div>
                </section>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Tarjeta({ m, bloqueado }: { m: ModuloResumen; bloqueado?: boolean }) {
  return (
    <div className={`rounded-2xl border p-4 ${bloqueado ? "border-accent-200 bg-accent-50/40" : "border-slate-200 bg-white"}`}>
      <div className="flex items-start gap-3">
        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl text-lg ring-1 ${bloqueado ? "bg-accent-100 ring-accent-200" : "bg-brand-50 ring-brand-100"}`}>{m.icono}</span>
        <div className="min-w-0">
          <h4 className="text-sm font-bold leading-snug text-slate-800">{m.titulo}</h4>
          {bloqueado ? (
            <span className="mt-1 inline-block rounded-md bg-accent-100 px-1.5 py-0.5 text-[10px] font-semibold text-accent-800">🔒 {m.badge}{m.planMin ? ` · desde ${m.planMin}` : ""}</span>
          ) : (
            <span className="mt-1 inline-block rounded-md bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">✓ Incluido</span>
          )}
        </div>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-slate-500">{m.detalle}</p>
      <ul className="mt-2 space-y-1">
        {m.contenido.map((c, i) => (
          <li key={i} className="flex gap-1.5 text-xs text-slate-600"><span className={bloqueado ? "text-accent-600" : "text-emerald-500"}>•</span><span>{c}</span></li>
        ))}
      </ul>
    </div>
  );
}
