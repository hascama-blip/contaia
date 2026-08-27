"use client";

// Conejo de cuerpo completo (🐇) que recorre el MARCO de la ventana (perímetro
// del viewport: abajo → derecha → arriba → izquierda, en bucle). Al hacer clic
// lleva al TikTok de Radar. Se pausa al pasar el mouse para poder clicarlo.
const TIKTOK = "https://www.tiktok.com/@radartributaria";

export default function ConejoTikTok() {
  return (
    <a
      href={TIKTOK}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Síguenos en TikTok"
      title="🐇 ¡Síguenos en TikTok!"
      className="conejo-marco"
    >
      <span className="conejo-inner">🐇</span>
      <style jsx>{`
        .conejo-marco {
          position: fixed;
          top: 90%;
          left: 1%;
          z-index: 45;
          text-decoration: none;
          cursor: pointer;
          will-change: top, left;
          animation: marco 24s linear infinite;
        }
        .conejo-inner {
          display: inline-block;
          font-size: 40px;
          line-height: 1;
          filter: drop-shadow(0 3px 4px rgba(0, 0, 0, 0.3));
          animation: bob 0.8s ease-in-out infinite;
        }
        .conejo-marco:hover,
        .conejo-marco:hover .conejo-inner {
          animation-play-state: paused;
        }
        /* Recorre el perímetro de la ventana. */
        @keyframes marco {
          0%   { top: 90%; left: 1%; }
          25%  { top: 90%; left: 95%; }
          50%  { top: 3%;  left: 95%; }
          75%  { top: 3%;  left: 1%; }
          100% { top: 90%; left: 1%; }
        }
        @keyframes bob {
          0%, 100% { transform: translateY(0) scaleX(-1); }
          50%      { transform: translateY(-8px) scaleX(-1); }
        }
        @media (prefers-reduced-motion: reduce) {
          .conejo-marco { animation: none; top: auto; bottom: 14px; left: 16px; }
          .conejo-inner { animation: none; }
        }
      `}</style>
    </a>
  );
}
