import { LogoAsenco } from "@/components/Logo";
import CapturaModulo from "@/components/CapturaModulo";
import ConejoTikTok from "@/components/ConejoTikTok";

// Landing PÚBLICA (visitantes sin sesión). Describe la plataforma módulo por
// módulo con una captura de cada uno. El botón "Iniciar" lleva al app público.
// El login interno de ESTA web no se enlaza aquí (queda oculto en /login).
const APP_LOGIN = "https://app.radartributaria.com/login";

interface ClaseRuc {
  etiqueta: string;
  genera: string;
}
interface Modulo {
  icono: string;
  titulo: string;
  detalle: string;
  captura: string; // /capturas/<archivo>.png (colócalo en public/capturas)
  clases?: ClaseRuc[]; // solo el primer módulo: qué genera según la clase de RUC
}

const MODULOS: Modulo[] = [
  {
    icono: "📑",
    titulo: "Reporte analítico de auditoría",
    detalle:
      "El corazón de la plataforma. Con solo el RUC consulta el estado del contribuyente en SUNAT y ejecuta, desde una sola ficha, todos los procedimientos hasta el informe de gerencia con contingencias y recomendaciones. La información que genera depende de la clase de RUC:",
    captura: "/capturas/reporte.png",
    clases: [
      {
        etiqueta: "RUC 20 · Empresa (persona jurídica)",
        genera:
          "SIRE de compras (RCE) y ventas (RVIE), estado presentado/no presentado, buzón electrónico, deudas y fraccionamiento (Art. 36), declaraciones mensuales comparadas contra el SIRE y DJ anual (Formulario 710).",
      },
      {
        etiqueta: "RUC 10 · Persona natural CON negocio (3ª categoría)",
        genera:
          "Igual que una empresa: está obligada al SIRE, así que genera compras/ventas, buzón, deudas, declaraciones vs SIRE y DJ anual.",
      },
      {
        etiqueta: "RUC 10 · Persona natural SIN negocio",
        genera:
          "No lleva SIRE. En su lugar se habilitan Rentas de 4ta/5ta categoría (por empleador y periodo) e ITF, además del buzón y las deudas.",
      },
    ],
  },
  {
    icono: "📨",
    titulo: "Consultas tributarias",
    detalle:
      "Extrae el buzón electrónico de SUNAT y las deudas del fraccionamiento (Art. 36) sin revisar el portal a mano. Lee cada notificación con su asunto, descarga su PDF y resalta lo urgente y lo peligroso: cobranza coactiva, fiscalización, valores y procedimientos no contenciosos.",
    captura: "/capturas/consultas.png",
  },
  {
    icono: "📄",
    titulo: "Reporte Tributario para Terceros (RTT)",
    detalle:
      "Solicita el RTT de SUNAT y lo recibe por ti, sin revisar el correo a mano. El bot inicia sesión, pide el reporte y un webhook captura el PDF/XML apenas SUNAT lo envía, con trazabilidad de cada estado (creado → en proceso → listo) y descarga directa.",
    captura: "/capturas/rtt.png",
  },
  {
    icono: "📊",
    titulo: "Detalle SIRE",
    detalle:
      "Baja el detalle comprobante por comprobante de la propuesta SUNAT vía la API oficial del SIRE — compras (RCE) y ventas (RVIE) por periodo — con base, IGV y total de cada documento, y el estado presentado / no presentado de cada mes.",
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

export default function Landing() {
  return (
    <div className="-mx-3 sm:-mx-4">
      <ConejoTikTok />
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

              {m.clases && (
                <div className="mx-auto mb-6 grid max-w-3xl gap-3 sm:grid-cols-3">
                  {m.clases.map((c) => (
                    <div key={c.etiqueta} className="rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm">
                      <p className="text-sm font-bold text-brand-700">{c.etiqueta}</p>
                      <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{c.genera}</p>
                    </div>
                  ))}
                </div>
              )}

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
