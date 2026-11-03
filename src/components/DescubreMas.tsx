"use client";

import Link from "next/link";
import { useState } from "react";

export interface ModuloBloqueado {
  titulo: string;
  detalle: string;
  icono: string;
  badge: string;   // "Bloqueado" | "Bloqueado (de pago)"
  boton: string;   // "Desbloquear acceso" | "Ver planes" | "Saber más"
  href: string;
}

// Botón "Descubre qué más puedes hacer": despliega los módulos que el plan
// actual NO incluye. Si ya tiene todos, lo dice y anuncia novedades.
export default function DescubreMas({ bloqueados }: { bloqueados: ModuloBloqueado[] }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
      <button
        type="button"
        onClick={() => setAbierto((o) => !o)}
        aria-expanded={abierto}
        className="sheen flex w-full items-center justify-between gap-3 rounded-2xl bg-gradient-to-r from-brand-700 to-brand-500 px-4 py-3 text-left text-white shadow-md"
      >
        <span>
          <span className="block text-sm font-bold">✨ Descubre qué más puedes hacer</span>
          <span className="block text-[11px] text-brand-100">
            {bloqueados.length ? `${bloqueados.length} módulo(s) disponibles en planes superiores` : "Tu plan incluye todos los módulos"}
          </span>
        </span>
        <span className={`text-lg transition-transform duration-500 ${abierto ? "rotate-180" : ""}`} aria-hidden>⌄</span>
      </button>

      {abierto && (
        <div className="mt-3 space-y-3">
          {bloqueados.length === 0 ? (
            <p className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              🎉 Ya tienes todos los módulos, pronto habrán más novedades.
            </p>
          ) : bloqueados.map((o) => (
            <div key={o.href} className="sheen rounded-2xl border border-slate-200 bg-slate-50 p-4 hover:border-accent-300 hover:shadow-md">
              <div className="flex items-start gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent-100 text-base ring-1 ring-accent-200">{o.icono}</span>
                <div className="min-w-0">
                  <h3 className="text-sm font-bold leading-snug text-slate-800">
                    {o.titulo}{" "}
                    <span className="ml-1 inline-block rounded-md bg-accent-100 px-1.5 py-0.5 align-middle text-[10px] font-semibold text-accent-800">🔒 {o.badge}</span>
                  </h3>
                  <p className="mt-1 text-xs leading-relaxed text-slate-500">{o.detalle}</p>
                </div>
              </div>
              <Link href={o.href} className="relative z-10 mt-3 block rounded-xl border border-slate-300 bg-white py-2 text-center text-sm font-semibold text-slate-700 transition-colors duration-500 hover:border-accent-400 hover:bg-accent-50 hover:text-accent-800">
                {o.boton}
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
