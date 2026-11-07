// Indicador de demora aproximada de un proceso (a la derecha de cada caja que
// genera información). Es una guía: el tiempo real depende de SUNAT.
export const TIEMPOS = {
  sunatRuc: "~5 s",
  diagnostico: "~5 s",
  buzon: "~1 min",
  deudas: "2 a 4 min",
  rentas: "~2 min + correo de SUNAT",
  itf: "1 a 2 min",
  estadoSire: "~20 s",
  montosSire: "~10 s por mes",
  cuarta: "1 a 2 min",
  detalleSire: "30 s a 2 min por periodo",
  rtt: "~2 min + correo de SUNAT",
  facturas: "~10 s por comprobante",
  honorarios: "~2 min + 3 s por recibo",
} as const;

export default function TiempoAprox({ tiempo, className = "" }: { tiempo: string; className?: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-500 ${className}`}
      title="Tiempo aproximado. Puede variar según la respuesta de SUNAT."
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 7.5V12l3 2" />
      </svg>
      <span className="text-slate-400">Demora aprox.</span>
      <span className="font-medium text-slate-600">{tiempo}</span>
    </span>
  );
}
