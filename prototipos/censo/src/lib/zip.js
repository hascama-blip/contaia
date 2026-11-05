// Escritor de ZIP en el navegador, sin dependencias (método "stored": los PDF ya vienen comprimidos).
// Nombres en UTF-8 (marca 0x800), CRC-32 y directorio central estándar: lo abre cualquier programa.

const TABLA_CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(bytes) { let c = 0xffffffff; for (let i = 0; i < bytes.length; i++) c = TABLA_CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

/** Fecha y hora en formato DOS (lo que guarda el ZIP). */
function fechaDos(d = new Date()) {
  const hora = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() >> 1) & 31);
  const fecha = (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);
  return { hora, fecha };
}

/**
 * Arma un ZIP con las entradas dadas.
 * @param {{ nombre: string, datos: Uint8Array|ArrayBuffer|Blob }[]} entradas
 * @returns {Promise<Blob>}
 */
export async function crearZip(entradas) {
  const codificador = new TextEncoder();
  const locales = [], centrales = [];
  let desplazamiento = 0;
  const { hora, fecha } = fechaDos();
  for (const e of entradas) {
    const datos = e.datos instanceof Blob ? new Uint8Array(await e.datos.arrayBuffer()) : e.datos instanceof ArrayBuffer ? new Uint8Array(e.datos) : e.datos;
    const nombre = codificador.encode(String(e.nombre).replace(/\\/g, "/"));
    const crc = crc32(datos);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x800, true); local.setUint16(8, 0, true);
    local.setUint16(10, hora, true); local.setUint16(12, fecha, true); local.setUint32(14, crc, true);
    local.setUint32(18, datos.length, true); local.setUint32(22, datos.length, true); local.setUint16(26, nombre.length, true); local.setUint16(28, 0, true);
    locales.push(new Uint8Array(local.buffer), nombre, datos);
    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true); central.setUint16(4, 20, true); central.setUint16(6, 20, true); central.setUint16(8, 0x800, true); central.setUint16(10, 0, true);
    central.setUint16(12, hora, true); central.setUint16(14, fecha, true); central.setUint32(16, crc, true);
    central.setUint32(20, datos.length, true); central.setUint32(24, datos.length, true); central.setUint16(28, nombre.length, true);
    central.setUint16(30, 0, true); central.setUint16(32, 0, true); central.setUint16(34, 0, true); central.setUint16(36, 0, true); central.setUint32(38, 0, true); central.setUint32(42, desplazamiento, true);
    centrales.push(new Uint8Array(central.buffer), nombre);
    desplazamiento += 30 + nombre.length + datos.length;
  }
  const tamCentral = centrales.reduce((n, b) => n + b.length, 0);
  const fin = new DataView(new ArrayBuffer(22));
  fin.setUint32(0, 0x06054b50, true); fin.setUint16(4, 0, true); fin.setUint16(6, 0, true);
  fin.setUint16(8, entradas.length, true); fin.setUint16(10, entradas.length, true);
  fin.setUint32(12, tamCentral, true); fin.setUint32(16, desplazamiento, true); fin.setUint16(20, 0, true);
  return new Blob([...locales, ...centrales, new Uint8Array(fin.buffer)], { type: "application/zip" });
}

/** Nombre de archivo seguro: sin caracteres prohibidos ni espacios dobles. */
export const nombreArchivoSeguro = (s) => String(s || "").replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "archivo";
