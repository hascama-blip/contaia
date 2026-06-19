// Logo ASENCO recreado en código (sin la línea inferior del estudio) + "IA"
// distintivo en dorado, pegado al wordmark. `dark` = fondos azul marino.

export function LogoAsenco({
  className = "",
  dark = false,
}: {
  className?: string;
  dark?: boolean;
}) {
  const palabra = dark ? "text-white" : "text-brand-800";
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <span className={`text-2xl font-black leading-none tracking-tight ${palabra}`}>
        ASENCO
      </span>
      {/* "IA" distintivo: chip dorado */}
      <span className="inline-flex items-center rounded-md bg-gradient-to-br from-accent-300 to-accent-500 px-1.5 py-0.5 text-sm font-black leading-none text-brand-900 shadow-sm ring-1 ring-accent-500/40">
        IA
      </span>
    </span>
  );
}
