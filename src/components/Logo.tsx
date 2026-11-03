// Marca "RADAR TRIBUTAR·IA · by ASENCO" con ícono de radar.
// "IA" resaltada (la inteligencia artificial) y ASENCO bien visible.
// `dark` = para fondos azul marino (texto en blanco).

export function LogoAsenco({
  className = "",
  dark = false,
  size = "md",
}: {
  className?: string;
  dark?: boolean;
  /** "sm" = versión compacta en una sola línea (barra lateral). */
  size?: "md" | "sm";
}) {
  const sm = size === "sm";
  const main = dark ? "text-white" : "text-brand-800";
  const gold = dark ? "text-accent-300" : "text-accent-600";
  const strokeMain = dark ? "stroke-white" : "stroke-brand-700";
  const fillGold = dark ? "fill-accent-300" : "fill-accent-500";
  const iaPill = dark ? "bg-accent-300 text-brand-900" : "bg-accent-400 text-brand-900";

  return (
    <span translate="no" className={`inline-flex items-center whitespace-nowrap ${sm ? "gap-1.5" : "gap-2"} ${className}`}>
      {/* Ícono de radar */}
      <svg viewBox="0 0 24 24" className={`${sm ? "h-7 w-7" : "h-8 w-8"} shrink-0`} fill="none" aria-hidden>
        <circle cx="12" cy="12" r="9.5" className={strokeMain} strokeWidth="1.5" opacity="0.4" />
        <circle cx="12" cy="12" r="5.5" className={strokeMain} strokeWidth="1.5" opacity="0.75" />
        <line x1="12" y1="12" x2="20.5" y2="5.5" className="stroke-accent-400" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="12" cy="12" r="2" className={fillGold} />
      </svg>

      <span className="inline-flex flex-col leading-none">
        <span className={`${sm ? "text-[15px]" : "text-lg"} font-black tracking-tight`}>
          <span className={main}>RADAR </span>
          <span className={gold}>TRIBUTAR</span>
          <span className={`ml-0.5 rounded px-1 font-black ${iaPill}`}>IA</span>
        </span>
      </span>
    </span>
  );
}
