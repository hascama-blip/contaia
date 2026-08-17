// Datos de los planes (compartidos por la página /planes y el modal de bienvenida).

export interface Plan {
  nombre: string;
  /** Id interno del plan (para asignarlo desde el panel del supremo). */
  planId: "basico" | "regular" | "premium" | "equipo";
  /** true = gratis: el botón solo entra al servicio (no manda WhatsApp). */
  gratis?: boolean;
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

// Contacto para adquirir / cotizar planes.
export const CONTACTO = "dascama@gmail.com";
export const mailtoPlan = (plan: string) =>
  `mailto:${CONTACTO}?subject=${encodeURIComponent(`Quiero adquirir el ${plan} — Radar Tributario`)}`;

// WhatsApp donde llegan las solicitudes de plan (solo dígitos, con código país).
// Configurable por entorno; por defecto el número acordado.
export const WHATSAPP = (
  process.env.NEXT_PUBLIC_WHATSAPP ||
  process.env.WHATSAPP_NUMERO ||
  "51922574348"
).replace(/[^0-9]/g, "");

/** Link de WhatsApp con el mensaje de solicitud de plan ya armado. */
export function waPlan(nombre: string, plan: string, perfil: string): string {
  const msg = `hola, soy ${nombre} con el perfil ${perfil} y quiero el plan ${plan} deseo su metodo de pago para poder acceder al plan.`;
  return `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(msg)}`;
}

export const PLANES: Plan[] = [
  {
    nombre: "Plan Básico",
    planId: "basico",
    gratis: true,
    precio: "Gratis",
    resumen: "Para empezar: consulta básica y el reporte analítico de auditoría.",
    cta: "Empezar gratis",
    ctaHref: "/",
    ctaEstilo: "ghost",
    incluidos: [
      {
        titulo: "Módulo de Consultas",
        puntos: [
          "Consulta el estado del RUC en SUNAT (razón social, estado y condición de domicilio).",
          "Actividad económica y datos generales del contribuyente.",
          "Genera la información 1 vez a la semana por empresa.",
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
    planId: "regular",
    precio: "S/ 9.99",
    precioAntes: "S/ 19.98",
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
    planId: "premium",
    precio: "S/ 19.99",
    precioAntes: "S/ 39.98",
    periodo: "/mes",
    etiqueta: "Lanzamiento −50%",
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
    planId: "equipo",
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
