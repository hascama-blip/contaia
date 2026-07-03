// Logo de SUNAT recreado como SVG (isotipo "S" rojo/azul + wordmark), para usar
// como marca de agua al final del informe. Autocontenido (imprime nítido).

export function LogoSunat({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-3 ${className}`} aria-label="SUNAT">
      <svg viewBox="0 0 60 60" className="h-10 w-10 shrink-0" role="img" aria-hidden>
        {/* Mitad superior (roja) del isotipo en S */}
        <path
          fill="#e30613"
          d="M31 6c11 0 19 5.5 19 15 0 7.5-6 10.5-14 10.5h-6v-9h6c3 0 5-1 5-3 0-3-4-5-11-5-8 0-13 3-13 8H8C8 13 18 6 31 6Z"
        />
        {/* Mitad inferior (azul) del isotipo en S */}
        <path
          fill="#004a99"
          d="M29 54c-11 0-19-5.5-19-15 0-7.5 6-10.5 14-10.5h6v9h-6c-3 0-5 1-5 3 0 3 4 5 11 5 8 0 13-3 13-8h9C52 47 42 54 29 54Z"
        />
      </svg>
      <span className="text-3xl font-extrabold tracking-tight text-[#00337a]">SUNAT</span>
    </span>
  );
}
