// Lector mínimo de .xlsx en el navegador (sin librerías): abre el ZIP, descomprime con
// DecompressionStream("deflate-raw") y lee la primera hoja como filas de texto.

const LE16 = (b, o) => b[o] | (b[o + 1] << 8);
const LE32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

/** Entradas del ZIP: Map(nombre → () => Promise<Uint8Array>). */
function leerZip(bytes) {
  let fin = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (LE32(bytes, i) === 0x06054b50) { fin = i; break; }
  if (fin < 0) throw new Error("El archivo no es un Excel (.xlsx) válido.");
  const total = LE16(bytes, fin + 10);
  let p = LE32(bytes, fin + 16);
  const entradas = new Map();
  const dec = new TextDecoder();
  for (let n = 0; n < total; n++) {
    if (LE32(bytes, p) !== 0x02014b50) break;
    const metodo = LE16(bytes, p + 10), comprimido = LE32(bytes, p + 20);
    const largoNombre = LE16(bytes, p + 28), largoExtra = LE16(bytes, p + 30), largoComent = LE16(bytes, p + 32);
    const local = LE32(bytes, p + 42);
    const nombre = dec.decode(bytes.subarray(p + 46, p + 46 + largoNombre));
    entradas.set(nombre, async () => {
      const ini = local + 30 + LE16(bytes, local + 26) + LE16(bytes, local + 28);
      const datos = bytes.subarray(ini, ini + comprimido);
      if (metodo === 0) return datos;
      if (metodo !== 8) throw new Error(`Compresión no soportada en ${nombre}.`);
      const flujo = new Blob([datos]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      return new Uint8Array(await new Response(flujo).arrayBuffer());
    });
    p += 46 + largoNombre + largoExtra + largoComent;
  }
  return entradas;
}

const xml = (texto) => new DOMParser().parseFromString(texto, "application/xml");
const textoDe = (nodo) => [...nodo.getElementsByTagName("t")].map((t) => t.textContent).join("");
const columna = (ref) => String(ref || "").replace(/\d+/g, "").split("").reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;

/**
 * Lee la primera hoja de un .xlsx.
 * @param {File|Blob} archivo
 * @returns {Promise<string[][]>} filas con el texto de cada celda (vacías como "")
 */
export async function leerPrimeraHoja(archivo) {
  const zip = leerZip(new Uint8Array(await archivo.arrayBuffer()));
  const dec = new TextDecoder();
  const leer = async (n) => (zip.has(n) ? dec.decode(await zip.get(n)()) : null);
  const compartidas = await leer("xl/sharedStrings.xml");
  const textos = compartidas ? [...xml(compartidas).getElementsByTagName("si")].map(textoDe) : [];
  // La primera hoja según el libro (por si no se llama sheet1.xml).
  let ruta = "xl/worksheets/sheet1.xml";
  const libro = await leer("xl/workbook.xml"), rels = await leer("xl/_rels/workbook.xml.rels");
  if (libro && rels) {
    const primera = xml(libro).getElementsByTagName("sheet")[0];
    const rid = primera?.getAttribute("r:id") || primera?.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
    const rel = [...xml(rels).getElementsByTagName("Relationship")].find((r) => r.getAttribute("Id") === rid);
    if (rel) ruta = "xl/" + rel.getAttribute("Target").replace(/^\/?xl\//, "").replace(/^\//, "");
  }
  const hoja = await leer(ruta);
  if (!hoja) throw new Error("No encontré la primera hoja del Excel.");
  return [...xml(hoja).getElementsByTagName("row")].map((fila) => {
    const celdas = [];
    for (const c of fila.getElementsByTagName("c")) {
      const tipo = c.getAttribute("t");
      const v = c.getElementsByTagName("v")[0]?.textContent ?? "";
      celdas[columna(c.getAttribute("r"))] = tipo === "s" ? textos[Number(v)] ?? "" : tipo === "inlineStr" ? textoDe(c) : v;
    }
    return Array.from(celdas, (x) => String(x ?? "").trim());
  });
}
