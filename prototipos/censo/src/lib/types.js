// Tipos de dominio — equivalente a src/lib/types.ts de Radar.
// Aquí se define la forma de cada documento y las etiquetas de cada estado.

/**
 * @typedef {"pendiente"|"actualizado"|"verificado"|"sin_ubicar"} EstadoCenso
 * @typedef {"activo"|"inactivo"|"fallecido"|"transferido"} EstadoAsociado
 * @typedef {"propietario"|"alquilado"|"cerrado"|"litigio"} EstadoStand
 * @typedef {"leve"|"moderada"|"grave"} Gravedad
 * @typedef {"abierta"|"seguimiento"|"cerrada"} EstadoIncidencia
 * @typedef {"foto"|"huella"|"firma"|"dni"} TipoArchivo
 */

/**
 * Asociado (colección `asociados`). Sus stands NO se guardan aquí:
 * se leen de `stands` (campo propietarioId), para no tener dos verdades.
 * @typedef {Object} Asociado
 * @property {string} id
 * @property {string} numero               N° de asociado del libro de padrón
 * @property {string} nombres
 * @property {string} apellidoPaterno
 * @property {string} apellidoMaterno
 * @property {string} dni                  8 dígitos
 * @property {string} fechaNacimiento      AAAA-MM-DD
 * @property {{departamento:string, provincia:string, distrito:string}} nacimiento
 * @property {string} ocupacion
 * @property {string} instruccion
 * @property {string} estadoCivil
 * @property {string} direccion
 * @property {string} distritoResidencia
 * @property {string} celular              9 dígitos
 * @property {string} telefono
 * @property {string} correo
 * @property {string} fechaIngreso         AAAA-MM-DD
 * @property {EstadoAsociado} estado
 * @property {string} cuentaBancaria
 * @property {{nombre:string, dni:string, celular:string}|null} conyuge
 * @property {{nombre:string, edad:number|string, estudios:string}[]} hijos
 * @property {{nombre:string, parentesco:string, estudios:string}[]} familiares
 * @property {{estado:EstadoCenso, fecha:string|null, visita:string|null, por?:string}} censo
 * @property {string} observaciones        de la Junta Directiva
 * @property {Partial<Record<TipoArchivo,string>>} archivos   ids de archivos subidos
 * @property {{estatutos:boolean, datos:boolean}} compromiso  Ley N° 29733
 * @property {string} creadoAt
 * @property {string} actualizadoAt
 * @property {boolean} [ejemplo]
 */

/**
 * Stand (colección `stands`, id = código, p. ej. "A-12").
 * @typedef {Object} Stand
 * @property {string} codigo
 * @property {string} galeria              id de GALERIAS (A, B, C, S)
 * @property {number} area                 m²
 * @property {string} giro
 * @property {string|null} propietarioId
 * @property {{nombre:string, dni:string, celular:string}|null} inquilino
 * @property {EstadoStand} estado
 */

/**
 * Pagos de un stand en un año (colección `pagos`, id = "A-12_2026").
 * `registros` va por "concepto-MM" (p. ej. "mantenimiento-09").
 * @typedef {Object} PagosAnio
 * @property {string} stand
 * @property {number} anio
 * @property {Record<string, {monto:number, medio:string, operacion:string, fecha:string, por?:string}|null>} registros
 */

/**
 * Incidencia o llamada de atención (colección `incidencias`).
 * @typedef {Object} Incidencia
 * @property {string} fecha
 * @property {string} asociadoId
 * @property {string} stand
 * @property {string} involucrado         puede ser el inquilino
 * @property {string} tipo
 * @property {Gravedad} gravedad
 * @property {string} medida
 * @property {EstadoIncidencia} estado
 * @property {string} detalle
 */

/** tono = clase de badge: ok | alerta | peligro | info | neutro */
export const ESTADOS_CENSO = {
  pendiente: { label: "Pendiente", tono: "alerta" },
  actualizado: { label: "Actualizado", tono: "info" },
  verificado: { label: "Verificado", tono: "ok" },
  sin_ubicar: { label: "Sin ubicar", tono: "neutro" },
};

export const ESTADOS_ASOCIADO = {
  activo: { label: "Activo", tono: "ok" },
  inactivo: { label: "Inactivo", tono: "neutro" },
  fallecido: { label: "Fallecido", tono: "neutro" },
  transferido: { label: "Transferido", tono: "info" },
};

export const ESTADOS_STAND = {
  propietario: { label: "Ocupado por el propietario", corto: "Propietario", tono: "ok" },
  alquilado: { label: "Alquilado", corto: "Alquilado", tono: "info" },
  cerrado: { label: "Cerrado", corto: "Cerrado", tono: "neutro" },
  litigio: { label: "En litigio", corto: "En litigio", tono: "peligro" },
};

export const GRAVEDADES = {
  leve: { label: "Leve", tono: "info" },
  moderada: { label: "Moderada", tono: "alerta" },
  grave: { label: "Grave", tono: "peligro" },
};

export const ESTADOS_INCIDENCIA = {
  abierta: { label: "Abierta", tono: "alerta" },
  seguimiento: { label: "En seguimiento", tono: "info" },
  cerrada: { label: "Cerrada", tono: "neutro" },
};

/** Ficha vacía: punto de partida del formulario de alta. */
export function fichaVacia() {
  return {
    numero: "", nombres: "", apellidoPaterno: "", apellidoMaterno: "", dni: "",
    fechaNacimiento: "", nacimiento: { departamento: "", provincia: "", distrito: "" },
    ocupacion: "", instruccion: "", estadoCivil: "",
    direccion: "", distritoResidencia: "", celular: "", telefono: "", correo: "",
    fechaIngreso: "", estado: "activo", cuentaBancaria: "",
    conyuge: { nombre: "", dni: "", celular: "" },
    hijos: [], familiares: [],
    observaciones: "", archivos: {},
    compromiso: { estatutos: false, datos: false },
    // Solo en el formulario (se guardan en `stands`):
    standsTexto: "", giro: "", estadoStand: "propietario", inquilino: { nombre: "", dni: "", celular: "" },
  };
}
