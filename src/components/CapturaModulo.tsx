"use client";

import { useState } from "react";

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
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg">
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

          {/* 🐰 Conejo que sube y toca el botón */}
          <span className="conejo" aria-hidden>🐰</span>
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
        .conejo {
          position: absolute;
          left: 14px;
          bottom: 8px;
          font-size: 30px;
          line-height: 1;
          filter: drop-shadow(0 2px 3px rgba(0, 0, 0, 0.25));
          animation: conejo-sube 5.5s ease-in-out infinite;
          pointer-events: none;
        }
        @keyframes conejo-sube {
          0%   { bottom: 8px;  transform: translateY(0) scale(1);      opacity: 0; }
          8%   { opacity: 1; }
          16%  { bottom: 22%;  transform: translateY(0) scale(1); }
          20%  { bottom: 16%; }
          34%  { bottom: 48%; }
          38%  { bottom: 42%; }
          52%  { bottom: 78%; transform: translateY(0) scale(1); }
          58%  { bottom: 84%; transform: translateY(0) scale(0.82) rotate(-6deg); }  /* toca el botón */
          64%  { bottom: 78%; transform: translateY(0) scale(1) rotate(0); }
          88%  { bottom: 78%; opacity: 1; }
          100% { bottom: 78%; opacity: 0; }
        }
        .dot-verde { animation: dot-latido 5.5s ease-in-out infinite; }
        @keyframes dot-latido {
          0%, 56% { transform: scale(1); box-shadow: 0 0 0 0 rgba(52, 211, 153, 0.6); }
          60%     { transform: scale(1.5); box-shadow: 0 0 0 6px rgba(52, 211, 153, 0); }
          66%,100%{ transform: scale(1); box-shadow: 0 0 0 0 rgba(52, 211, 153, 0); }
        }
      `}</style>
    </div>
  );
}
