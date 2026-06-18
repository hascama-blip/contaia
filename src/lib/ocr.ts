// ============================================================
//  OCR de imágenes (deudas tributarias) — tesseract.js (WASM)
// ============================================================
// Lee fotos/escaneos de notificaciones o estados de deuda y extrae el texto,
// los montos y palabras clave para que el usuario clasifique la deuda. Si el
// OCR falla (sin red para el modelo de idioma), devuelve texto vacío sin romper.

/** Ejecuta OCR sobre una imagen y devuelve el texto reconocido. */
export async function ocrImagen(buffer: Buffer, mimeType: string): Promise<string> {
  if (!mimeType.startsWith("image/")) return "";
  try {
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

export interface ExtraccionDeuda {
  /** Montos detectados (mayor a menor). */
  montos: number[];
  /** Palabras clave tributarias encontradas. */
  claves: string[];
  /** Tipo de deuda sugerido a partir de las palabras clave. */
  tipoSugerido?: string;
  /** RUC detectado, si aparece. */
  ruc?: string;
  /** Periodos "MM/AAAA" o años detectados. */
  periodos: string[];
}

// Palabra clave → tipo de deuda sugerido (orden = prioridad).
const TIPO_POR_CLAVE: [RegExp, string][] = [
  [/COACTIV|EMBARGO/, "Cobranza coactiva"],
  [/MULTA|INFRACC/, "Multa / infracción"],
  [/FRACCIONAMIENTO|APLAZAMIENTO/, "Fraccionamiento"],
  [/DETRACC/, "Detracción"],
  [/ESSALUD/, "EsSalud"],
  [/\bONP\b/, "ONP"],
  [/RENTA/, "Renta"],
  [/IGV/, "IGV"],
  [/VALOR(ES)?|RESOLUCI[OÓ]N/, "Valor / resolución"],
];

const CLAVES = [
  "DEUDA", "COACTIVO", "COACTIVA", "MULTA", "INFRACCION", "INFRACCIÓN",
  "FRACCIONAMIENTO", "VALORES", "RESOLUCION", "RESOLUCIÓN", "IGV", "RENTA",
  "ESSALUD", "DETRACCION", "DETRACCIÓN", "ONP", "EMBARGO", "ORDEN DE PAGO",
];

function normalizarMonto(s: string): number {
  let clean = s.trim();
  const lastComma = clean.lastIndexOf(",");
  const lastDot = clean.lastIndexOf(".");
  if (lastComma > lastDot) clean = clean.replace(/\./g, "").replace(",", ".");
  else clean = clean.replace(/,/g, "");
  return parseFloat(clean);
}

/** Extrae montos, claves y tipo sugerido de un texto (OCR o libre). */
export function extraerDeuda(texto: string): ExtraccionDeuda {
  const out: ExtraccionDeuda = { montos: [], claves: [], periodos: [] };
  if (!texto) return out;
  const t = texto.replace(/\s+/g, " ");
  const upper = t.toUpperCase();

  // RUC.
  const ruc = t.match(/\b((?:10|15|16|17|20)\d{9})\b/);
  if (ruc) out.ruc = ruc[1];

  // Montos (S/ 1,234.56 o 1234.56).
  const montos = new Set<number>();
  const re = /(?:S\/\.?\s*)?(\d{1,3}(?:[.,]\d{3})*[.,]\d{2})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t)) !== null) {
    const n = normalizarMonto(m[1]);
    if (!Number.isNaN(n) && n > 0) montos.add(n);
  }
  out.montos = Array.from(montos).sort((a, b) => b - a).slice(0, 15);

  // Periodos.
  const per = new Set<string>();
  let p: RegExpExecArray | null;
  const reP = /\b(\d{1,2}\/\d{4}|\d{4})\b/g;
  while ((p = reP.exec(t)) !== null) per.add(p[1]);
  out.periodos = Array.from(per).slice(0, 12);

  // Claves.
  for (const c of CLAVES) if (upper.includes(c)) out.claves.push(c);

  // Tipo sugerido.
  for (const [rx, tipo] of TIPO_POR_CLAVE) {
    if (rx.test(upper)) {
      out.tipoSugerido = tipo;
      break;
    }
  }
  return out;
}
