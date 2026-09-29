// Configuración del C.C. — datos fijos de la institución y catálogos.
// Es el único archivo que hay que tocar para cambiar galerías, cuotas o listas.
// (Equivalente a los mapas ajustables de Radar, p. ej. REGLAS_CUENTA o MAPA_CASILLAS.)

export const INSTITUCION = {
  nombre: "C.C. “Inmaculada Concepción”",
  nombrePlano: "C.C. \"Inmaculada Concepción\"",
  ruc: "20386547565",
  ciudad: "Huancayo",
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

export const MEDIOS_PAGO = ["Yape / Plin", "Efectivo", "Depósito", "Transferencia"];

export const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Set", "Oct", "Nov", "Dic"];
export const MESES_LARGO = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre"];

export const LISTAS = {
  departamentos: ["Junín", "Lima", "Huancavelica", "Ayacucho", "Pasco", "Cusco", "Otro"],
  provincias: ["Huancayo", "Chupaca", "Concepción", "Jauja", "Tarma", "Satipo", "Otra"],
  distritos: ["Huancayo", "El Tambo", "Chilca", "Pilcomayo", "Sapallanga", "Huancán", "Otro"],
  instruccion: ["Primaria", "Secundaria incompleta", "Secundaria completa", "Superior técnica", "Universitaria"],
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
