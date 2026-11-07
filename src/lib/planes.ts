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
  /** `nuevo` = novedad del plan: se muestra resaltada con la etiqueta NUEVO. */
  incluidos: { titulo: string; puntos: string[]; nuevo?: boolean }[];
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
    resumen: "Para empezar: Reporte analítico de auditoría y Consultas tributarias.",
    cta: "Empezar gratis",
    ctaHref: "/",
    ctaEstilo: "ghost",
    incluidos: [
      {
        titulo: "Reporte Analítico de Auditoría",
        puntos: [
          "Estado del RUC en SUNAT, diagnóstico tributario con hallazgos y score de riesgo.",
          "Buzón, deudas, estado y montos SIRE, rentas e ITF, con su informe de gerencia.",
          "3 generaciones por paso y por empresa al mes. Si un paso falla, no se descuenta.",
        ],
      },
      {
        titulo: "Consultas Tributarias",
        puntos: [
          "Mensajes del buzón electrónico SUNAT con el PDF adjunto de cada notificación.",
          "Seguimiento con plazo de atención y recordatorios de vencimiento.",
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
    resumen: "Más generaciones, el Detalle SIRE y el Visor Tributario.",
    cta: "Pagar Plan Regular",
    ctaHref: "/pagar?plan=regular",
    ctaEstilo: "primary",
    incluidos: [
      {
        titulo: "Todo lo del Plan Básico",
        puntos: [
          "Reporte Analítico de Auditoría y Consultas Tributarias.",
          "5 generaciones por paso y por empresa al mes. Si un paso falla, no se descuenta.",
        ],
      },
      {
        titulo: "Reporte Detalle SIRE",
        puntos: [
          "Compras (RCE) y ventas (RVIE) por periodo, directo de la API de SUNAT.",
          "Comprobante por comprobante, con acumulado anual y descarga en Excel.",
        ],
      },
      {
        titulo: "Visor Tributario",
        puntos: [
          "Extensión del navegador: captura SIRE, DJ mensual y anual mientras navegas SUNAT.",
          "Sin bots, captcha ni bloqueo de IP; arma el cuadro año × mes.",
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
    resumen: "RTT, Descarga masiva y el seguimiento 24 h del buzón con aviso a tu celular.",
    destacado: true,
    cta: "Pagar Plan Premium",
    ctaHref: "/pagar?plan=premium",
    ctaEstilo: "accent",
    incluidos: [
      {
        titulo: "Seguimiento 24 h del buzón SUNAT",
        nuevo: true,
        puntos: [
          "Revisamos el buzón de tus empresas cada 24 horas, sin que entres a SUNAT.",
          "Si llega una notificación o un mensaje nuevo, te avisamos al instante por Telegram y por correo, con el PDF adjunto.",
        ],
      },
      {
        titulo: "Todo lo del Plan Regular",
        puntos: [
          "Reporte Analítico, Consultas Tributarias, Detalle SIRE y Visor Tributario.",
          "Generaciones sin límite por empresa.",
        ],
      },
      {
        titulo: "Reporte Tributario para Terceros (RTT)",
        puntos: [
          "Genera el RTT en SUNAT de forma automática y descarga el PDF y el XML.",
        ],
      },
      {
        titulo: "Descarga masiva de comprobantes",
        puntos: [
          "Hasta 500 comprobantes al mes: facturas XML o PDF oficial y recibos por honorarios.",
          "Excel completo con detracción, ítems y faltantes; RxH en Excel o plantilla StarSoft.",
        ],
      },
    ],
  },
  {
    nombre: "Plan Empresas",
    planId: "equipo",
    precio: "A cotizar",
    resumen: "A tu medida: módulos, usuarios y límites según lo que necesite tu empresa.",
    cta: "Solicitar cotización",
    ctaHref: "",
    ctaEstilo: "primary",
    incluidos: [
      {
        titulo: "Todo lo del Plan Premium",
        puntos: [
          "Incluye el seguimiento 24 h del buzón con aviso por Telegram y correo.",
        ],
      },
      {
        titulo: "A la medida de tu empresa",
        puntos: [
          "Usuarios para tu equipo y gestión de todas las empresas a su cargo.",
          "Generaciones y comprobantes según lo que acordemos.",
          "Atención prioritaria.",
        ],
      },
    ],
  },
];
