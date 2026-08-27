"use client";

// Conejo de cuerpo completo (🐇) que recorre el MARCO de la ventana (perímetro
// del viewport). Siempre mira hacia adelante (a la derecha en el borde inferior,
// a la izquierda en el superior). Al hacer clic lleva al TikTok de Radar.
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
      {/* 3 capas: posición (marco) → orientación (facing) → brinco (bob) */}
      <span className="conejo-face">
        <span className="conejo-bob">🐇</span>
      </span>
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
        .conejo-face {
          display: inline-block;
          animation: facing 24s linear infinite;
        }
        .conejo-bob {
          display: inline-block;
          font-size: 40px;
          line-height: 1;
          filter: drop-shadow(0 3px 4px rgba(0, 0, 0, 0.3));
          animation: bob 0.8s ease-in-out infinite;
        }
        .conejo-marco:hover,
        .conejo-marco:hover .conejo-face,
        .conejo-marco:hover .conejo-bob {
          animation-play-state: paused;
        }
        /* Perímetro de la ventana. */
        @keyframes marco {
          0%   { top: 90%; left: 1%; }
          25%  { top: 90%; left: 95%; }
          50%  { top: 3%;  left: 95%; }
          75%  { top: 3%;  left: 1%; }
          100% { top: 90%; left: 1%; }
        }
        /* Mira a la derecha en el borde inferior/derecho, a la izquierda en el
           superior/izquierdo → nunca camina "hacia atrás". Flip casi instantáneo. */
        @keyframes facing {
          0%     { transform: scaleX(-1); }
          49.6%  { transform: scaleX(-1); }
          50%    { transform: scaleX(1); }
          99.6%  { transform: scaleX(1); }
          100%   { transform: scaleX(-1); }
        }
        @keyframes bob {
          0%, 100% { transform: translateY(0); }
          50%      { transform: translateY(-8px); }
        }
        @media (prefers-reduced-motion: reduce) {
          .conejo-marco { animation: none; top: auto; bottom: 14px; left: 16px; }
          .conejo-face, .conejo-bob { animation: none; }
        }
      `}</style>
    </a>
  );
}
