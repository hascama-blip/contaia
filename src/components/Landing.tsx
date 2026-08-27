import { LogoAsenco } from "@/components/Logo";

// Landing PÚBLICA (para visitantes sin sesión). Describe la plataforma y sus
// módulos principales (no utilitarios) y manda a iniciar al app público. El
// login interno de esta web NO se enlaza aquí (queda oculto en /login).
const APP_LOGIN = "https://app.radartributaria.com/login";

const MODULOS = [
  {
    icono: "📑",
    titulo: "Reporte analítico de auditoría",
    detalle:
      "Consulta el estado del RUC en SUNAT, extrae SIRE (compras/ventas), buzón, declaraciones y deudas, y arma un informe de gerencia con contingencias y recomendaciones.",
  },
  {
    icono: "📨",
    titulo: "Consultas tributarias",
    detalle:
      "Lee los mensajes del buzón electrónico SUNAT con sus asuntos y descarga el PDF de cada notificación, resaltando lo urgente y lo peligroso.",
  },
  {
    icono: "📄",
    titulo: "Reporte Tributario para Terceros (RTT)",
    detalle:
      "Solicita el RTT de SUNAT y recíbelo automáticamente, con trazabilidad de cada estado (creado → en proceso → listo) y descarga del PDF/XML.",
  },
  {
    icono: "📊",
    titulo: "Detalle SIRE",
    detalle:
      "Revisa el detalle de los comprobantes del SIRE por periodo — compras (RCE) y ventas (RVIE) — y el estado presentado / no presentado.",
  },
];

export default function Landing() {
  return (
    <div className="-mx-3 sm:-mx-4">
      {/* Barra superior pública (solo logo) */}
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2" translate="no">
          <LogoAsenco />
        </div>
        <a href={APP_LOGIN} className="btn-primary text-sm">Iniciar</a>
      </header>

      {/* Hero */}
      <section className="hero-gradient text-white">
        <div className="mx-auto max-w-5xl px-6 py-16 text-center sm:py-24">
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-accent-300">
            Diagnóstico tributario asistido
          </p>
          <h1 className="text-3xl font-bold leading-tight sm:text-5xl">
            <span translate="no">RADAR TRIBUTAR·IA</span>
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-base text-white/85 sm:text-lg">
            La plataforma que revisa el estado tributario de tus clientes en SUNAT —
            SIRE, buzón, declaraciones, deudas y reportes— y arma el informe de gerencia
            por ti, con trazabilidad de cada paso.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <a href={APP_LOGIN} className="rounded-xl bg-white px-6 py-3 text-sm font-semibold text-brand-800 shadow-sm transition hover:bg-white/90">
              Iniciar →
            </a>
          </div>
          <p className="mt-4 text-xs text-white/60">Acceso a la plataforma para estudios contables y auditores.</p>
        </div>
      </section>

      {/* Módulos principales */}
      <section className="mx-auto max-w-6xl px-6 py-14">
        <div className="mb-8 text-center">
          <h2 className="text-xl font-bold text-slate-800 sm:text-2xl">¿Qué hace la plataforma?</h2>
          <p className="mx-auto mt-2 max-w-2xl text-sm text-slate-500">
            Reúne en un solo lugar los procedimientos clave de una auditoría tributaria.
          </p>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          {MODULOS.map((m) => (
            <div key={m.titulo} className="card p-6">
              <div className="mb-2 text-2xl">{m.icono}</div>
              <h3 className="font-semibold text-slate-800">{m.titulo}</h3>
              <p className="mt-1.5 text-sm text-slate-500">{m.detalle}</p>
            </div>
          ))}
        </div>

        <div className="mt-12 rounded-2xl border border-brand-100 bg-brand-50 p-8 text-center">
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
