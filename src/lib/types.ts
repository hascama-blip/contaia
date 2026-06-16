// Tipos de dominio compartidos por la app ContaIA.

export type NivelRiesgo = "bajo" | "medio" | "alto" | "critico";

export interface SunatInfo {
  ruc: string;
  razonSocial: string;
  /** Estado del contribuyente: ACTIVO, BAJA DE OFICIO, etc. */
  estado: string;
  /** Condición de domicilio: HABIDO, NO HABIDO, NO HALLADO. */
  condicion: string;
  tipoContribuyente: string;
  direccion: string;
  /** Regímenes / afectaciones tributarias declaradas. */
  tributos: string[];
  /** Indica si emite comprobantes electrónicos. */
  comprobanteElectronico: boolean;
  /** Fuente de los datos: "oficial" (API SUNAT SOL), "externo" (apis.net.pe) o "simulado". */
  fuente: "oficial" | "externo" | "simulado";
  consultadoAt: string;
}

export interface ExtraccionDocumento {
  /** RUC detectado en el documento, si aplica. */
  ruc?: string;
  /** Montos numéricos detectados (S/). */
  montos: number[];
  /** Posibles deudas / saldos detectados. */
  deudas: number[];
  /** Fechas detectadas (texto). */
  fechas: string[];
  /** Palabras clave tributarias encontradas. */
  palabrasClave: string[];
}

export interface Documento {
  id: string;
  clienteId: string;
  originalName: string;
  storedName: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
  /** Texto crudo extraído por OCR. */
  ocrText: string;
  /** Estado del procesamiento OCR. */
  ocrStatus: "pendiente" | "procesado" | "error";
  extraccion: ExtraccionDocumento;
}

export interface Hallazgo {
  tipo: "sunat" | "documento" | "consistencia";
  severidad: NivelRiesgo;
  titulo: string;
  detalle: string;
}

export interface Diagnostico {
  /** Puntaje 0-100, mayor = mejor salud tributaria. */
  score: number;
  nivelRiesgo: NivelRiesgo;
  hallazgos: Hallazgo[];
  recomendaciones: string[];
  generatedAt: string;
}

export interface Cliente {
  id: string;
  razonSocial: string;
  ruc: string;
  email: string;
  telefono: string;
  createdAt: string;
  sunat: SunatInfo | null;
  documentos: Documento[];
  diagnostico: Diagnostico | null;
  /** Resúmenes SIRE (compras/ventas) por periodo. Las credenciales NO se guardan. */
  sire: SireResumen[];
  /** Buzón electrónico (urgentes) del mes en curso. */
  buzon: BuzonResumen | null;
}

/** Totales de un bloque del SIRE (ventas o compras) en un periodo. */
export interface SireBloque {
  comprobantes: number;
  baseImponible: number;
  igv: number;
  inafectoExonerado: number;
  importeTotal: number;
}

/** Mensaje del buzón electrónico SUNAT. */
export interface BuzonMensaje {
  id: string;
  fecha: string;
  asunto: string;
  tipo: string;
  /** true si es resolución de cobranza / valor (urgente). */
  urgente: boolean;
  leido: boolean;
}

export interface BuzonResultado {
  mensajes: BuzonMensaje[];
  urgentes: BuzonMensaje[];
  diag?: { pasos: any[] };
}

/** Buzón persistido en el cliente (para el informe). */
export interface BuzonResumen {
  urgentes: BuzonMensaje[];
  totalMensajes: number;
  consultadoAt: string;
}

/** Resumen mensual SIRE: cuánto compró y vendió en el periodo. */
export interface SireResumen {
  /** Periodo tributario "YYYYMM". */
  periodo: string;
  ventas: SireBloque;
  compras: SireBloque;
  /** Origen: "oficial" (API SIRE de SUNAT) o "simulado". */
  fuente: "oficial" | "simulado";
  consultadoAt: string;
}
