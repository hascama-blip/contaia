// Archivos del asociado (foto carné, huella, firma, DNI): se guardan en el
// almacén del artifact y en la ficha solo queda su id.

let conexion = null;

export function conectarArchivos() {
  if (!conexion) {
    conexion = window.claude?.use ? window.claude.use("assets") : Promise.resolve(null);
  }
  return conexion;
}

export function urlArchivo(id) {
  return id ? `/_blob/${id}` : null;
}

/** Reduce fotos grandes del celular (máx. 1400 px) antes de subirlas. */
async function reducirImagen(archivo, max = 1400) {
  if (!/^image\/(jpeg|png|webp)$/.test(archivo.type) || typeof createImageBitmap !== "function") return archivo;
  try {
    const bmp = await createImageBitmap(archivo);
    const escala = Math.min(1, max / Math.max(bmp.width, bmp.height));
    if (escala === 1 && archivo.size < 1_500_000) return archivo;
    const lienzo = document.createElement("canvas");
    lienzo.width = Math.round(bmp.width * escala);
    lienzo.height = Math.round(bmp.height * escala);
    lienzo.getContext("2d").drawImage(bmp, 0, 0, lienzo.width, lienzo.height);
    const blob = await new Promise((ok) => lienzo.toBlob(ok, "image/jpeg", 0.86));
    return blob || archivo;
  } catch {
    return archivo;
  }
}

// Tipos que acepta el almacén, por extensión (el navegador a veces no informa el tipo).
const POR_EXTENSION = {
  pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif",
  txt: "text/plain", csv: "text/csv", md: "text/markdown", json: "application/json",
};

export function tipoDeArchivo(archivo) {
  const ext = String(archivo.name || "").split(".").pop().toLowerCase();
  return POR_EXTENSION[ext] || (Object.values(POR_EXTENSION).includes(archivo.type) ? archivo.type : null);
}

/**
 * Sube un archivo y devuelve { id, url, tipo, tamano }.
 * @param {File|Blob} archivo
 * @param {{ maxLado?: number }} [op]  fotos: lado mayor en px (las del celular pesan mucho)
 */
export async function subirArchivo(archivo, { maxLado = 1400 } = {}) {
  const almacen = await conectarArchivos();
  if (!almacen) throw { code: "sin_archivos", message: "Tu acceso a esta página no permite subir archivos." };
  const tipo = tipoDeArchivo(archivo);
  if (!tipo) {
    throw {
      code: "unsupported_type",
      message: /\.(docx?|xlsx?|pptx?)$/i.test(archivo.name || "")
        ? `${archivo.name}: Word, Excel y PowerPoint no se pueden guardar aquí. Guárdalo como PDF y súbelo.`
        : `${archivo.name || "El archivo"}: sube un PDF, una foto (JPG o PNG) o un texto.`,
    };
  }
  const listo = tipo.startsWith("image/") && tipo !== "image/gif" ? await reducirImagen(archivo, maxLado) : archivo;
  const r = await almacen.upload(listo, { type: listo.type && listo !== archivo ? listo.type : tipo });
  return { id: r.id, url: r.url, tipo: r.contentType || tipo, tamano: r.sizeBytes ?? listo.size };
}

/** Borra un archivo del almacén (irreversible; solo por acción del usuario). */
export async function borrarArchivo(id) {
  const almacen = await conectarArchivos();
  if (!almacen) throw { code: "sin_archivos", message: "Tu acceso a esta página no permite borrar archivos." };
  await almacen.delete(id);
}

/** Lee un archivo subido como Blob (para descargarlo). */
export async function archivoComoBlob(id) {
  const r = await fetch(urlArchivo(id));
  if (!r.ok) throw new Error("No se pudo leer el archivo.");
  return r.blob();
}

/** Lee un archivo subido como data URL (para ponerlo en el PDF). */
export async function archivoComoDataURL(id) {
  const r = await fetch(urlArchivo(id));
  if (!r.ok) throw new Error("No se pudo leer el archivo.");
  const blob = await r.blob();
  return await new Promise((ok, mal) => {
    const fr = new FileReader();
    fr.onload = () => ok(fr.result);
    fr.onerror = mal;
    fr.readAsDataURL(blob);
  });
}
