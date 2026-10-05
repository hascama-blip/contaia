// Configuración del C.C. — datos fijos de la institución y catálogos.
// Es el único archivo que hay que tocar para cambiar galerías, cuotas o listas.
// (Equivalente a los mapas ajustables de Radar, p. ej. REGLAS_CUENTA o MAPA_CASILLAS.)

export const INSTITUCION = {
  nombre: "C.C. “Inmaculada Concepción”",
  nombrePlano: "C.C. \"Inmaculada Concepción\"",
  ruc: "20386547565",
  ciudad: "Lima",
  logo: "img/logo.jpg",
};

// Galerías del plano real (Mapa de riesgo MR-01). Un solo piso; los stands se
// numeran 1001…1405 y cada uno trae su galería en src/plano.js.
// M, K y L son las galerías del perímetro (Jr. Ayacucho, fondo y Jr. Andahuaylas).
export const GALERIAS = [
  { id: "A", nombre: "Galería A" },
  { id: "B", nombre: "Galería B" },
  { id: "C", nombre: "Galería C" },
  { id: "D", nombre: "Galería D" },
  { id: "E", nombre: "Galería E" },
  { id: "F", nombre: "Galería F" },
  { id: "G", nombre: "Galería G" },
  { id: "H", nombre: "Galería H" },
  { id: "I", nombre: "Galería I" },
  { id: "J", nombre: "Galería J" },
  { id: "K", nombre: "Galería K" },
  { id: "L", nombre: "Galería L" },
  { id: "M", nombre: "Galería M" },
];

// Cuotas que se cobran por stand. `mensual`: todos los meses; `meses`: solo esos.
export const CONCEPTOS = [
  { id: "mantenimiento", nombre: "Mantenimiento", monto: 120, mensual: true },
  { id: "seguridad", nombre: "Seguridad", monto: 50, mensual: true },
  { id: "limpieza", nombre: "Limpieza", monto: 30, mensual: true },
  { id: "extraordinaria", nombre: "Cuota extraordinaria", monto: 100, meses: ["07"] },
];

// Desde cuándo se registran los pagos en el sistema. Las cuotas anteriores no se
// cuentan como deuda (no hay registro de ellas aquí); se pueden cargar si se tienen.
export const COBRANZA_DESDE = { anio: 2026, mes: 10 };

export const MEDIOS_PAGO = ["Yape / Plin", "Efectivo", "Depósito", "Transferencia"];

export const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Set", "Oct", "Nov", "Dic"];
export const MESES_LARGO = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre"];

export const LISTAS = {
  // Sugerencias (se puede escribir otro): las más frecuentes en el padrón.
  departamentos: ["Lima", "Ayacucho", "Apurímac", "Huancavelica", "Junín", "Cusco", "Puno", "Huánuco", "Áncash", "Arequipa", "Piura", "Cajamarca"],
  provincias: ["Lima", "Huamanga", "Cangallo", "Andahuaylas", "Tayacaja", "Huancayo", "Abancay", "Huanta", "La Mar"],
  distritos: ["San Juan de Lurigancho", "Cercado de Lima", "Rímac", "La Victoria", "Comas", "El Agustino", "Santa Anita", "Los Olivos",
    "San Martín de Porres", "Independencia", "Carabayllo", "San Juan de Miraflores", "Ate", "Villa El Salvador", "Callao"],
  instruccion: ["Sin instrucción", "Primaria", "Secundaria", "Técnico", "Superior", "Universitaria", "Maestría"],
  estadoCivil: ["Soltero(a)", "Casado(a)", "Conviviente", "Divorciado(a)", "Viudo(a)"],
  estudios: ["Ninguno", "Inicial", "Primaria", "Secundaria", "Superior técnica", "Universitaria"],
  parentescos: ["Padre", "Madre", "Hermano(a)", "Nieto(a)", "Sobrino(a)", "Otro"],
  tiposIncidencia: ["Pago tardío", "Ruido o desorden", "Uso indebido del espacio", "Altercado o agresión", "Incumplimiento de estatutos", "Otro"],
  medidas: ["Llamada de atención verbal", "Llamada de atención escrita", "Multa según estatutos", "Citación a la Junta Directiva", "Suspensión de derechos"],
};

// Regla de estatutos: cuántas llamadas de atención en 12 meses disparan la alerta.
export const LIMITE_INCIDENCIAS = 3;

// Motivos de cambio de propietario de un stand (el anterior queda en el historial).
export const MOTIVOS_TRASPASO = ["Compraventa", "Herencia (sucesión)", "Donación o anticipo de legítima", "Adjudicación judicial", "Otro"];

// Consulta de DNI (RENIEC). La hace el servidor de Radar (ruta /api/reniec),
// que guarda el token de apidni.com. `clave` = RENIEC_API_KEY de ese servidor
// (solo permite consultar DNI; el token real nunca llega a esta página).
// Déjalo en "" para desactivar el botón "Buscar en RENIEC".
export const CONSULTA_DNI = {
  url: "https://contaia.onrender.com/api/reniec",
  clave: "",
};
