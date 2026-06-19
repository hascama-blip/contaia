// Marca "RADAR TRIBUTARIO · by asenco" con ícono de radar.
// `dark` = para fondos azul marino (texto en blanco).

export function LogoAsenco({
  className = "",
  dark = false,
}: {
  className?: string;
  dark?: boolean;
}) {
  const main = dark ? "text-white" : "text-brand-800";
  const sub = dark ? "text-white/70" : "text-slate-400";
  const gold = dark ? "text-accent-300" : "text-accent-600";
  const azul = dark ? "text-brand-200" : "text-brand-600";
  const strokeMain = dark ? "stroke-white" : "stroke-brand-700";
  const fillGold = dark ? "fill-accent-300" : "fill-accent-500";

  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      {/* Ícono de radar */}
      <svg viewBox="0 0 24 24" className="h-8 w-8 shrink-0" fill="none" aria-hidden>
        <circle cx="12" cy="12" r="9.5" className={strokeMain} strokeWidth="1.5" opacity="0.4" />
        <circle cx="12" cy="12" r="5.5" className={strokeMain} strokeWidth="1.5" opacity="0.75" />
        <line x1="12" y1="12" x2="20.5" y2="5.5" className="stroke-accent-400" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="12" cy="12" r="2" className={fillGold} />
      </svg>

      <span className="inline-flex flex-col leading-none">
        <span className="text-lg font-black tracking-tight">
          <span className={main}>RADAR </span>
          <span className={gold}>TRIBUTARIO</span>
        </span>
        <span className={`mt-0.5 text-[10px] font-semibold uppercase tracking-[0.25em] ${sub}`}>
          by <span className={`font-bold ${azul}`}>asenco</span>
        </span>
      </span>
    </span>
  );
}
