"use client";

// Conejo de cuerpo completo (🐇) que salta cruzando toda la página. Al hacer
// clic lleva al TikTok de Radar. Se pausa al pasar el mouse para poder clicarlo.
const TIKTOK = "https://www.tiktok.com/@radartributaria";

export default function ConejoTikTok() {
  return (
    <a
      href={TIKTOK}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Síguenos en TikTok"
      title="🐇 ¡Síguenos en TikTok!"
      className="conejo-pagina"
    >
      🐇
      <style jsx>{`
        .conejo-pagina {
          position: fixed;
          bottom: 14px;
          left: 0;
          z-index: 45;
          font-size: 42px;
          line-height: 1;
          text-decoration: none;
          cursor: pointer;
          filter: drop-shadow(0 3px 4px rgba(0, 0, 0, 0.3));
          will-change: left, transform;
          animation: cruza 16s linear infinite, brinca 0.85s ease-in-out infinite;
        }
        .conejo-pagina:hover {
          animation-play-state: paused;
        }
        @keyframes cruza {
          0%   { left: -8%; }
          100% { left: 106%; }
        }
        @keyframes brinca {
          0%, 100% { transform: translateY(0) scaleX(-1); }
          50%      { transform: translateY(-26px) scaleX(-1); }
        }
        @media (prefers-reduced-motion: reduce) {
          .conejo-pagina { animation: none; left: 16px; }
        }
      `}</style>
    </a>
  );
}
