import { unzipSync } from "fflate";

// Utilidades para aceptar archivos ZIP de SUNAT (que adentro traen los Excel
// del SIRE o los XML de los comprobantes, a veces en subcarpetas).

/** ¿El buffer es un ZIP? (empieza con "PK"). */
export function esZip(buf: Buffer): boolean {
  return buf.length > 1 && buf[0] === 0x50 && buf[1] === 0x4b;
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
