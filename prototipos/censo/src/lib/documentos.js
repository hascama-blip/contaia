// Documentos del asociado: nombre a partir del archivo, tipo y orden (funciones puras).

/**
 * @typedef {Object} Documento
 * @property {string} id         id del archivo en el almacén
 * @property {string} nombre     nombre visible (sale del nombre del archivo; se puede cambiar)
 * @property {string} archivo    nombre original del archivo
 * @property {string} tipo       application/pdf, image/jpeg…
 * @property {number} tamano     bytes
 * @property {string} subidoAt   ISO
 * @property {string|null} [por] id de quien lo subió
 */

/** "Contrato_compraventa-A-12 (2).pdf" → "Contrato compraventa A-12 (2)" */
export function nombreDesdeArchivo(archivo) {
  const base = String(archivo || "").replace(/\.[^.]+$/, "");
  const limpio = base
    .replace(/[_]+/g, " ")
    .replace(/\s-\s|(?<=[a-záéíóúñ])-(?=[a-záéíóúñ])/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!limpio) return "Documento";
  return limpio.charAt(0).toUpperCase() + limpio.slice(1);
}

export function extension(archivo) {
  const m = /\.([a-z0-9]+)$/i.exec(String(archivo || ""));
  return m ? m[1].toUpperCase() : "";
}

export function esImagen(doc) {
  return String(doc.tipo || "").startsWith("image/");
}

export function etiquetaTipo(doc) {
  if (doc.tipo === "application/pdf") return "PDF";
  if (esImagen(doc)) return "Imagen";
  return extension(doc.archivo) || "Archivo";
}

export function tamanoLegible(bytes) {
  if (!bytes && bytes !== 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Orden alfabético por nombre visible (como un archivador). */
export function ordenarDocumentos(docs) {
  return [...(docs || [])].sort((a, b) => a.nombre.localeCompare(b.nombre, "es", { numeric: true, sensitivity: "base" }));
}

/** Si ya existe un documento con ese nombre, agrega (2), (3)… */
export function nombreUnico(nombre, existentes) {
  const usados = new Set(existentes.map((d) => d.nombre.toLowerCase()));
  if (!usados.has(nombre.toLowerCase())) return nombre;
  let n = 2;
  while (usados.has(`${nombre} (${n})`.toLowerCase())) n++;
  return `${nombre} (${n})`;
}
