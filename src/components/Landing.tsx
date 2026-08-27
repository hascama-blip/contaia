import { LogoAsenco } from "@/components/Logo";
import CapturaModulo from "@/components/CapturaModulo";
import ConejoTikTok from "@/components/ConejoTikTok";
import HeroWords from "@/components/HeroWords";

// Landing PÚBLICA (visitantes sin sesión). Describe la plataforma módulo por
// módulo con una captura de cada uno. El botón "Iniciar" lleva al app público.
// El login interno de ESTA web no se enlaza aquí (queda oculto en /login).
const APP_LOGIN = "https://app.radartributaria.com/login";

interface Modulo {
  icono: string;
  titulo: string;
  detalle: string;
  captura: string; // /capturas/<archivo>.png (colócalo en public/capturas)
  genera: string[]; // qué información genera este módulo
}

const MODULOS: Modulo[] = [
  {
    icono: "📑",
    titulo: "Reporte analítico de auditoría",
    detalle:
      "El corazón de la plataforma: con solo el RUC consulta el estado del contribuyente en SUNAT y ejecuta, desde una sola ficha, todos los procedimientos hasta el informe de gerencia.",
    captura: "/capturas/reporte.png",
    genera: [
      "Estado del RUC en SUNAT: actividad, condición de domicilio (habido) y datos generales.",
      "SIRE de compras (RCE) y ventas (RVIE) por periodo, con acumulado y estado presentado / no presentado.",
      "Mensajes del buzón electrónico clasificados por urgencia y peligro.",
      "Deudas tributarias y fraccionamiento (Art. 36), ignorando las autoliquidadas del total a pagar.",
      "Declaración mensual comparada contra el SIRE (alertas por diferencias).",
      "DJ anual (Formulario 710) año vs año — Estados Financieros y Estado de Resultados.",
      "Según la clase de RUC (20 empresa · 10 con/sin negocio) habilita SIRE o Rentas 4ta/5ta e ITF.",
      "Informe de gerencia en PDF con contingencias y recomendaciones para decidir.",
    ],
  },
  {
    icono: "📨",
    titulo: "Consultas tributarias",
    detalle:
      "Extrae el buzón electrónico de SUNAT y las deudas del fraccionamiento (Art. 36) sin revisar el portal a mano.",
    captura: "/capturas/consultas.png",
    genera: [
      "Lista de notificaciones y mensajes del buzón con su asunto y fecha.",
      "El PDF de cada notificación, listo para descargar.",
      "Clasificación de lo urgente y lo peligroso: cobranza coactiva, fiscalización, valores y no contenciosos.",
      "Deudas del fraccionamiento (Art. 36) con sus montos.",
    ],
  },
  {
    icono: "📄",
    titulo: "Reporte Tributario para Terceros (RTT)",
    detalle:
      "Solicita el RTT de SUNAT y lo recibe por ti: el bot inicia sesión, pide el reporte y un webhook captura el archivo apenas SUNAT lo envía.",
    captura: "/capturas/rtt.png",
    genera: [
      "El Reporte Tributario para Terceros en PDF y XML, tal como lo emite SUNAT.",
      "Trazabilidad de cada estado: creado → en proceso → listo.",
      "Descarga directa del reporte desde la plataforma (sin revisar el correo a mano).",
    ],
  },
  {
    icono: "📊",
    titulo: "Detalle SIRE",
    detalle:
      "Baja el detalle comprobante por comprobante de la propuesta SUNAT vía la API oficial del SIRE.",
    captura: "/capturas/detalle-sire.png",
    genera: [
      "Detalle comprobante por comprobante: serie-número, RUC, base imponible, IGV y total.",
      "Compras (RCE) y ventas (RVIE) por cada periodo consultado.",
      "Estado presentado / no presentado de cada mes.",
      "Exportación del comparativo para tu sistema contable.",
    ],
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

export default function Landing() {
  return (
    // Full-bleed: rompe el max-width del contenedor de la app para ocupar todo
    // el ancho de la pantalla (evita los lados vacíos en escritorio).
    <div className="relative left-1/2 -mt-5 w-screen -translate-x-1/2 overflow-x-hidden bg-slate-50 sm:-mt-6">
      <ConejoTikTok />
      {/* Barra superior pública */}
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 shadow-sm backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3.5 sm:px-6 sm:py-4">
          <div className="flex origin-left scale-110 items-center gap-2 sm:scale-[1.35]" translate="no"><LogoAsenco /></div>
          <a href={APP_LOGIN} className="btn-primary rounded-xl px-6 py-2.5 text-base font-semibold shadow-md sm:px-8 sm:py-3 sm:text-lg">
            Iniciar →
          </a>
        </div>
      </header>

      {/* Hero */}
      <section className="hero-gradient relative overflow-hidden text-white">
        {/* Fondo tipo radar: anillos concéntricos + cruz + barrido giratorio. */}
        <div aria-hidden className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center overflow-hidden">
          <div className="relative aspect-square h-[150%]">
            {[100, 80, 60, 40, 22].map((s) => (
              <div key={s} className="absolute rounded-full border border-cyan-300/10" style={{ inset: `${(100 - s) / 2}%` }} />
            ))}
            <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-cyan-300/10" />
            <div className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-cyan-300/10" />
            <div
              className="absolute inset-0 rounded-full animate-spin [animation-duration:6s]"
              style={{ background: "conic-gradient(from 0deg, rgba(56,189,248,0.20), rgba(56,189,248,0.02) 24%, transparent 44%)" }}
            />
          </div>
        </div>
        {/* Palabras/blips que aparecen y desaparecen en posiciones al azar. */}
        <HeroWords />
        <div className="relative z-10 mx-auto max-w-5xl px-6 py-16 text-center sm:py-24">
          <RadarPulse />
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-accent-300">
            Diagnóstico tributario asistido
          </p>
          <h1 className="text-3xl font-bold leading-tight sm:text-5xl" translate="no">RADAR TRIBUTAR·IA</h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-white/90 sm:text-xl">
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
        <div className="mb-12 text-center">
          <h2 className="text-3xl font-bold text-slate-800 sm:text-4xl">¿Qué incluye la plataforma?</h2>
          <p className="mx-auto mt-3 max-w-2xl text-base text-slate-600 sm:text-lg">
            Cada módulo automatiza un procedimiento de la auditoría tributaria.
            Toca el <span className="font-semibold text-emerald-600">punto verde</span> (o la ventana) para verlo en grande.
          </p>
        </div>

        <div className="space-y-24">
          {MODULOS.map((m) => (
            <div key={m.titulo} className="mx-auto max-w-4xl">
              <div className="mb-6 text-center">
                <div className="mb-2 text-5xl">{m.icono}</div>
                <h3 className="text-2xl font-bold text-slate-800 sm:text-3xl">{m.titulo}</h3>
                <p className="mx-auto mt-3 max-w-3xl text-base leading-relaxed text-slate-600 sm:text-lg">{m.detalle}</p>
              </div>

              <div className="mx-auto mb-6 max-w-3xl rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm sm:p-6">
                <p className="mb-3 text-sm font-bold uppercase tracking-wide text-brand-700">Información que genera</p>
                <ul className="space-y-2.5">
                  {m.genera.map((g, k) => (
                    <li key={k} className="flex gap-2.5 text-base leading-relaxed text-slate-600">
                      <span className="mt-0.5 text-emerald-500">✓</span>
                      <span>{g}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <CapturaModulo src={m.captura} icono={m.icono} titulo={m.titulo} />
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
