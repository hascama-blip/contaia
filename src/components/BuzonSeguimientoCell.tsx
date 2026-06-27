"use client";

import { useEffect, useState } from "react";

export interface Seguimiento {
  codMensaje: string;
  diasAtencion: number;
  comentario: string;
  fechaLimite: string;
  atendido?: boolean;
  creadoPorNombre?: string;
}

export function fmtDia(iso: string): string {
  try { return new Date(iso).toLocaleDateString("es-PE", { day: "2-digit", month: "2-digit", year: "numeric" }); }
  catch { return iso; }
}

// Control por mensaje: plazo de atención (5/10/15 días) + comentario + guardar.
// Compartido por Consultas tributarias y el detalle del cliente.
export default function BuzonSeguimientoCell({
  codMensaje,
  inicial,
  guardando,
  onGuardar,
  soloComentario = false,
}: {
  codMensaje: string;
  inicial?: Seguimiento;
  guardando: boolean;
  onGuardar: (dias: number, comentario: string) => void;
  /** Reporte analítico: solo comentario (sin programar días de atención). */
  soloComentario?: boolean;
}) {
  const [dias, setDias] = useState<number>(inicial?.diasAtencion ?? 5);
  const [comentario, setComentario] = useState<string>(inicial?.comentario ?? "");
  useEffect(() => {
    if (inicial) { setDias(inicial.diasAtencion); setComentario(inicial.comentario); }
  }, [codMensaje]); // eslint-disable-line react-hooks/exhaustive-deps

  const vencido = inicial && inicial.diasAtencion > 0 && new Date(inicial.fechaLimite).getTime() <= Date.now();

  return (
    <div className="flex min-w-[260px] flex-col gap-1">
      <div className="flex items-center gap-1">
        {!soloComentario && (
          <select
            className="rounded-md border border-slate-300 px-1.5 py-1 text-xs outline-none focus:border-brand-500"
            value={dias}
            onChange={(e) => setDias(Number(e.target.value))}
          >
            <option value={5}>5 días</option>
            <option value={10}>10 días</option>
            <option value={15}>15 días</option>
          </select>
        )}
        <input
          className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1 text-xs outline-none focus:border-brand-500"
          placeholder="Comentario…"
          value={comentario}
          onChange={(e) => setComentario(e.target.value)}
        />
        <button
          onClick={() => onGuardar(soloComentario ? 0 : dias, comentario)}
          disabled={guardando}
          className="rounded-md bg-brand-600 px-2 py-1 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {guardando ? "…" : "Guardar"}
        </button>
      </div>
      {inicial && !soloComentario && (
        <span className={`text-[11px] ${vencido ? "font-semibold text-red-600" : "text-slate-400"}`}>
          {vencido ? "⏰ Venció" : "Vence"} {fmtDia(inicial.fechaLimite)}
          {inicial.creadoPorNombre ? ` · por ${inicial.creadoPorNombre}` : ""}
          {inicial.atendido ? " · atendido" : ""}
        </span>
      )}
      {inicial && soloComentario && inicial.creadoPorNombre && (
        <span className="text-[11px] text-slate-400">por {inicial.creadoPorNombre}</span>
      )}
    </div>
  );
}
