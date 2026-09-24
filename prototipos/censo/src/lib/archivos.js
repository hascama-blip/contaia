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

const TIPOS = { "image/jpeg": 1, "image/png": 1, "image/webp": 1, "application/pdf": 1 };

/** Sube una imagen o PDF y devuelve { id, url }. */
export async function subirArchivo(archivo) {
  const almacen = await conectarArchivos();
  if (!almacen) throw { code: "sin_archivos", message: "Tu acceso a esta página no permite subir archivos." };
  if (!TIPOS[archivo.type]) throw { code: "unsupported_type", message: "Sube una foto (JPG o PNG) o un PDF." };
  const listo = await reducirImagen(archivo);
  const tipo = listo.type || archivo.type;
  const r = await almacen.upload(listo, { type: tipo });
  return { id: r.id, url: r.url };
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
