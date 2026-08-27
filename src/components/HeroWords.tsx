"use client";

// Palabras que aparecen y desaparecen como "blips" del radar, en posiciones
// dispersas del hero. Cada una: un punto que late + su palabra. Se turnan.
const BLIPS: { w: string; top: string; left: string }[] = [
  { w: "Deudas", top: "20%", left: "14%" },
  { w: "Buzón", top: "30%", left: "74%" },
  { w: "Mensajes", top: "66%", left: "22%" },
  { w: "SIRE", top: "72%", left: "66%" },
  { w: "ITF", top: "24%", left: "52%" },
  { w: "Impuestos", top: "54%", left: "40%" },
  { w: "Presentación", top: "44%", left: "84%" },
  { w: "4ta/5ta categoría", top: "80%", left: "46%" },
];

export default function HeroWords() {
  const paso = 2; // segundos por blip
  const total = BLIPS.length * paso;
  return (
    <div aria-hidden translate="no" className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
      {BLIPS.map((b, i) => (
        <span
          key={b.w}
          className="blip"
          style={{ top: b.top, left: b.left, animationDelay: `${i * paso}s`, animationDuration: `${total}s` }}
        >
          <span className="punto" />
          {b.w}
        </span>
      ))}
      <style jsx>{`
        .blip {
          position: absolute;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          transform: translate(-50%, -50%);
          white-space: nowrap;
          font-weight: 700;
          font-size: clamp(0.95rem, 2.2vw, 1.6rem);
          color: rgba(186, 230, 253, 0.85);
          opacity: 0;
          animation-name: blip;
          animation-timing-function: cubic-bezier(0.45, 0, 0.2, 1);
          animation-iteration-count: infinite;
        }
        .punto {
          width: 9px;
          height: 9px;
          border-radius: 9999px;
          background: rgb(56, 189, 248);
          box-shadow: 0 0 10px 2px rgba(56, 189, 248, 0.7);
        }
        @keyframes blip {
          0%   { opacity: 0; transform: translate(-50%, -50%) scale(0.7); }
          5%   { opacity: 1; transform: translate(-50%, -50%) scale(1); }
          11%  { opacity: 1; }
          16%  { opacity: 0; transform: translate(-50%, -50%) scale(1.1); }
          100% { opacity: 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .blip { animation: none; }
        }
      `}</style>
    </div>
  );
}
