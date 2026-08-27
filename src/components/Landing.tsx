import { LogoAsenco } from "@/components/Logo";

// Landing PÚBLICA (visitantes sin sesión). Describe la plataforma módulo por
// módulo con una captura de cada uno. El botón "Iniciar" lleva al app público.
// El login interno de ESTA web no se enlaza aquí (queda oculto en /login).
const APP_LOGIN = "https://app.radartributaria.com/login";

interface Modulo {
  icono: string;
  titulo: string;
  detalle: string;
  captura: string; // /capturas/<archivo>.png (colócalo en public/capturas)
}

const MODULOS: Modulo[] = [
  {
    icono: "📑",
    titulo: "Reporte analítico de auditoría",
    detalle:
      "Consulta el estado del RUC en SUNAT, extrae SIRE (compras/ventas), buzón, declaraciones y deudas, y arma un informe de gerencia con contingencias y recomendaciones — todo desde una sola ficha del cliente.",
    captura: "/capturas/reporte.png",
  },
  {
    icono: "📨",
    titulo: "Consultas tributarias",
    detalle:
      "Lee los mensajes del buzón electrónico SUNAT con sus asuntos y descarga el PDF de cada notificación, resaltando lo urgente y lo peligroso (cobranza, fiscalización, valores).",
    captura: "/capturas/consultas.png",
  },
  {
    icono: "📄",
    titulo: "Reporte Tributario para Terceros (RTT)",
    detalle:
      "Solicita el RTT de SUNAT y recíbelo automáticamente por correo, con trazabilidad de cada estado (creado → en proceso → listo) y descarga del PDF/XML cuando llega.",
    captura: "/capturas/rtt.png",
  },
  {
    icono: "📊",
    titulo: "Detalle SIRE",
    detalle:
      "Revisa el detalle de los comprobantes del SIRE por periodo — compras (RCE) y ventas (RVIE) — y el estado presentado / no presentado de cada mes.",
    captura: "/capturas/detalle-sire.png",
  },
];

// Radar animado: ícono central + aros de pulso que se expanden y desvanecen
// (como un radar) + un barrido giratorio. Da vida al hero.
function RadarPulse() {
  return (
    <div className="relative mx-auto mb-6 h-28 w-28">
      {/* Aros de pulso (se expanden y se desvanecen, escalonados) */}
      <span className="absolute inset-0 rounded-full border-2 border-accent-300/50 animate-ping [animation-duration:2.4s]" />
      <span className="absolute inset-0 rounded-full border-2 border-accent-300/40 animate-ping [animation-duration:2.4s] [animation-delay:0.8s]" />
      <span className="absolute inset-0 rounded-full border-2 border-accent-300/30 animate-ping [animation-duration:2.4s] [animation-delay:1.6s]" />
      {/* Barrido giratorio del radar */}
      <span
        className="absolute inset-1 rounded-full animate-spin [animation-duration:3.5s]"
        style={{ background: "conic-gradient(from 0deg, rgba(253,224,71,0.45), rgba(253,224,71,0.05) 22%, transparent 40%)" }}
      />
      {/* Disco base + ícono central del radar */}
      <div className="absolute inset-0 flex items-center justify-center rounded-full bg-white/5 ring-1 ring-white/15">
        <svg viewBox="0 0 24 24" className="h-14 w-14" fill="none" aria-hidden>
          <circle cx="12" cy="12" r="9.5" className="stroke-white" strokeWidth="1.2" opacity="0.35" />
          <circle cx="12" cy="12" r="5.5" className="stroke-white" strokeWidth="1.2" opacity="0.6" />
          <line x1="12" y1="12" x2="20.5" y2="5.5" className="stroke-accent-300" strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="12" cy="12" r="2" className="fill-accent-300" />
        </svg>
      </div>
    </div>
  );
}

function Captura({ src, icono, titulo }: { src: string; icono: string; titulo: string }) {
  // Marco tipo ventana de navegador. Muestra la imagen si existe; si no, un
  // fondo con el ícono como "vista previa" (para que nunca salga rota).
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-1.5 border-b border-slate-100 bg-slate-50 px-3 py-2">
        <span className="h-2.5 w-2.5 rounded-full bg-red-300" />
        <span className="h-2.5 w-2.5 rounded-full bg-amber-300" />
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-300" />
        <span className="ml-2 truncate text-[11px] text-slate-400">radartributaria — {titulo}</span>
      </div>
      <div
        className="relative flex aspect-[16/10] items-center justify-center bg-gradient-to-br from-brand-50 to-slate-100"
        style={{ backgroundImage: `url(${src})`, backgroundSize: "cover", backgroundPosition: "top center" }}
      >
        {/* Si la imagen no está, se ve este ícono de fondo (vista previa). */}
        <span className="pointer-events-none text-5xl opacity-25">{icono}</span>
      </div>
    </div>
  );
}

export default function Landing() {
  return (
    <div className="-mx-3 sm:-mx-4">
      {/* Barra superior pública */}
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2" translate="no"><LogoAsenco /></div>
          <a href={APP_LOGIN} className="btn-primary text-sm">Iniciar</a>
        </div>
      </header>

      {/* Hero */}
      <section className="hero-gradient text-white">
        <div className="mx-auto max-w-5xl px-6 py-16 text-center sm:py-24">
          <RadarPulse />
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-accent-300">
            Diagnóstico tributario asistido
          </p>
          <h1 className="text-3xl font-bold leading-tight sm:text-5xl" translate="no">RADAR TRIBUTAR·IA</h1>
          <p className="mx-auto mt-4 max-w-2xl text-base text-white/85 sm:text-lg">
            La plataforma que revisa el estado tributario de tus clientes en SUNAT —
            SIRE, buzón, declaraciones, deudas y reportes— y arma el informe de gerencia
            por ti, con trazabilidad de cada paso.
          </p>
          <div className="mt-8">
            <a href={APP_LOGIN} className="rounded-xl bg-white px-6 py-3 text-sm font-semibold text-brand-800 shadow-sm transition hover:bg-white/90">
              Iniciar →
            </a>
          </div>
        </div>
      </section>

      {/* Módulos con captura */}
      <section className="mx-auto max-w-6xl px-6 py-14">
        <div className="mb-10 text-center">
          <h2 className="text-xl font-bold text-slate-800 sm:text-2xl">¿Qué incluye la plataforma?</h2>
          <p className="mx-auto mt-2 max-w-2xl text-sm text-slate-500">
            Cada módulo automatiza un procedimiento de la auditoría tributaria.
          </p>
        </div>

        <div className="space-y-14">
          {MODULOS.map((m, i) => (
            <div key={m.titulo} className={`grid items-center gap-8 sm:grid-cols-2 ${i % 2 ? "sm:[&>div:first-child]:order-2" : ""}`}>
              <div>
                <div className="mb-2 text-3xl">{m.icono}</div>
                <h3 className="text-lg font-bold text-slate-800">{m.titulo}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-500">{m.detalle}</p>
              </div>
              <Captura src={m.captura} icono={m.icono} titulo={m.titulo} />
            </div>
          ))}
        </div>

        <div className="mt-16 rounded-2xl border border-brand-100 bg-brand-50 p-8 text-center">
          <h3 className="text-lg font-bold text-slate-800">Empieza ahora</h3>
          <p className="mx-auto mt-1 max-w-xl text-sm text-slate-500">
            Ingresa a la plataforma para consultar a tus clientes y generar sus informes.
          </p>
          <a href={APP_LOGIN} className="btn-primary mt-5 inline-flex">Iniciar sesión →</a>
        </div>
      </section>
    </div>
  );
}
