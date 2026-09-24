// Servicio de documentos del asociado: subir, renombrar y quitar.
// La lista vive en la ficha (asociado.documentos); el archivo, en el almacén.
import * as db from "../lib/db.js";
import { subirArchivo, borrarArchivo } from "../lib/archivos.js";
import { nombreDesdeArchivo, nombreUnico } from "../lib/documentos.js";
import { ahoraISO } from "../lib/formato.js";
import { ErrorValidacion } from "./asociados.js";

const MAX_MB = 20;

/**
 * Sube varios archivos. Devuelve { subidos, errores } para informar archivo por archivo.
 * `actuales` es la lista vigente (la más reciente que muestra la pantalla).
 */
export async function subirDocumentos(asociadoId, archivos, actuales, { por, onAvance } = {}) {
  const lista = [...(actuales || [])];
  const errores = [];
  let subidos = 0;
  for (const [i, archivo] of [...archivos].entries()) {
    onAvance?.(i + 1, archivos.length, archivo.name);
    try {
      if (archivo.size > MAX_MB * 1024 * 1024) throw { message: `${archivo.name}: pesa más de ${MAX_MB} MB.` };
      const r = await subirArchivo(archivo, { maxLado: 2400 });
      lista.push({
        id: r.id,
        nombre: nombreUnico(nombreDesdeArchivo(archivo.name), lista),
        archivo: archivo.name,
        tipo: r.tipo,
        tamano: r.tamano,
        subidoAt: ahoraISO(),
        por: por || null,
      });
      subidos++;
    } catch (e) {
      errores.push(e?.message || `${archivo.name}: no se pudo subir.`);
    }
  }
  if (subidos) await db.actualizarAsociado(asociadoId, { documentos: lista, actualizadoAt: ahoraISO() });
  return { subidos, errores };
}

export async function renombrarDocumento(asociadoId, actuales, docId, nombre) {
  const limpio = String(nombre || "").replace(/\s+/g, " ").trim();
  if (!limpio) throw new ErrorValidacion({ nombre: "El nombre no puede quedar vacío." });
  const otros = actuales.filter((d) => d.id !== docId);
  if (otros.some((d) => d.nombre.toLowerCase() === limpio.toLowerCase())) {
    throw new ErrorValidacion({ nombre: `Ya hay un documento llamado "${limpio}".` });
  }
  await db.actualizarAsociado(asociadoId, { documentos: actuales.map((d) => (d.id === docId ? { ...d, nombre: limpio } : d)) });
}

/** Quita el documento de la ficha y borra el archivo del almacén. */
export async function quitarDocumento(asociadoId, actuales, docId) {
  await db.actualizarAsociado(asociadoId, { documentos: actuales.filter((d) => d.id !== docId), actualizadoAt: ahoraISO() });
  try {
    await borrarArchivo(docId);
  } catch {
    // La ficha ya no lo lista; si el borrado falla, el archivo queda huérfano y no se muestra.
  }
}
