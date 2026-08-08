import Link from "next/link";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Adquirir módulos — Radar Tributario" };

// Contacto para adquirir/cotizar planes (ajustable).
const CONTACTO = "hascama@asencoauditores.com";
const mailto = (plan: string) =>
  `mailto:${CONTACTO}?subject=${encodeURIComponent(`Quiero adquirir el ${plan} — Radar Tributario`)}`;

interface Plan {
  nombre: string;
  precioNota: string;
  resumen: string;
  destacado?: boolean;
  cta: string;
  ctaHref: string;
  ctaEstilo: "primary" | "accent" | "ghost";
  incluidos: { antes?: string; titulo: string; puntos: string[] }[];
  proximamente?: { titulo: string; puntos: string[] };
}

const PLANES: Plan[] = [
  {
    nombre: "Plan Gratis",
    precioNota: "Sin costo",
    resumen: "Para empezar: consulta básica y el reporte analítico de auditoría.",
    cta: "Empezar gratis",
    ctaHref: "/",
    ctaEstilo: "ghost",
    incluidos: [
      {
        titulo: "Módulo de Consultas — 2 por semana",
        puntos: [
          "Consulta el estado del RUC en SUNAT (razón social, estado y condición de domicilio).",
          "Actividad económica y datos generales del contribuyente.",
          "Límite: 2 consultas a la semana.",
        ],
      },
      {
        titulo: "Reporte Analítico de Auditoría",
        puntos: [
          "Diagnóstico tributario del contribuyente con hallazgos y score de riesgo.",
          "Revisión del buzón electrónico (mensajes peligrosos y urgentes) y deudas.",
          "Dashboard e informe de gerencia imprimible (contingencias, buzón y gráficos en una hoja).",
        ],
      },
    ],
  },
  {
    nombre: "Plan Regular",
    precioNota: "Todo lo del Gratis, y más",
    resumen: "Más consultas y el módulo de consultas tributarias.",
    cta: "Solicitar plan",
    ctaHref: "",
    ctaEstilo: "primary",
    incluidos: [
      {
        titulo: "Módulo de Consultas — 3 por semana",
        puntos: [
          "Todo lo del plan Gratis.",
          "Límite ampliado: 3 consultas a la semana.",
        ],
      },
      {
        titulo: "Módulo de Consultas Tributarias",
        puntos: [
          "Ficha RUC completa: representantes legales, establecimientos anexos y condición de domicilio.",
          "Validación de comprobantes y verificación de proveedores/clientes por RUC.",
          "Consulta de deudas y situación tributaria del contribuyente.",
          "Exporta los resultados para tu expediente.",
        ],
      },
    ],
  },
  {
    nombre: "Plan Premium",
    precioNota: "Todo lo del Regular, y más",
    resumen: "El detalle real del SIRE y el Reporte Tributario para Terceros, automáticos.",
    destacado: true,
    cta: "Solicitar Premium",
    ctaHref: "",
    ctaEstilo: "accent",
    incluidos: [
      {
        titulo: "Módulo Detalle SIRE",
        puntos: [
          "Compras y ventas reales por periodo (RCE / RVIE) directo de SUNAT.",
          "Acumulado anual y estado presentado / no presentado por mes.",
          "Cruce del SIRE contra tu sistema contable, comprobante por comprobante.",
        ],
      },
      {
        titulo: "Reporte Tributario para Terceros (RTT)",
        puntos: [
          "Genera el RTT en SUNAT de forma automática (llega a la nube, sin revisar correos).",
          "Descarga el PDF y el XML del reporte cuando esté listo.",
          "Una casilla por empresa: se actualiza sola en cada generación.",
        ],
      },
    ],
    proximamente: {
      titulo: "Próximamente",
      puntos: [
        "Comprobantes XML masivos desde SUNAT: descarga y consolida todos los comprobantes del mes en Excel y ZIP, sin bajarlos uno por uno.",
        "SIRE automático: extracción programada de compras y ventas de todos los periodos, sin intervención.",
      ],
    },
  },
  {
    nombre: "Plan Personalizado",
    precioNota: "Para empresas grandes",
    resumen: "A la medida de estudios y empresas con alto volumen.",
    cta: "Contactar",
    ctaHref: "",
    ctaEstilo: "primary",
    incluidos: [
      {
        titulo: "Todo incluido, a tu medida",
        puntos: [
          "Todos los módulos, sin límite de consultas ni de clientes.",
          "Usuarios y equipos ilimitados con control de accesos.",
          "Integraciones con tu sistema contable y flujos a medida.",
          "Soporte dedicado y prioridad en nuevas funciones.",
        ],
      },
    ],
  },
];

export default async function Page() {
  await requireUser();

  return (
    <div className="space-y-6">
      <div>
        <Link href="/" className="text-sm text-brand-600 hover:underline">← Menú</Link>
        <h1 className="mt-1 text-2xl font-bold text-slate-800">Adquirir todos los módulos</h1>
        <p className="text-sm text-slate-500">
          Elige el plan que necesitas. Puedes empezar gratis y ampliar cuando quieras.
        </p>
      </div>

      <div className="grid items-stretch gap-4 md:grid-cols-2 xl:grid-cols-4">
        {PLANES.map((p) => (
          <div
            key={p.nombre}
            className={`relative flex flex-col rounded-2xl border bg-white p-5 shadow-sm ${
              p.destacado ? "border-accent-300 ring-2 ring-accent-200" : "border-slate-200"
            }`}
          >
            {p.destacado && (
              <span className="absolute -top-3 left-5 rounded-full bg-accent-400 px-3 py-0.5 text-xs font-bold text-brand-900 shadow">
                Más popular
              </span>
            )}

            <h2 className="text-lg font-bold text-slate-800">{p.nombre}</h2>
            <p className="mt-0.5 text-xs font-semibold uppercase tracking-wide text-brand-600">{p.precioNota}</p>
            <p className="mt-2 text-sm text-slate-500">{p.resumen}</p>

            <div className="mt-4 flex-1 space-y-4">
              {p.incluidos.map((grupo, gi) => (
                <div key={gi}>
                  <p className="mb-1 text-sm font-semibold text-slate-800">{grupo.titulo}</p>
                  <ul className="space-y-1">
                    {grupo.puntos.map((pt, pi) => (
                      <li key={pi} className="flex gap-2 text-xs text-slate-600">
                        <span className="mt-0.5 text-emerald-500">✓</span>
                        <span>{pt}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}

              {p.proximamente && (
                <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3">
                  <p className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500">🔜 {p.proximamente.titulo}</p>
                  <ul className="space-y-1">
                    {p.proximamente.puntos.map((pt, pi) => (
                      <li key={pi} className="flex gap-2 text-xs text-slate-500">
                        <span className="mt-0.5">•</span>
                        <span>{pt}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <a
              href={p.ctaHref || mailto(p.nombre)}
              className={`mt-5 w-full text-center ${
                p.ctaEstilo === "accent" ? "btn-accent" : p.ctaEstilo === "ghost" ? "btn-ghost" : "btn-primary"
              }`}
            >
              {p.cta}
            </a>
          </div>
        ))}
      </div>

      <p className="text-center text-xs text-slate-400">
        ¿Dudas sobre qué plan te conviene? Escríbenos a{" "}
        <a href={`mailto:${CONTACTO}`} className="text-brand-600 hover:underline">{CONTACTO}</a>.
      </p>
    </div>
  );
}
