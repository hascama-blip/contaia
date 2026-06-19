// Logo ASENCO recreado en código (sin la línea inferior del estudio) + "IA"
// distintivo en dorado. Si luego subes el archivo oficial, se reemplaza por la
// imagen exacta. `dark` = para fondos azul marino (texto en blanco).

export function LogoAsenco({
  className = "",
  dark = false,
}: {
  className?: string;
  dark?: boolean;
}) {
  const palabra = dark ? "text-white" : "text-brand-800";
  const punto = dark ? "bg-white" : "bg-brand-500";
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      {/* Acento triangular rojo + wordmark ASENCO */}
      <span className="inline-flex items-center">
        <span
          className="mr-1 inline-block h-0 w-0 border-x-[6px] border-b-[12px] border-x-transparent border-b-red-600"
          aria-hidden
        />
        <span className="text-2xl font-black leading-none tracking-tight">
          <span className={palabra}>ASENCO</span>
        </span>
      </span>

      {/* Motivo de puntos (halftone) que se desvanece, como el logo */}
      <span className="grid grid-cols-3 gap-[2px]" aria-hidden>
        {Array.from({ length: 9 }).map((_, i) => (
          <span
            key={i}
            className={`h-[3px] w-[3px] rounded-[1px] ${punto}`}
            style={{ opacity: 1 - Math.floor(i / 3) * 0.32 }}
          />
        ))}
      </span>

      {/* "IA" distintivo: chip dorado con destello */}
      <span className="relative inline-flex items-center rounded-md bg-gradient-to-br from-accent-300 to-accent-500 px-1.5 py-0.5 text-sm font-black leading-none text-brand-900 shadow-sm ring-1 ring-accent-500/40">
        IA
        <span className="absolute -right-0.5 -top-0.5 text-[8px] leading-none text-accent-200">✦</span>
      </span>
    </span>
  );
}
