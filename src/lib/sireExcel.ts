// Lector robusto del Excel de propuesta SIRE (RCE compras / RVIE ventas).
// Detecta las columnas por su ENCABEZADO (no por posición fija), así soporta
// el formato estándar exportado por SUNAT. Si el archivo trae las columnas
// "Cuenta Contable" y "Glosa", también las aprovecha.

export interface CompSire {
  serie: string;
  numero: string;
  fecha: string;
  rucContraparte: string; // RUC del proveedor (compras) o cliente (ventas)
  razonSocial: string;
  baseGravada: number;
  igv: number;
  total: number;
  tipo?: string;
}

function txt(v: any): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    if ("result" in v) return txt(v.result);
    if ("text" in v) return txt(v.text);
    if (v instanceof Date) return v.toISOString();
  }
  return String(v).trim();
}
function n(v: any): number {
  const x = Number(txt(v).replace(/[^\d.-]/g, ""));
  return Number.isFinite(x) ? x : 0;
}
function fecha(v: any): string {
  if (v instanceof Date && !isNaN(v.getTime())) {
    const p = (x: number) => String(x).padStart(2, "0");
    return `${p(v.getUTCDate())}/${p(v.getUTCMonth() + 1)}/${v.getUTCFullYear()}`;
  }
  return txt(v);
}

/** Resultado con diagnóstico: además de los comprobantes, explica el porqué si salen 0. */
export interface SireExcelResult {
  comps: CompSire[];
  motivo?: string; // razón legible cuando comps está vacío
}

/** Parsea el Excel del SIRE (RCE o RVIE) y explica el resultado. */
export function analizarSireExcel(filas: unknown[][]): SireExcelResult {
  if (!Array.isArray(filas) || filas.length === 0) {
    return { comps: [], motivo: "El archivo está vacío o no se pudo leer la hoja." };
  }

  // Busca la fila de encabezados (la que tiene "Serie" y "Total CP" o similar).
  let hi = -1;
  for (let i = 0; i < Math.min(filas.length, 8); i++) {
    const h = (filas[i] || []).map((c) => txt(c).toLowerCase());
    if (h.some((x) => /serie/.test(x)) && h.some((x) => /total\s*cp|importe\s*total|total\s*comprob/.test(x))) {
      hi = i;
      break;
    }
  }
  if (hi < 0) {
    return {
      comps: [],
      motivo:
        "No encontré la fila de encabezados del SIRE (debe tener columnas como “Serie del CDP” y “Total CP”). " +
        "¿Es el Excel descargado del SIRE (propuesta RCE/RVIE)?",
    };
  }

  const head = (filas[hi] as any[]).map((c) => txt(c).toLowerCase());
  const find = (re: RegExp) => head.findIndex((x) => re.test(x));
  const findAll = (re: RegExp) => head.map((x, i) => (re.test(x) ? i : -1)).filter((i) => i >= 0);

  const iFecha = find(/fecha\s*de\s*emisi/);
  const iSerie = find(/serie\s*del\s*cdp/) >= 0 ? find(/serie\s*del\s*cdp/) : find(/^serie/);
  const iNum =
    find(/nro\s*cp.*inicial/) >= 0 ? find(/nro\s*cp.*inicial/) :
    find(/nro\s*cp\s*o\s*doc/) >= 0 ? find(/nro\s*cp\s*o\s*doc/) : find(/n[uú]mero/);
  const iTipo = find(/tipo\s*cp\s*\/?\s*doc/);
  const iRuc = find(/nro\s*doc\s*identidad/);
  const iNombre = iRuc >= 0 && iRuc + 1 < head.length ? iRuc + 1 : find(/apellidos\s*nombres\s*\/\s*raz/);
  const colsBase = findAll(/^bi\s*gravad/);
  const colsIgv = findAll(/igv\s*\/?\s*ipm/);
  const iTotal = find(/total\s*cp|importe\s*total/);

  if (iSerie < 0 || iRuc < 0 || iTotal < 0) {
    const faltan = [
      iSerie < 0 && "Serie del CDP",
      iRuc < 0 && "Nro Doc Identidad",
      iTotal < 0 && "Total CP",
    ].filter(Boolean).join(", ");
    return { comps: [], motivo: `Faltan columnas en el encabezado: ${faltan}.` };
  }

  const out: CompSire[] = [];
  let descartadas = 0;
  for (let r = hi + 1; r < filas.length; r++) {
    const row = filas[r] as any[];
    if (!row) continue;
    const ruc = txt(row[iRuc]);
    const serie = txt(row[iSerie]);
    if (!/^\d{8}$|^\d{11}$/.test(ruc) || !serie) {
      if (ruc || serie) descartadas++;
      continue;
    }
    out.push({
      serie,
      numero: txt(row[iNum]),
      fecha: fecha(row[iFecha]),
      rucContraparte: ruc,
      razonSocial: txt(row[iNombre]),
      baseGravada: colsBase.reduce((a, c) => a + n(row[c]), 0),
      igv: colsIgv.reduce((a, c) => a + n(row[c]), 0),
      total: n(row[iTotal]),
      tipo: iTipo >= 0 ? txt(row[iTipo]) : undefined,
    });
  }
  if (out.length === 0) {
    return {
      comps: [],
      motivo: `Encontré el encabezado pero ninguna fila con documento válido (RUC/DNI + serie). Filas descartadas: ${descartadas}.`,
    };
  }
  return { comps: out };
}

/** Parsea el Excel del SIRE (RCE o RVIE) a comprobantes. */
export function parseSireExcel(filas: unknown[][]): CompSire[] {
  return analizarSireExcel(filas).comps;
}
