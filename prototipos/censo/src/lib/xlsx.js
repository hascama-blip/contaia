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

/**
 * Abre el libro completo (todas las hojas) y conserva sus partes para poder guardarlo con cambios.
 * @returns {Promise<{ partes: Map<string,Uint8Array>, hojas: { nombre:string, ruta:string, filas:{ r:number, celdas:string[] }[] }[] }>}
 */
export async function leerLibro(archivo) {
  const zip = leerZip(new Uint8Array(await archivo.arrayBuffer()));
  const partes = new Map();
  for (const [nombre, leer] of zip) partes.set(nombre, await leer());
  const dec = new TextDecoder();
  const texto = (n) => (partes.has(n) ? dec.decode(partes.get(n)) : null);
  const compartidas = texto("xl/sharedStrings.xml");
  const textos = compartidas ? [...xml(compartidas).getElementsByTagName("si")].map(textoDe) : [];
  const libro = texto("xl/workbook.xml"), rels = texto("xl/_rels/workbook.xml.rels");
  if (!libro || !rels) throw new Error("El archivo no es un Excel (.xlsx) válido.");
  const destino = new Map([...xml(rels).getElementsByTagName("Relationship")].map((r) => [r.getAttribute("Id"), r.getAttribute("Target")]));
  const hojas = [];
  for (const s of xml(libro).getElementsByTagName("sheet")) {
    const rid = s.getAttribute("r:id") || s.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
    const ruta = "xl/" + String(destino.get(rid) || "").replace(/^\/?xl\//, "").replace(/^\//, "");
    const contenido = texto(ruta);
    if (!contenido) continue;
    const filas = [...xml(contenido).getElementsByTagName("row")].map((fila) => {
      const celdas = [];
      for (const c of fila.getElementsByTagName("c")) {
        const tipo = c.getAttribute("t");
        const v = c.getElementsByTagName("v")[0]?.textContent ?? "";
        celdas[columna(c.getAttribute("r"))] = tipo === "s" ? textos[Number(v)] ?? "" : tipo === "inlineStr" ? textoDe(c) : v;
      }
      return { r: Number(fila.getAttribute("r")), celdas: Array.from(celdas, (x) => String(x ?? "").trim()) };
    });
    hojas.push({ nombre: s.getAttribute("name"), ruta, filas });
  }
  return { partes, hojas };
}

const escXml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Escribe celdas de TEXTO en el XML de una hoja (así un DNI conserva sus ceros a la izquierda).
 * Solo toca las filas indicadas; el resto del archivo queda byte por byte igual.
 * @param {string} xmlHoja
 * @param {Map<string,string>} celdas   "B5" → "08927693"
 */
export function ponerCeldasTexto(xmlHoja, celdas) {
  const porFila = new Map();
  for (const [ref, valor] of celdas) {
    const r = Number(ref.replace(/\D/g, ""));
    if (!porFila.has(r)) porFila.set(r, []);
    porFila.get(r).push([ref, valor]);
  }
  let colMax = 0;
  let salida = xmlHoja.replace(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g, (todo, attrs, dentro = "") => {
    const nuevas = porFila.get(Number(/\br="(\d+)"/.exec(attrs)?.[1]));
    if (!nuevas) return todo;
    const actuales = [...dentro.matchAll(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g)].map((m) => ({ xml: m[0], ref: /\br="([A-Z]+\d+)"/.exec(m[0])?.[1] || "" }));
    for (const [ref, valor] of nuevas) {
      const i = actuales.findIndex((c) => c.ref === ref);
      const estilo = i >= 0 ? /\bs="(\d+)"/.exec(actuales[i].xml)?.[1] : null;
      const celda = { ref, xml: `<c r="${ref}"${estilo ? ` s="${estilo}"` : ""} t="inlineStr"><is><t>${escXml(valor)}</t></is></c>` };
      if (i >= 0) actuales[i] = celda; else actuales.push(celda);
      colMax = Math.max(colMax, columna(ref));
    }
    actuales.sort((a, b) => columna(a.ref) - columna(b.ref));
    return `<row${attrs.replace(/\s+spans="[^"]*"/, "")}>${actuales.map((c) => c.xml).join("")}</row>`; // sin "spans": dejaría de ser cierto
  });
  // El rango usado de la hoja debe alcanzar a la columna escrita.
  salida = salida.replace(/<dimension ref="([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?"\/>/, (todo, c1, r1, c2 = c1, r2 = r1) => {
    if (columna(c2) >= colMax) return todo;
    let letras = ""; for (let n = colMax + 1; n > 0; n = Math.floor((n - 1) / 26)) letras = String.fromCharCode(65 + ((n - 1) % 26)) + letras;
    return `<dimension ref="${c1}${r1}:${letras}${r2}"/>`;
  });
  return salida;
}
