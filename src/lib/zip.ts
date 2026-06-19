import { unzipSync } from "fflate";

// Utilidades para aceptar archivos ZIP de SUNAT (que adentro traen los Excel
// del SIRE o los XML de los comprobantes, a veces en subcarpetas).

/** ¿El buffer es un ZIP? (empieza con "PK"). */
export function esZip(buf: Buffer): boolean {
  return buf.length > 1 && buf[0] === 0x50 && buf[1] === 0x4b;
}

/**
 * ¿Es un ZIP "contenedor" de SUNAT (trae adentro Excel/XML) y NO un documento
 * de Office? OJO: un .xlsx/.docx también empieza con "PK" (son ZIP), así que
 * hay que descartarlos. Decide por el NOMBRE del archivo y, si no hay pista,
 * por el contenido (un Office trae "[Content_Types].xml").
 */
export function esZipContenedor(buf: Buffer, nombre?: string): boolean {
  if (!esZip(buf)) return false;
  const n = (nombre || "").toLowerCase();
  if (n.endsWith(".xlsx") || n.endsWith(".xls") || n.endsWith(".xml")) return false;
  if (n.endsWith(".zip")) return true;
  // Sin pista por el nombre: mira adentro. Si parece Office (Content_Types,
  // carpeta xl/ o word/), no es un contenedor.
  try {
    const files = Object.keys(unzipSync(new Uint8Array(buf))).map((k) => k.toLowerCase());
    if (files.some((f) => f === "[content_types].xml" || f.startsWith("xl/") || f.startsWith("word/"))) {
      return false;
    }
  } catch {
    return false;
  }
  return true;
}

/**
 * Extrae de un ZIP los archivos cuya extensión esté en `exts` (recursivo:
 * incluye subcarpetas). Ignora basura de macOS (__MACOSX).
 */
export function extraerDeZip(
  buf: Buffer,
  exts: string[]
): { name: string; data: Buffer }[] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(buf));
  } catch {
    return [];
  }
  const out: { name: string; data: Buffer }[] = [];
  for (const [name, data] of Object.entries(files)) {
    const lower = name.toLowerCase();
    if (lower.includes("__macosx") || lower.endsWith("/")) continue;
    if (exts.some((e) => lower.endsWith(e))) {
      out.push({ name: name.split("/").pop() || name, data: Buffer.from(data) });
    }
  }
  return out;
}
