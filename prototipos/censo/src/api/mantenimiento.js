// Mantenimiento: vaciar los datos de ejemplo antes de cargar el padrón real.
import * as db from "../lib/db.js";

export function contarEjemplos(datos) {
  return db.COLECCIONES.reduce((n, col) => n + (datos[col] || []).filter((d) => d.ejemplo).length, 0);
}

/** Borra uno a uno los documentos marcados como ejemplo. onAvance(hechos, total). */
export async function vaciarEjemplos(datos, onAvance) {
  const lista = db.COLECCIONES.flatMap((col) => (datos[col] || []).filter((d) => d.ejemplo).map((d) => [col, d.id]));
  let hechos = 0;
  for (const [col, id] of lista) {
    await db.borrarDocumento(col, id);
    hechos++;
    onAvance?.(hechos, lista.length);
  }
  return hechos;
}
