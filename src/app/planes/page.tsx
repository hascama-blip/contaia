import Link from "next/link";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Adquirir módulos — Radar Tributario" };

// Contacto para adquirir / cotizar planes.
const CONTACTO = "dascama@gmail.com";
const mailto = (plan: string) =>
  `mailto:${CONTACTO}?subject=${encodeURIComponent(`Quiero adquirir el ${plan} — Radar Tributario`)}`;

interface Plan {
  nombre: string;
  precio: string;
  precioAntes?: string;
  periodo?: string;
  etiqueta?: string;
  resumen: string;
  destacado?: boolean;
  cta: string;
  ctaHref: string;
  ctaEstilo: "primary" | "accent" | "ghost";
  incluidos: { titulo: string; puntos: string[] }[];
  proximamente?: { titulo: string; puntos: string[] };
}

const PLANES: Plan[] = [
  {
    nombre: "Plan Básico",
    precio: "Gratis",
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
    precio: "S/ 4.99",
    precioAntes: "S/ 9.99",
    periodo: "/mes",
    etiqueta: "Lanzamiento −50%",
    resumen: "Más consultas y el módulo de consultas tributarias.",
    cta: "Solicitar plan",
    ctaHref: "",
    ctaEstilo: "primary",
    incluidos: [
      {
        titulo: "Todo lo del Plan Básico",
        puntos: [
          "Módulo de Consultas y Reporte Analítico de Auditoría incluidos.",
          "Consultas ampliadas a 3 por semana.",
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
    precio: "S/ 29.90",
    periodo: "/mes",
    resumen: "El detalle real del SIRE y el Reporte Tributario para Terceros, automáticos.",
    destacado: true,
    cta: "Solicitar Premium",
    ctaHref: "",
    ctaEstilo: "accent",
    incluidos: [
      {
        titulo: "Todo lo del Plan Regular",
        puntos: [
          "Consultas, Reporte Analítico de Auditoría y Consultas Tributarias incluidos.",
        ],
      },
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
        ],
      },
      {
        titulo: "Soporte 24/7",
        puntos: [
          "Atención prioritaria por cualquier canal, en cualquier momento.",
        ],
      },
    ],
    proximamente: {
      titulo: "Próximamente",
      puntos: [
        "Módulo Comprobantes XML: descarga tus facturas en bloque (todas juntas, no una por una).",
        "Detalle de facturas en Excel con glosa, para facilitar tus registros contables.",
      ],
    },
  },
  {
    nombre: "Plan de Equipo",
    precio: "A cotizar",
    resumen: "Para empresas: gestionen en equipo todas las empresas a su cargo.",
    cta: "Solicitar cotización",
    ctaHref: "",
    ctaEstilo: "primary",
    incluidos: [
      {
        titulo: "Todo lo del Plan Premium",
        puntos: [
          "Todos los módulos anteriores incluidos.",
        ],
      },
      {
        titulo: "Equipo y gestión",
        puntos: [
          "3 usuarios adicionales para tu empresa.",
          "Gestionen en equipo todas las empresas a su cargo.",
        ],
      },
      {
        titulo: "Soporte 24/7",
        puntos: [
          "Atención prioritaria por cualquier canal, en cualquier momento.",
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

            {/* Precio */}
            <div className="mt-1 flex items-end gap-2">
              <span className="text-2xl font-extrabold text-slate-900">{p.precio}</span>
              {p.periodo && <span className="pb-1 text-xs text-slate-400">{p.periodo}</span>}
              {p.precioAntes && <span className="pb-1 text-sm text-slate-400 line-through">{p.precioAntes}</span>}
            </div>
            {p.etiqueta && (
              <span className="mt-1 inline-flex w-fit rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700">
                {p.etiqueta}
              </span>
            )}

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
