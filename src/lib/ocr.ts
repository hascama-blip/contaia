import type { ExtraccionDocumento } from "./types";

// ============================================================
//  OCR + extracción de datos tributarios
// ============================================================
// Usa tesseract.js (WASM, sin binarios nativos). Si el OCR falla
// (por ejemplo, sin red para descargar el modelo de idioma), se
// devuelve texto vacío y la extracción simplemente no encuentra datos,
// sin romper la subida del documento.

/** Ejecuta OCR sobre una imagen. Devuelve el texto reconocido. */
export async function ejecutarOcr(buffer: Buffer, mimeType: string): Promise<string> {
  // Solo imágenes son procesables por tesseract directamente.
  if (!mimeType.startsWith("image/")) {
    return "";
  }
  try {
    // Import dinámico: evita cargar tesseract en el bundle del cliente.
    const { createWorker } = await import("tesseract.js");
    const worker = await createWorker("spa");
    const { data } = await worker.recognize(buffer);
    await worker.terminate();
    return data.text ?? "";
  } catch (err) {
    console.error("[OCR] Error procesando imagen:", err);
    return "";
  }
}

/** Extrae datos tributarios estructurados a partir de texto libre. */
export function extraerDatos(texto: string): ExtraccionDocumento {
  const extraccion: ExtraccionDocumento = {
    montos: [],
    deudas: [],
    fechas: [],
    palabrasClave: [],
  };
  if (!texto) return extraccion;

  const t = texto.replace(/\s+/g, " ");

  // RUC: 11 dígitos, típicamente empezando en 10/15/16/17/20.
  const rucMatch = t.match(/\b((?:10|15|16|17|20)\d{9})\b/);
  if (rucMatch) extraccion.ruc = rucMatch[1];

  // Montos en soles: S/ 1,234.56  ó  1234.56
  const montoRegex = /(?:S\/\.?\s*)?(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2}))/g;
  const montos = new Set<number>();
  let m: RegExpExecArray | null;
  while ((m = montoRegex.exec(t)) !== null) {
    const num = normalizarMonto(m[1]);
    if (!Number.isNaN(num) && num > 0) montos.add(num);
  }
  extraccion.montos = Array.from(montos).sort((a, b) => b - a).slice(0, 20);

  // Fechas: dd/mm/yyyy ó dd-mm-yyyy
  const fechaRegex = /\b(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})\b/g;
  const fechas = new Set<string>();
  let f: RegExpExecArray | null;
  while ((f = fechaRegex.exec(t)) !== null) fechas.add(f[1]);
  extraccion.fechas = Array.from(fechas).slice(0, 20);

  // Palabras clave tributarias y posibles deudas asociadas.
  const claves = [
    "DEUDA",
    "COACTIVO",
    "COACTIVA",
    "MULTA",
    "INFRACCION",
    "FRACCIONAMIENTO",
    "VALORES",
    "RESOLUCION",
    "IGV",
    "RENTA",
    "ESSALUD",
    "DETRACCION",
    "ONP",
    "EMBARGO",
    "NO HABIDO",
    "OMISO",
  ];
  const upper = t.toUpperCase();
  for (const c of claves) {
    if (upper.includes(c)) extraccion.palabrasClave.push(c);
  }

  // Si el texto menciona deuda/coactivo/multa, los montos cercanos se
  // consideran posibles deudas.
  const indicaDeuda = ["DEUDA", "COACTIV", "MULTA", "EMBARGO", "OMISO"].some((k) =>
    upper.includes(k)
  );
  if (indicaDeuda) {
    extraccion.deudas = extraccion.montos.slice(0, 5);
  }

  return extraccion;
}

function normalizarMonto(s: string): number {
  // Maneja formato peruano: 1,234.56  ó  1.234,56
  let clean = s.trim();
  const lastComma = clean.lastIndexOf(",");
  const lastDot = clean.lastIndexOf(".");
  if (lastComma > lastDot) {
    // coma decimal
    clean = clean.replace(/\./g, "").replace(",", ".");
  } else {
    // punto decimal
    clean = clean.replace(/,/g, "");
  }
  return parseFloat(clean);
}
