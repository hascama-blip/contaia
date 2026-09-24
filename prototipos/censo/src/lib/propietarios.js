// Historial de propietarios de cada stand. Regla: un dueño anterior NUNCA se
// borra; al vender, pasa a `stand.historial` con su tramo (desde–hasta) y el
// nuevo queda en `propietarioId` desde la fecha de la venta.
import { nombreCompleto, compararCodigos } from "./padron.js";

/**
 * Tramo de un propietario anterior (se guarda en stand.historial).
 * Guarda nombre y DNI tal como estaban, por si luego la ficha cambia.
 * @typedef {Object} TramoPropietario
 * @property {string|null} asociadoId
 * @property {string} nombre
 * @property {string} dni
 * @property {string|null} desde           AAAA-MM-DD (null si no se sabe)
 * @property {string} hasta                fecha de la venta o traspaso
 * @property {string} motivo               Compraventa, Herencia…
 * @property {string} [documento]          minuta, escritura, partida…
 * @property {string} [observacion]
 * @property {string|null} [por]           usuario que lo registró
 * @property {string} registradoAt
 */

/** Tramo cerrado del dueño que sale. */
export function tramoDeSalida(stand, anterior, { hasta, motivo, documento, observacion, por, ahora }) {
  return {
    asociadoId: anterior?.id || stand.propietarioId || null,
    nombre: anterior ? nombreCompleto(anterior) : "Sin ficha",
    dni: anterior?.dni || "",
    desde: stand.propietarioDesde || anterior?.fechaIngreso || null,
    hasta,
    motivo,
    documento: documento || "",
    observacion: observacion || "",
    por: por || null,
    registradoAt: ahora,
  };
}

/**
 * Todos los propietarios del stand en orden: 1.º, 2.º… y el actual al final.
 * @returns {{orden:number, asociadoId:string|null, nombre:string, dni:string, desde:string|null, hasta:string|null, motivo?:string, documento?:string, actual:boolean, asociado?:object}[]}
 */
export function cadenaPropietarios(stand, porId) {
  const pasados = (stand?.historial || []).map((t) => ({ ...t, actual: false, asociado: porId.get(t.asociadoId) }));
  const dueno = stand?.propietarioId ? porId.get(stand.propietarioId) : null;
  const lista = [...pasados];
  if (stand?.propietarioId) {
    lista.push({
      asociadoId: stand.propietarioId,
      nombre: dueno ? nombreCompleto(dueno) : "Sin ficha",
      dni: dueno?.dni || "",
      desde: stand.propietarioDesde || dueno?.fechaIngreso || null,
      hasta: null,
      actual: true,
      asociado: dueno,
    });
  }
  return lista.map((t, i) => ({ ...t, orden: i + 1 }));
}

/** Stands que un asociado tuvo y ya no tiene: [{ stand, tramo, siguiente }]. */
export function standsAnteriores(asociadoId, stands, porId) {
  const res = [];
  for (const s of stands) {
    const cadena = cadenaPropietarios(s, porId);
    cadena.forEach((t, i) => {
      if (!t.actual && t.asociadoId === asociadoId) res.push({ stand: s, tramo: t, siguiente: cadena[i + 1] || null });
    });
  }
  return res.sort((a, b) => compararCodigos(a.stand.codigo, b.stand.codigo));
}

/** Mapa asociadoId → códigos de stands que vendió o traspasó. */
export function anterioresPorAsociado(stands) {
  const mapa = new Map();
  for (const s of stands) {
    for (const t of s.historial || []) {
      if (!t.asociadoId) continue;
      if (!mapa.has(t.asociadoId)) mapa.set(t.asociadoId, []);
      if (!mapa.get(t.asociadoId).includes(s.codigo)) mapa.get(t.asociadoId).push(s.codigo);
    }
  }
  return mapa;
}

/** "1.º", "2.º"… */
export function ordinal(n) {
  return `${n}.º`;
}
