import ExcelJS from "exceljs";

// ============================================================
//  Análisis de Compras / Gastos para RTP (a partir del Libro Diario)
// ============================================================
// Entrada: el Libro Diario exportado del sistema contable (estructura BAPU):
//   Sec. | Cuenta | Fec.Reg. | Glosa | Anexo | Documento | Fec.Doc. | Cen.Cos. | Debe | Haber | Otra Mon.
// Cada gasto se registra por NATURALEZA (clase 6) y por FUNCIÓN/destino
// (clase 9), balanceado con 79. El análisis se centra en la CLASE 9 (a dónde
// fue el gasto: administración, ventas, financieros…) y arma un dashboard de
// compras/gastos para gerencia.

export interface MovDiario {
  sec: string;
  cuenta: string;
  glosa: string;
  anexo: string;
  documento: string;
  fecDoc: string; // YYYY-MM-DD (fecha del comprobante)
  fecReg: string; // YYYY-MM-DD (fecha de registro = periodo contable)
  cenCos: string;
  debe: number;
  haber: number;
}

export interface CuentaResumen {
  cod: string;
  nombre: string;   // concepto/nombre representativo
  debe: number;
  pct: number;
  n: number;
}

export interface FuncionResumen {
  cod: string;      // 2 dígitos (94, 95…)
  nombre: string;   // Gastos administrativos…
  debe: number;
  pct: number;
  n: number;
  cuentas: CuentaResumen[];
}

export interface AnalisisCompras {
  empresa: string;
  periodo: string;          // "Julio 2026" (derivado del rango de fechas)
  desde: string;
  hasta: string;
  totalGasto: number;       // suma DEBE de clase 9
  nAsientos: number;        // asientos (comprobantes) contabilizados
  nMovimientos: number;     // renglones de clase 9
  totalIgv: number;         // suma DEBE cuenta 40 (crédito fiscal)
  porFuncion: FuncionResumen[];
  porNaturaleza: CuentaResumen[];       // clase 6 por 2 dígitos
  porCentroCosto: CuentaResumen[];      // según clase 9
  porMes: { mes: string; nombre: string; debe: number; n: number }[]; // clase 9 por mes
  revision: RevisionClasificacion;      // evaluación de clasificación + sugerencias
  topConceptos: CuentaResumen[];        // por glosa
  topComprobantes: { documento: string; proveedor: string; glosa: string; debe: number }[];
  // Detalle AGRUPADO POR FUNCIÓN (2 dígitos: 94/95/97…); dentro de cada
  // función, los movimientos van ordenados por fecha.
  detalleCuentas: {
    cuenta: string;       // código de función (2 dígitos)
    funcion: string;
    concepto: string;
    total: number;
    movimientos: {
      fecha: string;      // fecha de registro (o del comprobante)
      cuenta: string;     // cuenta específica del movimiento (informativa)
      glosa: string;
      documento: string;
      cenCos: string;
      debe: number;
    }[];
  }[];
}

export interface HallazgoClasificacion {
  cuenta: string;          // cuenta actual (9x)
  funcionActual: string;   // "94 · Gastos administrativos"
  funcionSugerida: string; // "97 · Gastos financieros"
  cuentaSugerida: string;  // código sugerido (mismo, con la función corregida)
  subcuenta: string;       // referencia (de las imágenes): "95.1 Publicidad"
  glosa: string;
  documento: string;       // nº de factura/recibo/comprobante (para ubicarlo)
  fecha: string;           // fecha de registro (o del comprobante)
  importe: number;
  motivo: string;
  confianza: "alta" | "media";
}

export interface RevisionClasificacion {
  total: number;            // movimientos clase 9 revisados
  correctos: number;
  observados: number;       // con posible mala clasificación
  importeObservado: number; // suma de los importes observados
  hallazgos: HallazgoClasificacion[];
}

// --- Catálogo de nombres (PCGE + contabilidad analítica) --------------------
const NOMBRE_FUNCION: Record<string, string> = {
  "90": "Costos por distribuir",
  "91": "Costos por distribuir",
  "92": "Costo de producción",
  "93": "Gastos de fabricación / costos indirectos",
  "94": "Gastos administrativos",
  "95": "Gastos de ventas",
  "96": "Gastos financieros",
  "97": "Gastos financieros",
  "98": "Otros gastos de gestión",
};
const NOMBRE_NATURALEZA: Record<string, string> = {
  "60": "Compras (mercaderías / suministros)",
  "61": "Variación de existencias",
  "62": "Gastos de personal, directores y gerentes",
  "63": "Servicios prestados por terceros",
  "64": "Gastos por tributos",
  "65": "Otros gastos de gestión",
  "66": "Pérdida por medición de activos",
  "67": "Gastos financieros",
  "68": "Valuación, deterioro y depreciación",
  "69": "Costo de ventas",
};
export const nombreFuncion = (cod2: string) => NOMBRE_FUNCION[cod2] ?? `Cuenta de gestión ${cod2}`;
export const nombreNaturaleza = (cod2: string) => NOMBRE_NATURALEZA[cod2] ?? `Gasto por naturaleza ${cod2}`;

// --- helpers de lectura -----------------------------------------------------
const norm = (s: any) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

function celValor(cell: ExcelJS.Cell): any {
  let v: any = cell.value;
  if (v && typeof v === "object") {
    if ("result" in v) v = (v as any).result;
    else if ("richText" in v) v = (v as any).richText.map((t: any) => t.text).join("");
    else if ("text" in v) v = (v as any).text;
  }
  return v;
}
const aNumero = (v: any) => { const n = Number(String(v ?? "").replace(/[^\d.-]/g, "")); return isNaN(n) ? 0 : n; };
const aTexto = (v: any) => (v == null ? "" : String(v).trim());
function aFecha(v: any): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v ?? "").trim().replace(/^"/, "");
  const iso = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = s.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  return "";
}

/** Lee el Libro Diario (Excel) y devuelve los movimientos + la empresa.
 *  Reconoce los ASIENTOS por su patrón: cabecera del asiento (Sub.Sec="4",
 *  Comp.Cuenta=nº asiento, T/C y "RC serie-doc"), líneas de detalle (Sec
 *  "00001…") y pie "Comprobante => 04 000N | totalDebe | totalHaber". Solo se
 *  toman las LÍNEAS DE DETALLE: una línea real tiene exactamente uno de
 *  Debe/Haber (la cabecera trae ambos en 0; el pie de totales trae ambos > 0). */
export async function parseLibroDiario(buf: Buffer): Promise<{ empresa: string; movimientos: MovDiario[]; asientos: number }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as any);
  const ws = wb.worksheets[0];
  if (!ws) return { empresa: "", movimientos: [], asientos: 0 };

  let empresa = aTexto(celValor(ws.getRow(1).getCell(1)));
  // Ubica la fila de encabezado (contiene "Cuenta" y "Debe"/"Haber").
  let headerRow = -1;
  const idx: Record<string, number> = {};
  for (let r = 1; r <= Math.min(ws.rowCount, 15); r++) {
    const row = ws.getRow(r);
    const heads: Record<number, string> = {};
    let tieneCuenta = false, tieneImporte = false;
    for (let c = 1; c <= ws.columnCount; c++) {
      const h = norm(celValor(row.getCell(c)));
      heads[c] = h;
      if (h.includes("cuenta")) tieneCuenta = true;
      if (h.includes("debe") || h.includes("haber")) tieneImporte = true;
    }
    if (tieneCuenta && tieneImporte) {
      headerRow = r;
      for (let c = 1; c <= ws.columnCount; c++) {
        const h = heads[c];
        if (!h) continue;
        if (h.includes("fec") && h.includes("doc")) idx.fecDoc = c;
        else if (h.includes("fec") && h.includes("reg")) idx.fecReg = c;
        else if (h.includes("cuenta")) idx.cuenta = c;
        else if (h.includes("glosa")) idx.glosa = c;
        else if (h.includes("anexo")) idx.anexo = c;
        else if (h.includes("documento") || (h.includes("doc") && !h.includes("fec"))) idx.documento = c;
        else if (h.includes("cen") || h.includes("costo") || h.includes("cencos")) idx.cenCos = c;
        else if (h.includes("debe")) idx.debe = c;
        else if (h.includes("haber")) idx.haber = c;
        else if (h.includes("sec")) idx.sec = c;
      }
      break;
    }
  }
  if (headerRow < 0 || !idx.cuenta) return { empresa, movimientos: [], asientos: 0 };

  const movimientos: MovDiario[] = [];
  let asientos = 0;
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const cuenta = aTexto(celValor(row.getCell(idx.cuenta))).replace(/\s/g, "");
    const documento = idx.documento ? aTexto(celValor(row.getCell(idx.documento))) : "";
    // Pie de asiento: "Comprobante => 04 000N ..." → cuenta un asiento.
    if (/^comprobante/i.test(documento)) { asientos++; continue; }
    if (!/^\d+$/.test(cuenta)) continue; // no es cuenta contable
    const debe = idx.debe ? aNumero(celValor(row.getCell(idx.debe))) : 0;
    const haber = idx.haber ? aNumero(celValor(row.getCell(idx.haber))) : 0;
    // Línea de movimiento REAL = exactamente uno de Debe/Haber. Descarta
    // cabeceras de asiento (ambos 0) y filas de totales (ambos > 0).
    if ((debe > 0) === (haber > 0)) continue;
    movimientos.push({
      sec: idx.sec ? aTexto(celValor(row.getCell(idx.sec))) : "",
      cuenta,
      glosa: idx.glosa ? aTexto(celValor(row.getCell(idx.glosa))) : "",
      anexo: idx.anexo ? aTexto(celValor(row.getCell(idx.anexo))) : "",
      documento,
      fecDoc: idx.fecDoc ? aFecha(celValor(row.getCell(idx.fecDoc))) : "",
      fecReg: idx.fecReg ? aFecha(celValor(row.getCell(idx.fecReg))) : "",
      cenCos: idx.cenCos ? aTexto(celValor(row.getCell(idx.cenCos))) : "",
      debe,
      haber,
    });
  }
  return { empresa, movimientos, asientos };
}

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Setiembre", "Octubre", "Noviembre", "Diciembre"];
function periodoTexto(desde: string, hasta: string): string {
  if (!desde) return "";
  const [ay, am] = desde.split("-");
  const [by, bm] = (hasta || desde).split("-");
  const ini = `${MESES[Number(am) - 1] ?? ""} ${ay}`;
  if (ay === by && am === bm) return ini;
  return `${ini} – ${MESES[Number(bm) - 1] ?? ""} ${by}`;
}

/** Construye el análisis de compras/gastos a partir de los movimientos.
 *  `asientos` = nº de asientos detectados (pies "Comprobante =>"); si es 0 se
 *  usa el nº de documentos distintos. */
export function analizarCompras(movimientos: MovDiario[], empresa: string, asientos = 0): AnalisisCompras {
  const c9 = movimientos.filter((m) => m.cuenta.startsWith("9"));
  const c6 = movimientos.filter((m) => m.cuenta.startsWith("6"));
  const c40 = movimientos.filter((m) => m.cuenta.startsWith("40"));
  const totalGasto = c9.reduce((s, m) => s + m.debe, 0);
  const pct = (v: number) => (totalGasto > 0 ? (v / totalGasto) * 100 : 0);

  // Periodo contable = rango de fechas de REGISTRO (Fec.Reg). El libro puede
  // cubrir uno o varios meses; se muestra el rango real (p. ej. "Enero – Julio
  // 2026"). Se usa fecReg y, si falta, la fecha del comprobante.
  const fechas = movimientos.map((m) => m.fecReg || m.fecDoc).filter(Boolean).sort();
  const desde = fechas[0] ?? "";
  const hasta = fechas[fechas.length - 1] ?? "";

  // Por función (clase 9, 2 dígitos) + sus cuentas completas.
  const funcMap = new Map<string, MovDiario[]>();
  for (const m of c9) {
    const k = m.cuenta.slice(0, 2);
    (funcMap.get(k) ?? funcMap.set(k, []).get(k)!).push(m);
  }
  const porFuncion: FuncionResumen[] = [...funcMap.entries()].map(([cod, movs]) => {
    const debe = movs.reduce((s, m) => s + m.debe, 0);
    const cuentaMap = new Map<string, MovDiario[]>();
    for (const m of movs) (cuentaMap.get(m.cuenta) ?? cuentaMap.set(m.cuenta, []).get(m.cuenta)!).push(m);
    const cuentas: CuentaResumen[] = [...cuentaMap.entries()].map(([cod2, ms]) => {
      const d = ms.reduce((s, m) => s + m.debe, 0);
      return { cod: cod2, nombre: conceptoRepresentativo(ms), debe: d, pct: pct(d), n: ms.length };
    }).sort((a, b) => b.debe - a.debe);
    return { cod, nombre: nombreFuncion(cod), debe, pct: pct(debe), n: movs.length, cuentas };
  }).sort((a, b) => b.debe - a.debe);

  // Por naturaleza (clase 6, 2 dígitos).
  const natMap = new Map<string, MovDiario[]>();
  for (const m of c6) { const k = m.cuenta.slice(0, 2); (natMap.get(k) ?? natMap.set(k, []).get(k)!).push(m); }
  const totalNat = c6.reduce((s, m) => s + m.debe, 0);
  const porNaturaleza: CuentaResumen[] = [...natMap.entries()].map(([cod, ms]) => {
    const d = ms.reduce((s, m) => s + m.debe, 0);
    return { cod, nombre: nombreNaturaleza(cod), debe: d, pct: totalNat > 0 ? (d / totalNat) * 100 : 0, n: ms.length };
  }).sort((a, b) => b.debe - a.debe);

  // Por centro de costo (usando clase 9).
  const ccMap = new Map<string, MovDiario[]>();
  for (const m of c9) { const k = m.cenCos || "(sin centro)"; (ccMap.get(k) ?? ccMap.set(k, []).get(k)!).push(m); }
  const porCentroCosto: CuentaResumen[] = [...ccMap.entries()].map(([cod, ms]) => {
    const d = ms.reduce((s, m) => s + m.debe, 0);
    return { cod, nombre: cod, debe: d, pct: pct(d), n: ms.length };
  }).sort((a, b) => b.debe - a.debe);

  // Top conceptos (por glosa) sobre clase 9.
  const glosaMap = new Map<string, MovDiario[]>();
  for (const m of c9) { const k = (m.glosa || "(sin glosa)").toUpperCase(); (glosaMap.get(k) ?? glosaMap.set(k, []).get(k)!).push(m); }
  const topConceptos: CuentaResumen[] = [...glosaMap.entries()].map(([cod, ms]) => {
    const d = ms.reduce((s, m) => s + m.debe, 0);
    return { cod, nombre: cod, debe: d, pct: pct(d), n: ms.length };
  }).sort((a, b) => b.debe - a.debe).slice(0, 15);

  // Proveedor por documento: el RUC (anexo) suele estar en la línea de la cuenta 42.
  const docProveedor = new Map<string, string>();
  for (const m of movimientos) {
    if (m.documento && m.anexo && !docProveedor.has(m.documento)) docProveedor.set(m.documento, m.anexo);
  }
  const docMap = new Map<string, MovDiario[]>();
  for (const m of c9) { if (!m.documento) continue; (docMap.get(m.documento) ?? docMap.set(m.documento, []).get(m.documento)!).push(m); }
  const topComprobantes = [...docMap.entries()].map(([documento, ms]) => ({
    documento,
    proveedor: docProveedor.get(documento) ?? "",
    glosa: ms[0]?.glosa ?? "",
    debe: ms.reduce((s, m) => s + m.debe, 0),
  })).sort((a, b) => b.debe - a.debe).slice(0, 20);

  // Por mes (clase 9, según Fec.Reg). Útil al subir varios meses juntos.
  const mesMap = new Map<string, MovDiario[]>();
  for (const m of c9) { const k = (m.fecReg || m.fecDoc).slice(0, 7); if (!k) continue; (mesMap.get(k) ?? mesMap.set(k, []).get(k)!).push(m); }
  const porMes = [...mesMap.entries()].map(([mes, ms]) => {
    const [y, mm] = mes.split("-");
    return { mes, nombre: `${MESES[Number(mm) - 1] ?? mes} ${y}`, debe: ms.reduce((s, m) => s + m.debe, 0), n: ms.length };
  }).sort((a, b) => a.mes.localeCompare(b.mes));

  // Detalle AGRUPADO POR FUNCIÓN (2 dígitos); dentro de cada función, los
  // movimientos ordenados por fecha. Las funciones van en orden de código.
  const detFuncMap = new Map<string, MovDiario[]>();
  for (const m of c9) { const k = m.cuenta.slice(0, 2); (detFuncMap.get(k) ?? detFuncMap.set(k, []).get(k)!).push(m); }
  const detalleCuentas = [...detFuncMap.entries()].map(([cod, ms]) => ({
    cuenta: cod,
    funcion: nombreFuncion(cod),
    concepto: "",
    total: ms.reduce((s, m) => s + m.debe, 0),
    movimientos: ms.map((m) => ({
      fecha: m.fecReg || m.fecDoc,
      cuenta: m.cuenta,
      glosa: m.glosa,
      documento: m.documento,
      cenCos: m.cenCos,
      debe: m.debe,
    })).sort((a, b) => (a.fecha || "").localeCompare(b.fecha || "")),
  })).sort((a, b) => a.cuenta.localeCompare(b.cuenta));

  return {
    empresa: empresa || "—",
    periodo: periodoTexto(desde, hasta),
    desde, hasta,
    totalGasto,
    nAsientos: asientos > 0 ? asientos : new Set(c9.map((m) => m.documento).filter(Boolean)).size,
    nMovimientos: c9.length,
    totalIgv: c40.reduce((s, m) => s + m.debe, 0),
    porFuncion,
    porNaturaleza,
    porCentroCosto,
    porMes,
    revision: revisarClasificacion(c9),
    topConceptos,
    topComprobantes,
    detalleCuentas,
  };
}

// Nombre de subcuenta de referencia (estructura de las imágenes 94/95/97).
const SUB_94: Record<string, string> = { "1": "94.1 Valuación de activos y provisiones", "2": "94.2 Útiles de escritorio", "3": "94.3 Gastos generales", "4": "94.4 Sueldos y salarios", "5": "94.5 Contribuciones y cargas sociales" };
const SUB_95: Record<string, string> = { "1": "95.1 Publicidad", "2": "95.2 Comunicaciones", "3": "95.3 Comisiones", "4": "95.4 Sueldos y salarios", "5": "95.5 Contribuciones y cargas sociales", "6": "95.6 Depreciación y amortización", "7": "95.7 Gastos generales", "8": "95.8 Valuación de activos y provisiones" };

/**
 * Evalúa si cada gasto (clase 9) está clasificado en la función correcta
 * (94 Administración / 95 Ventas / 97 Financieros) y, si no, sugiere a qué
 * cuenta reclasificarlo. Reglas (según las cuentas 94/95/97 de referencia):
 *  - Naturaleza financiera (67…) → debe ir a 97.
 *  - Publicidad/marketing → Ventas (95.1).
 *  - Comisiones/portes bancarios, intereses, ITF, mantenimiento de cuenta,
 *    sobregiro → Financieros (97).
 * Solo se marcan hallazgos de confianza razonable (no adivina el resto).
 */
function revisarClasificacion(c9: MovDiario[]): RevisionClasificacion {
  const hallazgos: HallazgoClasificacion[] = [];
  for (const m of c9) {
    const func = m.cuenta.slice(0, 2);
    const natEmbed = m.cuenta.slice(2, 4); // naturaleza embebida en la cuenta 9x
    const g = (m.glosa || "").toLowerCase();
    let esperada = "", sub = "", motivo = "", conf: "alta" | "media" = "media";

    const bancoFuerte = /inter[eé]s\b|\bitf\b|impuesto.*transacci|mantenimiento de cuenta|portes de cobranza|gastos? bancari|comisi[oó]n(es)? bancari|cargo bancari|sobregiro|financiamiento|desgravamen|seguro de cr[eé]dito/i.test(g);
    // Indicios de cargo bancario/financiero (más suaves → confianza media).
    const bancoMedio = /\bportes\b|(mantenimiento.*(cuenta|tarjeta|portes))|transacci[oó]n|cobro.*servici/i.test(g);
    const esPublicidad = /publicidad|marketing|gigantograf|banner|afiche|volante|promoci[oó]n|flyer|auspicio|panel(es)? public|merchandising|spot public/i.test(g);

    if (natEmbed === "67" && func !== "97") {
      esperada = "97"; sub = "97 Gastos financieros"; conf = "alta";
      motivo = `El gasto es de naturaleza financiera (cuenta 67…) pero está registrado en ${func} (${nombreFuncion(func)}). Debe ir a Gastos financieros (97).`;
    } else if (esPublicidad && func !== "95") {
      esperada = "95"; sub = SUB_95["1"]; conf = "alta";
      motivo = `Concepto de publicidad/marketing registrado en ${func} (${nombreFuncion(func)}). Corresponde a Gastos de ventas (95.1 Publicidad).`;
    } else if (bancoFuerte && func !== "97") {
      esperada = "97"; sub = "97 Gastos financieros"; conf = "alta";
      motivo = `Concepto financiero/bancario registrado en ${func} (${nombreFuncion(func)}). Corresponde a Gastos financieros (97).`;
    } else if (bancoMedio && func !== "97") {
      esperada = "97"; sub = "97 Gastos financieros"; conf = "media";
      motivo = `Posible cargo bancario/financiero ("${m.glosa}") registrado en ${func} (${nombreFuncion(func)}). Revisar si corresponde a Gastos financieros (97).`;
    } else if (func === "97" && natEmbed !== "67") {
      esperada = "94"; sub = SUB_94["3"]; conf = "media";
      motivo = `Está en Gastos financieros (97) pero su naturaleza (${natEmbed}…) no es financiera. Revisar: probablemente sea administrativo (94) o de ventas (95).`;
    }

    if (esperada && esperada !== func) {
      hallazgos.push({
        cuenta: m.cuenta,
        funcionActual: `${func} · ${nombreFuncion(func)}`,
        funcionSugerida: `${esperada} · ${nombreFuncion(esperada)}`,
        cuentaSugerida: esperada + m.cuenta.slice(2),
        subcuenta: sub,
        glosa: m.glosa,
        documento: m.documento,
        fecha: m.fecReg || m.fecDoc,
        importe: m.debe,
        motivo,
        confianza: conf,
      });
    }
  }
  hallazgos.sort((a, b) => (a.confianza === b.confianza ? b.importe - a.importe : a.confianza === "alta" ? -1 : 1));
  return {
    total: c9.length,
    observados: hallazgos.length,
    correctos: c9.length - hallazgos.length,
    importeObservado: hallazgos.reduce((s, h) => s + h.importe, 0),
    hallazgos,
  };
}

/** Concepto representativo de un grupo de movimientos (glosa más frecuente). */
function conceptoRepresentativo(movs: MovDiario[]): string {
  const cont = new Map<string, number>();
  for (const m of movs) { const g = (m.glosa || "").trim(); if (g) cont.set(g, (cont.get(g) ?? 0) + 1); }
  let mejor = "", max = 0;
  for (const [g, c] of cont) if (c > max) { max = c; mejor = g; }
  return mejor || movs[0]?.cuenta || "—";
}
