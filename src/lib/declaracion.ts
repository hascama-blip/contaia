import type {
  CasillaDeclaracion,
  ComparativoFila,
  ComparativoPeriodo,
  ConceptoCompra,
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
 * Mapa de casillas → concepto (Formulario Virtual / PDT 621 IGV-Renta).
 * Calibrado con constancias reales. Cuando un concepto agrupa varias casillas
 * (compras con distinto destino), se SUMAN. Si necesitas ajustar, usa el
 * Modo diagnóstico (muestra todas las casillas detectadas).
 *   100 = Ventas netas gravadas (base)      · 131 = Total débito fiscal (IGV ventas)
 *   107/110/113 = Compras nac. gravadas (base por destino)
 *   108/111/114 = IGV de esas compras (crédito fiscal)
 */
export const MAPA_CASILLAS = {
  // Ventas — débito fiscal total (IGV). La base sale del desglose de conceptos.
  ventasIgv: ["131"],
};

/**
 * Conceptos de VENTAS del 621 (cada tipo), con su casilla de BASE y de IGV.
 * Se listan TODOS (no se netean): gravadas, exportaciones y no gravadas.
 * El IGV total de ventas es la casilla 131 (débito fiscal).
 */
export const VENTAS_CONCEPTOS: { base: string; igv: string | null; etiqueta: string }[] = [
  { base: "100", igv: "101", etiqueta: "Ventas netas gravadas" },
  { base: "127", igv: null, etiqueta: "Exportaciones facturadas en el período" },
  { base: "105", igv: null, etiqueta: "Ventas no gravadas (sin exportaciones)" },
  { base: "109", igv: null, etiqueta: "Ventas no gravadas (sin efecto en ratio)" },
  { base: "112", igv: null, etiqueta: "Otras ventas" },
];

/**
 * Conceptos de COMPRAS del 621 (cada destino), con su casilla de BASE y de IGV
 * (tributo). Se listan TODOS (no se netean): nacionales, importadas, tasa 10%
 * Ley 31556 y las no gravadas. El total de compras es la suma de todas.
 */
export const COMPRAS_CONCEPTOS: { base: string; igv: string | null; etiqueta: string }[] = [
  { base: "107", igv: "108", etiqueta: "Gravadas → ventas gravadas (nacional)" },
  { base: "156", igv: "157", etiqueta: "Tasa 10% Ley 31556 → ventas gravadas (nacional)" },
  { base: "110", igv: "111", etiqueta: "Gravadas → ventas gravadas y no gravadas (nacional)" },
  { base: "113", igv: null, etiqueta: "Gravadas → ventas no gravadas (nacional)" },
  { base: "114", igv: "115", etiqueta: "Gravadas → ventas gravadas (importadas)" },
  { base: "116", igv: "117", etiqueta: "Gravadas → ventas gravadas y no gravadas (importadas)" },
  { base: "119", igv: null, etiqueta: "Gravadas → ventas no gravadas (importadas)" },
  { base: "120", igv: null, etiqueta: "Compras internas no gravadas" },
  { base: "122", igv: null, etiqueta: "Compras importadas no gravadas" },
];

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

function montoCasilla(casillas: CasillaDeclaracion[], codigo: string | null): number {
  if (!codigo) return 0;
  const c = casillas.find((x) => x.codigo === codigo);
  return c ? c.monto : 0;
}

/** Construye el desglose de compras por concepto (solo los que tienen monto). */
export function detalleCompras(casillas: CasillaDeclaracion[]): ConceptoCompra[] {
  return COMPRAS_CONCEPTOS.map((c) => ({
    codigo: c.base,
    etiqueta: c.etiqueta,
    base: montoCasilla(casillas, c.base),
    igv: montoCasilla(casillas, c.igv),
  })).filter((c) => c.base !== 0 || c.igv !== 0);
}

/** Construye el desglose de ventas por concepto (solo los que tienen monto). */
export function detalleVentas(casillas: CasillaDeclaracion[]): ConceptoCompra[] {
  const totalDebito = montoCasilla(casillas, "131");
  return VENTAS_CONCEPTOS.map((c) => {
    let igv = montoCasilla(casillas, c.igv);
    // El IGV de ventas gravadas (101) a veces no queda adyacente en el PDF;
    // si falta, usamos el total débito (131).
    if (c.base === "100" && igv === 0 && totalDebito !== 0) igv = totalDebito;
    return { codigo: c.base, etiqueta: c.etiqueta, base: montoCasilla(casillas, c.base), igv };
  }).filter((c) => c.base !== 0 || c.igv !== 0);
}

/** Parsea el texto de una declaración a un borrador (sin id ni persistir). */
export function parseDeclaracion(
  texto: string
): Omit<DeclaracionMensual, "id" | "cargadoAt" | "fuente" | "archivoNombre"> {
  const t = texto.replace(/ /g, " ");
  const casillas = detectarCasillas(t);
  const comprasDet = detalleCompras(casillas);
  const ventasDet = detalleVentas(casillas);

  const rucMatch = t.match(/\b((?:10|15|16|17|20)\d{9})\b/);
  const formMatch = t.match(/formulario\D{0,12}?(\d{3,4})/i) || t.match(/\b(621)\b/);

  return {
    periodo: detectarPeriodo(t) ?? "",
    ruc: rucMatch?.[1],
    formulario: formMatch?.[1],
    // Total de ventas = suma de TODOS los conceptos (no se netea). IGV = 131.
    ventasBase: ventasDet.reduce((a, c) => a + c.base, 0),
    ventasIgv: sumarCasillas(casillas, MAPA_CASILLAS.ventasIgv),
    ventasDetalle: ventasDet,
    // Total de compras = suma de TODOS los conceptos (no se netea).
    comprasBase: comprasDet.reduce((a, c) => a + c.base, 0),
    comprasIgv: comprasDet.reduce((a, c) => a + c.igv, 0),
    comprasDetalle: comprasDet,
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
      filas.push({ concepto, declarado, sire: 0, diferencia: 0, porcentaje: 0, estado: "sin-sire" });
      return;
    }
    const diferencia = Math.round((declarado - sireVal) * 100) / 100;
    const porcentaje = sireVal !== 0 ? Math.round((diferencia / sireVal) * 10000) / 100 : 0;
    filas.push({
      concepto,
      declarado,
      sire: sireVal,
      diferencia,
      porcentaje,
      estado: Math.abs(diferencia) > UMBRAL_DIFERENCIA ? "alerta" : "ok",
    });
  }

  fila(
    "Ventas (base total)",
    dec.ventasBase,
    sire ? sire.ventas.baseImponible + sire.ventas.inafectoExonerado : null
  );
  fila("IGV ventas (débito fiscal)", dec.ventasIgv, sire ? sire.ventas.igv : null);
  // Compras: total declarado (todos los conceptos) vs total SIRE (gravadas +
  // no gravadas), para comparar total contra total.
  fila(
    "Compras (base total)",
    dec.comprasBase,
    sire ? sire.compras.baseImponible + sire.compras.inafectoExonerado : null
  );
  fila("IGV compras (crédito fiscal)", dec.comprasIgv, sire ? sire.compras.igv : null);

  return {
    periodo: dec.periodo,
    filas,
    hayDiferencias: filas.some((f) => f.estado === "alerta"),
  };
}
