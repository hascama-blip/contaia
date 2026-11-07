import { unzipSync } from "fflate";

// Topes para archivos ZIP subidos: se revisa el tamaño DECLARADO de cada archivo
// antes de descomprimirlo (fflate reserva exactamente ese tamaño y falla si el
// contenido real es mayor). Evita que un ZIP pequeño "explote" a varios GB y
// deje sin memoria al servidor.
const ZIP_MAX_ENTRADAS = 5000;
const ZIP_MAX_ARCHIVO = 50 * 1024 * 1024;   // 50 MB por archivo
const ZIP_MAX_TOTAL = 200 * 1024 * 1024;    // 200 MB en total

/** Descomprime un ZIP respetando los topes. Lanza error si los supera. */
export function descomprimirSeguro(buf: Uint8Array | Buffer): Record<string, Uint8Array> {
  let total = 0;
  let n = 0;
  return unzipSync(new Uint8Array(buf), {
    filter: (f) => {
      n++;
      if (n > ZIP_MAX_ENTRADAS) throw new Error("El ZIP tiene demasiados archivos.");
      if (f.originalSize > ZIP_MAX_ARCHIVO) throw new Error(`El archivo ${f.name} del ZIP es demasiado grande.`);
      total += f.originalSize;
      if (total > ZIP_MAX_TOTAL) throw new Error("El contenido del ZIP es demasiado grande.");
      return true;
    },
  });
}

/** Lista los nombres del ZIP SIN descomprimir nada. */
function nombresZip(buf: Uint8Array | Buffer): string[] {
  const nombres: string[] = [];
  unzipSync(new Uint8Array(buf), { filter: (f) => { if (nombres.length < ZIP_MAX_ENTRADAS) nombres.push(f.name); return false; } });
  return nombres;
}

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
    const files = nombresZip(buf).map((k) => k.toLowerCase());
    if (files.some((f) => f === "[content_types].xml" || f.startsWith("xl/") || f.startsWith("word/"))) {
      return false;
    }
  } catch {
    return false;
  }
  return true;
}

/**
 * Extrae TODOS los archivos de un ZIP (cualquier extensión, incluye subcarpetas).
 * Ignora basura de macOS y carpetas. Útil cuando el ZIP de SUNAT trae el XML sin
 * una extensión esperada o junto a otros documentos.
 */
export function extraerTodo(buf: Buffer): { name: string; data: Buffer }[] {
  let files: Record<string, Uint8Array>;
  try {
    files = descomprimirSeguro(buf);
  } catch {
    return [];
  }
  const out: { name: string; data: Buffer }[] = [];
  for (const [name, data] of Object.entries(files)) {
    const lower = name.toLowerCase();
    if (lower.includes("__macosx") || lower.endsWith("/")) continue;
    out.push({ name: name.split("/").pop() || name, data: Buffer.from(data) });
  }
  return out;
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
    files = descomprimirSeguro(buf);
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
