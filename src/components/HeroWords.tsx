"use client";

// Palabras de fondo en el hero: aparecen y desaparecen una a una (deslizándose)
// detrás del logo y el título, sincronizadas con el pulso del radar.
const WORDS = [
  "Deudas",
  "Buzón",
  "Mensajes",
  "SIRE",
  "ITF",
  "Impuestos",
  "Presentación",
  "4ta/5ta categoría",
];

export default function HeroWords() {
  const paso = 2; // segundos por palabra
  const total = WORDS.length * paso;
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center overflow-hidden">
      {WORDS.map((w, i) => (
        <span
          key={w}
          className="hero-word"
          style={{ animationDelay: `${i * paso}s`, animationDuration: `${total}s` }}
        >
          {w}
        </span>
      ))}
      <style jsx>{`
        .hero-word {
          position: absolute;
          font-weight: 800;
          font-size: clamp(2.75rem, 10vw, 8rem);
          letter-spacing: -0.02em;
          white-space: nowrap;
          color: rgba(255, 255, 255, 0.09);
          opacity: 0;
          animation-name: heroWord;
          animation-timing-function: cubic-bezier(0.45, 0, 0.2, 1);
          animation-iteration-count: infinite;
        }
        @keyframes heroWord {
          0%    { opacity: 0; transform: translateY(28px) scale(0.94); }
          4%    { opacity: 1; transform: translateY(0) scale(1); }
          9%    { opacity: 1; transform: translateY(0) scale(1); }
          13%   { opacity: 0; transform: translateY(-28px) scale(1.06); }
          100%  { opacity: 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .hero-word { animation: none; }
        }
      `}</style>
    </div>
  );
}
