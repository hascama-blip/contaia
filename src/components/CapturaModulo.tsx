"use client";

import { useState, useEffect } from "react";

// Marco tipo ventana con mockup + captura real (si existe). Un conejo sube por
// la ventana y "toca" el círculo verde; al hacer clic se abre una ventana grande
// (lightbox) con la vista ampliada — cómo se vería ya generado.
export default function CapturaModulo({
  src,
  icono,
  titulo,
}: {
  src: string;
  icono: string;
  titulo: string;
}) {
  const [open, setOpen] = useState(false);

  // Al abrir: bloquea el scroll del fondo y cierra con Escape.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", onKey); };
  }, [open]);

  const Mockup = (
    <div className="absolute inset-0 bg-gradient-to-br from-brand-50 to-slate-100 p-4">
      <div className="flex h-full gap-3">
        <div className="hidden w-1/5 flex-col gap-2 sm:flex">
          <div className="h-3 rounded bg-white/70" />
          <div className="h-3 w-4/5 rounded bg-white/60" />
          <div className="h-3 w-3/5 rounded bg-white/50" />
          <div className="mt-auto h-10 rounded-lg bg-brand-200/60" />
        </div>
        <div className="flex flex-1 flex-col gap-3">
          <div className="flex items-center gap-2">
            <span className="text-2xl opacity-40">{icono}</span>
            <div className="h-4 w-1/3 rounded bg-slate-300/60" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="h-14 rounded-lg bg-white/70" />
            <div className="h-14 rounded-lg bg-white/70" />
            <div className="h-14 rounded-lg bg-white/70" />
          </div>
          <div className="flex-1 rounded-lg bg-white/60 p-3">
            <div className="mb-2 h-2.5 w-2/3 rounded bg-slate-300/50" />
            <div className="mb-2 h-2.5 w-1/2 rounded bg-slate-300/40" />
            <div className="h-2.5 w-3/4 rounded bg-slate-300/40" />
          </div>
          <div className="h-8 w-32 rounded-lg bg-brand-300/60" />
        </div>
      </div>
    </div>
  );

  return (
    <div className="relative">
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg transition-all duration-300 ease-out hover:-translate-y-1 hover:scale-[1.03] hover:shadow-2xl">
        {/* Barra de la ventana. El punto verde amplía. */}
        <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2.5">
          <span className="h-3.5 w-3.5 rounded-full bg-red-300" />
          <span className="h-3.5 w-3.5 rounded-full bg-amber-300" />
          <button
            onClick={() => setOpen(true)}
            title="Ampliar"
            className="dot-verde h-3.5 w-3.5 rounded-full bg-emerald-400 ring-2 ring-emerald-200 transition hover:scale-125"
          />
          <span className="ml-2 truncate text-xs text-slate-400">radartributaria — {titulo}</span>
        </div>

        {/* Contenido (grande). */}
        <button onClick={() => setOpen(true)} className="group relative block aspect-[16/10] w-full cursor-zoom-in text-left">
          {Mockup}
          <div className="absolute inset-0 bg-cover bg-top" style={{ backgroundImage: `url(${src})` }} />

          {/* Botón ampliar */}
          <span className="absolute bottom-3 right-3 flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-brand-700 shadow ring-1 ring-slate-200 transition group-hover:scale-110">⤢</span>
        </button>
      </div>

      {/* Lightbox: ventana grande con la vista ampliada. */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-5xl overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-2.5">
              <span className="text-sm font-medium text-slate-600">{icono} {titulo}</span>
              <button onClick={() => setOpen(false)} className="rounded-md px-2 py-1 text-sm text-slate-500 hover:bg-slate-100">✕ Cerrar</button>
            </div>
            <div className="relative aspect-[16/10] w-full">
              {Mockup}
              <div className="absolute inset-0 bg-contain bg-top bg-no-repeat" style={{ backgroundImage: `url(${src})` }} />
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        .dot-verde { animation: dot-latido 2.6s ease-in-out infinite; }
        @keyframes dot-latido {
          0%, 70%  { transform: scale(1); box-shadow: 0 0 0 0 rgba(52, 211, 153, 0.6); }
          85%      { transform: scale(1.4); box-shadow: 0 0 0 6px rgba(52, 211, 153, 0); }
          100%     { transform: scale(1); box-shadow: 0 0 0 0 rgba(52, 211, 153, 0); }
        }
      `}</style>
    </div>
  );
}
