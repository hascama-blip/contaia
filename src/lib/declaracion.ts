import type {
  CasillaDeclaracion,
  ComparativoFila,
  ComparativoPeriodo,
  DeclaracionMensual,
  SireResumen,
} from "./types";

// ============================================================
//  Declaraciones mensuales: lectura de PDF (sin OCR) + comparación con SIRE
// ============================================================
// Las constancias / formularios de SUNAT (Formulario Virtual 621 IGV-Renta,
// constancia de presentación) traen CAPA DE TEXTO: se extraen y parsean
// directamente, sin OCR ni navegador headless. Si el PDF fuese un escaneo
// (imagen), no habrá texto y la extracción devolverá vacío (el contador
// completa los montos a mano).

/**
 * Mapa de casillas → concepto. Son los códigos del Formulario 621.
 * ⚠️ AJUSTABLE: confirmar con una constancia real (Modo diagnóstico muestra
 * todas las casillas detectadas). Cuando una concepto agrupa varias casillas
 * (p.ej. compras con distinto destino), se SUMAN.
 */
export const MAPA_CASILLAS = {
  // Ventas — base imponible gravada y débito fiscal (IGV).
  ventasBase: ["100"],
  ventasIgv: ["101"],
  // Compras — base imponible gravada (varios destinos) y crédito fiscal (IGV).
  comprasBase: ["107", "110", "113"],
  comprasIgv: ["108", "111", "114"],
};

/** Umbral (S/) para marcar una diferencia como alerta (tolera redondeos). */
const UMBRAL_DIFERENCIA = 1;

/** Extrae el texto de un PDF con capa de texto. Devuelve "" si no hay texto. */
export async function extraerTextoPdf(buffer: Buffer): Promise<string> {
  try {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await extractText(pdf, { mergePages: true });
    return Array.isArray(text) ? text.join("\n") : String(text ?? "");
  } catch (err) {
    console.error("[declaracion] No se pudo leer el PDF:", err);
    return "";
  }
}

/** Normaliza un monto en formato peruano (1,234.56) a número. */
function aMonto(s: string): number {
  const clean = s.replace(/[^\d.,]/g, "");
  const lastComma = clean.lastIndexOf(",");
  const lastDot = clean.lastIndexOf(".");
  let n: string;
  if (lastComma > lastDot) n = clean.replace(/\./g, "").replace(",", ".");
  else n = clean.replace(/,/g, "");
  const v = parseFloat(n);
  return Number.isFinite(v) ? v : 0;
}

/** Detecta el periodo "YYYYMM" en el texto de la declaración. */
function detectarPeriodo(t: string): string | undefined {
  // "Periodo tributario: 2025-05" / "Periodo: 05/2025" / "Periodo 202505"
  const m1 = t.match(/per[ií]odo\D{0,25}?(\d{4})\s*[-/]?\s*(\d{2})\b/i);
  if (m1) return `${m1[1]}${m1[2]}`;
  const m2 = t.match(/per[ií]odo\D{0,25}?(\d{2})\s*[-/]\s*(\d{4})\b/i);
  if (m2) return `${m2[2]}${m2[1]}`;
  const m3 = t.match(/per[ií]odo\D{0,25}?(\d{6})\b/i);
  if (m3) return m3[1];
  return undefined;
}

/**
 * Extrae todas las casillas (código de 3 dígitos → monto) presentes en el
 * texto. Heurística tolerante a layouts: busca "Casilla NNN ... monto" y,
 * como respaldo, "NNN  monto" en la misma línea.
 */
function detectarCasillas(t: string): CasillaDeclaracion[] {
  const mapa = new Map<string, number>();
  const montoRe = "(\\d{1,3}(?:,\\d{3})*(?:\\.\\d{2})|\\d+\\.\\d{2})";

  const conPalabra = new RegExp(`casilla\\s*(\\d{3})\\D{0,40}?${montoRe}`, "gi");
  let m: RegExpExecArray | null;
  while ((m = conPalabra.exec(t)) !== null) {
    mapa.set(m[1], aMonto(m[2]));
  }
  // Respaldo: código seguido de monto en la misma proximidad.
  if (mapa.size === 0) {
    const suelto = new RegExp(`\\b(\\d{3})\\b[^\\n\\d]{0,25}?${montoRe}`, "g");
    while ((m = suelto.exec(t)) !== null) {
      if (!mapa.has(m[1])) mapa.set(m[1], aMonto(m[2]));
    }
  }
  return Array.from(mapa.entries())
    .map(([codigo, monto]) => ({ codigo, monto }))
    .sort((a, b) => a.codigo.localeCompare(b.codigo));
}

function sumarCasillas(casillas: CasillaDeclaracion[], codigos: string[]): number {
  return casillas
    .filter((c) => codigos.includes(c.codigo))
    .reduce((acc, c) => acc + c.monto, 0);
}

/** Parsea el texto de una declaración a un borrador (sin id ni persistir). */
export function parseDeclaracion(
  texto: string
): Omit<DeclaracionMensual, "id" | "cargadoAt" | "fuente" | "archivoNombre"> {
  const t = texto.replace(/ /g, " ");
  const casillas = detectarCasillas(t);

  const rucMatch = t.match(/\b((?:10|15|16|17|20)\d{9})\b/);
  const formMatch = t.match(/formulario\D{0,12}?(\d{3,4})/i) || t.match(/\b(621)\b/);

  return {
    periodo: detectarPeriodo(t) ?? "",
    ruc: rucMatch?.[1],
    formulario: formMatch?.[1],
    ventasBase: sumarCasillas(casillas, MAPA_CASILLAS.ventasBase),
    ventasIgv: sumarCasillas(casillas, MAPA_CASILLAS.ventasIgv),
    comprasBase: sumarCasillas(casillas, MAPA_CASILLAS.comprasBase),
    comprasIgv: sumarCasillas(casillas, MAPA_CASILLAS.comprasIgv),
    casillas,
  };
}

/** Compara una declaración contra el resumen SIRE del mismo periodo. */
export function compararDeclaracionSire(
  dec: DeclaracionMensual,
  sire: SireResumen | null
): ComparativoPeriodo {
  const filas: ComparativoFila[] = [];

  function fila(concepto: string, declarado: number, sireVal: number | null) {
    if (sireVal === null) {
      filas.push({ concepto, declarado, sire: 0, diferencia: 0, estado: "sin-sire" });
      return;
    }
    const diferencia = Math.round((declarado - sireVal) * 100) / 100;
    filas.push({
      concepto,
      declarado,
      sire: sireVal,
      diferencia,
      estado: Math.abs(diferencia) > UMBRAL_DIFERENCIA ? "alerta" : "ok",
    });
  }

  fila("Ventas · Base imponible", dec.ventasBase, sire ? sire.ventas.baseImponible : null);
  fila("Ventas · IGV", dec.ventasIgv, sire ? sire.ventas.igv : null);
  fila("Compras · Base imponible", dec.comprasBase, sire ? sire.compras.baseImponible : null);
  fila("Compras · IGV", dec.comprasIgv, sire ? sire.compras.igv : null);

  return {
    periodo: dec.periodo,
    filas,
    hayDiferencias: filas.some((f) => f.estado === "alerta"),
  };
}
