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
  /** Fecha de inscripción en el RUC (tal como la entrega SUNAT). */
  fechaInscripcion?: string;
  /** Fecha de inicio de actividades. */
  fechaInicioActividades?: string;
  /** Regímenes / afectaciones tributarias declaradas. */
  tributos: string[];
  /** Indica si emite comprobantes electrónicos. */
  comprobanteElectronico: boolean;
  /** Representantes legales (nombre completo + documento). */
  representantes?: RepresentanteLegal[];
  /** Fuente de los datos: "oficial" (API SUNAT SOL), "externo" (apis.net.pe) o "simulado". */
  fuente: "oficial" | "externo" | "simulado";
  consultadoAt: string;
}

/** Representante legal de un contribuyente (de SUNAT vía decolecta). */
export interface RepresentanteLegal {
  /** Tipo de documento: "DNI", "C.E.", etc. */
  tipoDoc?: string;
  /** Número de documento (DNI / C.E.). */
  numeroDoc: string;
  /** Nombre completo (apellidos y nombres) tal como lo entrega SUNAT. */
  nombre: string;
  /** Cargo: "GERENTE GENERAL", "APODERADO", etc. */
  cargo?: string;
  /** Fecha desde la que ejerce el cargo. */
  desde?: string;
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

/** Usuario que inicia sesión. La contraseña se guarda solo como hash (scrypt). */
export interface Usuario {
  id: string;
  nombre: string;
  email: string;
  passHash: string;
  createdAt: string;
  /** Rol: "supremo" (dueño de la plataforma), "admin" (dueño de un estudio)
   *  u "operador" (sub-usuario limitado). */
  rol?: "supremo" | "admin" | "operador";
  /** Id del admin del estudio al que pertenece (vacío = es admin/dueño). */
  parentId?: string;
  /** Estado de acceso de un estudio (admin): pendiente de aprobación del
   *  supremo, aprobado o rechazado. undefined = cuenta antigua (aprobada). */
  estado?: "pendiente" | "aprobado" | "rechazado";
  /** Fecha en que el supremo decidió (aprobó/rechazó). */
  decididoAt?: string;
  /** Módulos de paga desbloqueados por el supremo (keys: "m2","m3","m4"). */
  modulos?: string[];
  /** Recuperación de contraseña: hash del token + expiración (un solo uso). */
  resetTokenHash?: string;
  resetTokenExp?: string;
  /** Cupo del módulo gratis: 3 consultas por ventana de 7 días. */
  usosGratis?: { usados: number; desde: string };
}

export interface Cliente {
  id: string;
  /** Dueño (usuario) de esta empresa: cada usuario ve solo lo suyo. */
  ownerId?: string;
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
  /** Estado de presentación SIRE guardado (presentado/no presentado por periodo). */
  sireEstado?: { estados: { periodo: string; presentadoVentas: boolean | null; presentadoCompras: boolean | null }[]; at: string } | null;
  /** Caché de PDFs descargados del buzón, por codMensaje (para no re-bajarlos). */
  buzonAdjuntos?: Record<string, AdjuntoCache>;
  /** Declaraciones mensuales (PDF) para comparar contra el SIRE. */
  declaraciones: DeclaracionMensual[];
  /** Declaraciones juradas ANUALES (Formulario 710) para comparar año vs año. */
  declaracionesAnuales: DeclaracionAnual[];
  /** Deudas tributarias (de fotos con OCR o ingresadas a mano). */
  deudas: Deuda[];
  /** Deudas del F36 (fraccionamiento Art. 36) extraídas del portal SOL. */
  deudasF36?: {
    tablas: DeudaF36Tabla[];
    /** Fecha de la última extracción (las 5 pestañas). */
    at?: string;
    generadoAt?: string;
    nota?: string;
    /** Trazabilidad del pedido de deuda (proceso asíncrono de SUNAT). */
    numPedido?: string;
    fechaPedido?: string;
    estado?: "sin-pedido" | "en-proceso" | "listo" | "extraido" | "vencido";
    estadoTexto?: string;
    accion?: string;
    verificadoAt?: string;
  } | null;
  /** Credenciales de la API SIRE guardadas (la Clave SOL NO se guarda). */
  credSire?: CredencialesSire | null;
  /** Seguimientos de mensajes del buzón (plazo de atención + comentario). */
  seguimientosBuzon?: SeguimientoBuzon[];
}

/** Credenciales SIRE persistidas (sin la Clave SOL, que es efímera). */
export interface CredencialesSire {
  solUser: string;
  clientId: string;
  clientSecret: string;
  guardadoAt: string;
}

/** Cuenta contable aprendida/sugerida para un proveedor (memoria del estudio). */
export interface ProveedorCuenta {
  ruc: string;
  razonSocial?: string;
  /** Rubro / actividad económica (de decolecta). */
  rubro?: string;
  cuenta: string;
  nombreCuenta?: string;
  /** "aprendido" = confirmado por el operario; "sugerido" = automático. */
  fuente: "aprendido" | "sugerido";
  actualizadoAt: string;
}

/** Deuda tributaria detectada/indicada (foto con OCR o ingreso manual). */
export interface Deuda {
  id: string;
  /** Tipo / concepto: "Renta - Regulariz. Pers. Jur.", "Multa", etc. */
  tipo: string;
  /** Sección del F36: Valores, Autoliquidadas, Otras deudas, No acogibles. */
  seccion?: string;
  /** Código de tributo (p. ej. 3081, 3121). */
  codigoTributo?: string;
  /** N° de valor / orden / documento. */
  numero?: string;
  descripcion: string;
  monto: number;
  /** Periodo libre, p. ej. "03/2024" o "2023". */
  periodo?: string;
  /** Entidad acreedora (SUNAT, EsSalud…). */
  entidad?: string;
  fuente: "ocr" | "manual";
  /** Texto crudo del OCR (para referencia). */
  ocrTexto?: string;
  creadoAt: string;
}

/**
 * Declaración Jurada ANUAL (Formulario 710 Renta Anual 3ra categoría) leída de
 * un PDF. Guarda los montos por casilla del Balance (Estados Financieros) y del
 * Estado de Resultados para comparar un ejercicio contra otro.
 */
export interface DeclaracionAnual {
  id: string;
  /** Ejercicio fiscal "YYYY" detectado del PDF. */
  ejercicio: string;
  ruc?: string;
  razonSocial?: string;
  formulario?: string;
  /** Monto por casilla detectada (código de 3 dígitos → monto). */
  valores: Record<string, number>;
  fuente: "pdf" | "manual";
  archivoNombre?: string;
  cargadoAt: string;
}

/** Una casilla (código → monto) detectada en la declaración. */
export interface CasillaDeclaracion {
  codigo: string;
  etiqueta?: string;
  monto: number;
}

/** Un concepto de compras del 621 (cada destino), con su base e IGV. */
export interface ConceptoCompra {
  codigo: string;
  etiqueta: string;
  base: number;
  igv: number;
}

/**
 * Declaración mensual (Formulario Virtual 621 IGV-Renta u otra) leída de un
 * PDF con capa de texto (sin OCR) o ingresada manualmente. Sirve para comparar
 * lo DECLARADO contra lo registrado en el SIRE del mismo periodo.
 */
export interface DeclaracionMensual {
  id: string;
  /** Periodo tributario "YYYYMM". */
  periodo: string;
  ruc?: string;
  /** Nº de formulario detectado (p.ej. "621"). */
  formulario?: string;
  /** Montos declarados (editables/confirmados por el contador). */
  ventasBase: number;
  ventasIgv: number;
  /** Desglose de ventas por concepto (no neteado): cada tipo con su monto. */
  ventasDetalle?: ConceptoCompra[];
  comprasBase: number;
  comprasIgv: number;
  /** Desglose de compras por concepto (no neteado): cada destino con su monto. */
  comprasDetalle?: ConceptoCompra[];
  /** Todas las casillas detectadas en el PDF (para calibrar/auditar). */
  casillas: CasillaDeclaracion[];
  /** "pdf" = leída de un archivo; "manual" = ingresada a mano. */
  fuente: "pdf" | "manual";
  archivoNombre?: string;
  cargadoAt: string;
  /** Marca este periodo como NO presentado (sale así en el informe). */
  noPresento?: boolean;
}

/** Una fila del comparativo declaración vs SIRE. */
export interface ComparativoFila {
  concepto: string;
  declarado: number;
  sire: number;
  /** declarado − sire. */
  diferencia: number;
  /** Diferencia relativa al SIRE, en % (0 si no hay base). */
  porcentaje: number;
  estado: "ok" | "alerta" | "sin-sire";
}

/** Comparativo de un periodo: declaración vs SIRE. */
export interface ComparativoPeriodo {
  periodo: string;
  filas: ComparativoFila[];
  hayDiferencias: boolean;
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
  /** "peligroso" (fiscalización/no contenciosas), "urgente" (cobranza/valores), "otro". */
  nivel: "peligroso" | "urgente" | "otro";
  urgente: boolean;
  leido: boolean;
  /** Módulo del buzón: "notificaciones" (tipoMsj=2) o "mensajes" (tipoMsj=1). */
  origen?: "notificaciones" | "mensajes";
  /** Cantidad de archivos adjuntos (cantidadArchAdj). 0 = solo texto. */
  adjuntos?: number;
}

export interface BuzonResultado {
  mensajes: BuzonMensaje[];
  /** Fiscalización y no contenciosas (lo más peligroso). */
  peligrosos: BuzonMensaje[];
  /** Cobranza y valores. */
  urgentes: BuzonMensaje[];
  diag?: { pasos: any[] };
  /** SUNAT rechazó el login (clave/usuario incorrecto): NO se debe consumir uso. */
  loginError?: boolean;
  error?: string;
}

/** Una pestaña de deudas del F36 (Valores, Otras Deudas, etc.). */
export interface DeudaF36Tabla {
  pestana: string;
  headers: string[];
  filas: string[][];
}

/** PDF del buzón ya descargado y guardado (caché). */
export interface AdjuntoCache {
  /** Nombre del archivo guardado en uploads. */
  archivo: string;
  /** Nombre para descargar (sugerido por SUNAT). */
  nombre: string;
  /** Fecha en que se trajo el PDF de SUNAT por primera vez. */
  at: string;
  size: number;
  /** Última vez que ALGUIEN descargó/abrió este PDF (incluye desde caché). */
  descargadaAt?: string;
  /** Quién hizo la última descarga (para el estudio principal). */
  descargadoPorId?: string;
  descargadoPorNombre?: string;
}

/** Entrada de la bitácora de auditoría: quién hizo qué, cuándo y dónde.
 *  La ve el usuario líder (admin) del estudio. */
export interface AccionAuditoria {
  id: string;
  /** Fecha/hora de la acción (ISO). */
  at: string;
  /** Estudio (admin dueño) al que pertenece la acción. */
  studioId: string;
  usuarioId: string;
  usuarioNombre: string;
  rol?: "admin" | "operador";
  /** Sección donde ocurrió (Buzón, Fraccionamiento, Cliente, Credenciales…). */
  area: string;
  /** Qué hizo (verbo + objeto), legible. */
  accion: string;
  /** Empresa afectada (si aplica). */
  clienteId?: string;
  clienteNombre?: string;
  /** Texto libre opcional con más contexto. */
  detalle?: string;
}

/** Seguimiento de un mensaje del buzón: plazo de atención + comentario. */
export interface SeguimientoBuzon {
  codMensaje: string;
  asunto: string;
  /** Fecha del mensaje (para mostrar en el recordatorio). */
  fecha: string;
  origen?: "notificaciones" | "mensajes";
  /** Plazo de atención en días (5, 10 o 15). */
  diasAtencion: number;
  comentario: string;
  creadoAt: string;
  /** creadoAt + diasAtencion (cuando vence, se recuerda). */
  fechaLimite: string;
  /** Si ya se atendió (quita el recordatorio). */
  atendido?: boolean;
  /** Quién lo puso (para que el admin identifique al autor). */
  creadoPorId?: string;
  creadoPorNombre?: string;
}

/** Buzón persistido en el cliente (para el informe). */
export interface BuzonResumen {
  peligrosos: BuzonMensaje[];
  urgentes: BuzonMensaje[];
  /** Todas las notificaciones del periodo consultado (para el reporte PDF). */
  mensajes?: BuzonMensaje[];
  totalMensajes: number;
  consultadoAt: string;
}

/** Resumen mensual SIRE: cuánto compró y vendió en el periodo. */
export interface SireResumen {
  /** Periodo tributario "YYYYMM". */
  periodo: string;
  ventas: SireBloque;
  compras: SireBloque;
  /** Si el registro del periodo fue presentado/generado en SUNAT. */
  presentadoVentas: boolean;
  presentadoCompras: boolean;
  /** Origen: "oficial" (API SIRE de SUNAT) o "simulado". */
  fuente: "oficial" | "simulado";
  consultadoAt: string;
}
