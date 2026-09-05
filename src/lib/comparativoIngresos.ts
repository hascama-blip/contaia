// ============================================================
//  Comparativo de INGRESOS por fuente: EECC (banco) vs StarSoft vs Caja Virtual
// ============================================================
// El usuario sube, por empresa/periodo, hasta 3 tipos de Excel:
//   1) ESTADO DE CUENTA / EECC  → FORMATO BANCO STARSOFT (una hoja por cuenta,
//      agrupadas por empresa). Ingreso = suma de ABONOS.
//   2) STARSOFT (Registro de Ventas) → empresa en A1, RUC en A2, cabecera en la
//      fila 4 (col "Total"). Ingreso = suma de la columna "Total" (total facturado).
//      Nombre de archivo esperado: "starsoft - <empresa> - <periodo>".
//   3) CAJA VIRTUAL (export contable "Resultado") → asientos; cada venta tiene una
//      línea DEBE con el total. Ingreso = suma de IMPORTE de las líneas "D".
//      Nombre de archivo esperado: "caja - <empresa> - <periodo>" (o similar).
//
// Salida (Excel de 2 hojas):
//   Hoja 1 "Ingresos por fuente": una fila por empresa con el ingreso según cada
//     fuente (EECC, StarSoft, Caja Virtual) y si coinciden.
//   Hoja 2 "Conciliación": una fila por empresa con las diferencias EECC−StarSoft,
//     EECC−Caja Virtual y StarSoft−Caja Virtual (cada una con su diferencia).
//
// Lee .xls (BIFF) y .xlsx con SheetJS; escribe con ExcelJS.

import * as XLSX from "xlsx";
import ExcelJS from "exceljs";
import { agruparHojasPorEmpresa, parseBancoStarsoft } from "./conciliacionStarsoft";

const num = (s: any): number => {
  const n = Number(String(s ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const r2 = (n: number) => +n.toFixed(2);
// Clave para un documento cuya empresa no se pudo identificar por el nombre.
const SIN_EMPRESA = "__SIN_EMPRESA__";

/** Normaliza el nombre de una empresa para emparejar fuentes: mayúsculas, sin
 *  tildes, sin formas societarias (SAC/SA/SRL/EIRL…) ni puntuación. */
export function normEmpresa(s: string): string {
  let x = String(s ?? "")
    .toUpperCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "") // sin tildes
    .replace(/[.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // quita la forma societaria al final (S A C, SAC, S R L, EIRL, S A, etc.)
  x = x.replace(/\b(S\s*A\s*C|SAC|S\s*R\s*L|SRL|E\s*I\s*R\s*L|EIRL|S\s*A\s*A|SAA|S\s*A|SA)\b\.?\s*$/g, "").trim();
  return x.replace(/\s+/g, " ").trim();
}

// Palabras que NO son una empresa (nombres de tipo de documento). Si el nombre
// de archivo solo trae esto, no inventamos una empresa "CAJA VIRTUAL".
const GENERICOS = new Set([
  "CAJA", "VIRTUAL", "CAJA VIRTUAL", "REPORTE CAJA VIRTUAL", "REPORTE", "RESULTADO",
  "STARSOFT", "STAR SOFT", "REGISTRO DE VENTAS", "VENTAS", "EECC", "ESTADO DE CUENTA",
  "EXTRACTO", "EXTRACTO BANCARIO", "BANCO", "LIBRO", "LIBRO BANCO",
  "FORMATO BANCO STARSOFT", "HOJA1", "HOJA 1",
]);
function esNombreGenerico(s: string): boolean {
  const n = normEmpresa(s);
  return !n || GENERICOS.has(n);
}

/** ¿El segmento parece un periodo (mes/año/fecha) y no una empresa? */
function esPeriodo(s: string): boolean {
  const t = String(s ?? "").toUpperCase().trim();
  if (/^\d{4}$/.test(t) || /^\d{6}$/.test(t)) return true;                 // 2026, 202608
  if (/^\d{1,2}[\/.\-]\d{1,2}([\/.\-]\d{2,4})?$/.test(t)) return true;     // 01/08 o 01/08/2026
  if (/\b(20\d{2})\b/.test(t) && t.replace(/[^A-Z]/g, "").length <= 4) return true; // "ABR 2026"
  return /^(ENE|FEB|MAR|ABR|MAY|JUN|JUL|AGO|SEP|SET|OCT|NOV|DIC|ENERO|FEBRERO|MARZO|ABRIL|MAYO|JUNIO|JULIO|AGOSTO|SET?IEMBRE|OCTUBRE|NOVIEMBRE|DICIEMBRE|PERIODO)/.test(t);
}

/** Saca la empresa del nombre de archivo. NO asume posición: descarta los
 *  segmentos genéricos (BANCOS, STARSOFT, CAJA VIRTUAL, EECC…) y los periodos,
 *  y se queda con el resto. Soporta "EMPRESA - TIPO", "TIPO - EMPRESA - periodo",
 *  "EMPRESA - TIPO - periodo", etc. Devuelve "" si no queda nada útil. */
export function empresaDeNombre(nombre: string): string {
  const base = String(nombre ?? "").replace(/\.[a-z0-9]+$/i, ""); // sin extensión
  const partes = base.split(/\s*[-_]\s*/).map((p) => p.trim()).filter(Boolean);
  const cand = partes.filter((p) => !esNombreGenerico(p) && !esPeriodo(p));
  if (cand.length) return cand.sort((a, b) => b.length - a.length)[0]; // el más "sustancioso"
  return "";
}

function leerHojas(buf: Buffer): Record<string, string[][]> {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  const out: Record<string, string[][]> = {};
  for (const sn of wb.SheetNames) {
    out[sn] = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: "", raw: false }) as string[][];
  }
  return out;
}

// ---- Modelo ----------------------------------------------------------------
export interface FuenteArchivo { nombre: string; buffer: Buffer }
/** Un comprobante (venta) leído de StarSoft o de Caja Virtual. */
export interface Comprobante {
  comprobante: string;  // etiqueta a mostrar (p.ej. "B001 0004670")
  norm: string;         // clave normalizada para emparejar ("B0010004670")
  fecha: string;
  tipoDoc: string;      // 01=Factura, 03=Boleta…
  ruc: string;          // RUC/DNI del cliente
  cliente: string;
  total: number;
  categoria?: string;   // POLICLINICO / ESCUELA (cuando aplica, p.ej. MI BREVETE SEGURO)
}
/** Ingreso de una empresa según una fuente. `label` = nombre "bonito" que se muestra. */
export interface IngresoEmpresa { key: string; label: string; total: number; detalle?: string; comprobantes?: Comprobante[] }

export interface FilaComparativo {
  empresa: string;         // etiqueta a mostrar
  eecc: number | null;     // banco (ABONOS)
  starsoft: number | null; // registro de ventas (Total)
  caja: number | null;     // caja virtual (líneas D)
  detalleEecc?: string;    // cuentas del banco que suman el EECC
}
/** Fila del detalle POR COMPROBANTE (StarSoft vs Caja Virtual). Se ven los DOS
 *  comprobantes emparejados (el de StarSoft y el de Caja) y su diferencia. */
export interface DetalleComprobante {
  empresa: string;
  compStarsoft: string;    // comprobante en StarSoft ("" si no está)
  compCaja: string;        // comprobante en Caja ("" si no está)
  fecha: string;
  tipoDoc: string;
  ruc: string;
  cliente: string;
  starsoft: number | null;
  caja: number | null;
  dif: number | null;
  estado: string;          // "Cuadra" | "Difiere" | "Solo StarSoft" | "Solo Caja"
  categoria?: string;      // POLICLINICO / ESCUELA (cuando aplica)
}
export interface ResultadoComparativo {
  filas: FilaComparativo[];
  detalle: DetalleComprobante[];
  fuentes: { eecc: number; starsoft: number; caja: number }; // cuántos archivos por fuente
  avisos: string[];
}

// ---- Parsers de ingreso por fuente ----------------------------------------
/** EECC / banco: agrupa por empresa (leyenda / A1) y suma ABONOS por empresa. */
export function ingresosBanco(archivos: FuenteArchivo[]): Record<string, IngresoEmpresa> {
  const acc: Record<string, IngresoEmpresa> = {};
  const add = (key: string, label: string, abono: number, cuentas: string) => {
    const prev = acc[key];
    if (prev) { prev.total = r2(prev.total + abono); prev.detalle = [prev.detalle, cuentas].filter(Boolean).join(", "); }
    else acc[key] = { key, label, total: r2(abono), detalle: cuentas };
  };
  for (const { nombre, buffer } of archivos) {
    const empArch = empresaDeNombre(nombre); // el NOMBRE del archivo manda
    let grupos: { empresa: string; cuentas: string[] }[] = [];
    try { grupos = agruparHojasPorEmpresa(buffer); } catch { grupos = []; }
    // ¿El archivo trae VARIAS empresas de verdad? (FORMATO BANCO STARSOFT con leyenda)
    const esReal = (e: string) => e && !esNombreGenerico(e) && !/^\(sin empresa\)$/i.test(e);
    const distintas = new Set(grupos.map((g) => g.empresa).filter(esReal).map((e) => normEmpresa(e)));
    const multiEmpresa = distintas.size >= 2;
    for (const g of grupos) {
      const movs = parseBancoStarsoft(buffer, g.cuentas);
      const abono = movs.reduce((a, m) => a + (m.abono || 0), 0);
      if (!abono) continue;
      // Multi-empresa (un solo Excel con muchas) → empresa de la hoja. Si es de una
      // sola empresa (o la hoja no la trae) → manda el nombre del archivo.
      const empresa = multiEmpresa ? g.empresa : (empArch || (esReal(g.empresa) ? g.empresa : "") || g.empresa);
      const key = normEmpresa(empresa) || empresa.toUpperCase().trim();
      add(key, empresa, abono, g.cuentas.join(", "));
    }
  }
  return acc;
}

/** Normaliza un número de comprobante para emparejar StarSoft ↔ Caja:
 *  "B001 0004670" y "B0010004670" → "B0010004670". */
const normComp = (s: any) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").trim();
/** ¿El nro. documento parece un comprobante electrónico (boleta/factura)?
 *  Empiezan por letra de serie: B0010015106, F001-12, etc. */
const pareceComprobante = (s: any) => /^[A-Z]/.test(normComp(s));
/** Categoría de ingreso a partir de la "Sede" (MI BREVETE SEGURO: policlínico /
 *  escuela). Devuelve "" si no aplica. */
const catDeSede = (s: any): string => { const t = String(s ?? "").toUpperCase(); return /POLICLIN/.test(t) ? "POLICLINICO" : (/ESCUELA/.test(t) ? "ESCUELA" : ""); };

/** ¿El tipo de documento es una NOTA DE CRÉDITO? Se excluyen del comparativo
 *  (StarSoft las asienta en negativo y la Caja con el total en el Haber, así que
 *  distorsionan el cruce). StarSoft usa el código "07"; la Caja el texto "NC". */
function esNotaCredito(tipoDoc: any): boolean {
  const t = String(tipoDoc ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").trim();
  return t === "07" || t === "NC" || /NOTADECREDITO/.test(t);
}

/** Contador de comprobantes excluidos por ser notas de crédito. */
export interface StatsExcluidos { starsoft: number; caja: number }

/** Agrega un comprobante al acumulador de la empresa (crea la entrada si falta). */
function agregarComp(acc: Record<string, IngresoEmpresa>, key: string, labelFallback: string, c: Comprobante) {
  const e = acc[key] ?? (acc[key] = { key, label: labelFallback, total: 0, comprobantes: [] });
  if (!e.comprobantes) e.comprobantes = [];
  e.comprobantes.push(c);
  e.total = r2(e.total + c.total);
}

/** StarSoft (Registro de Ventas): un comprobante por fila. Empresa desde A1 o
 *  desde el nombre de archivo. Un archivo = una empresa. */
export function ingresosStarsoft(archivos: FuenteArchivo[], stats?: StatsExcluidos): Record<string, IngresoEmpresa> {
  const acc: Record<string, IngresoEmpresa> = {};
  for (const { nombre, buffer } of archivos) {
    const hojas = leerHojas(buffer);
    const filas = Object.values(hojas)[0] ?? [];
    if (!filas.length) continue;
    // El slot StarSoft también acepta el formato REPORTE (Empresa/Comprobante/Total).
    const hRep = filaCabeceraReporte(filas);
    if (hRep >= 0) { parseReporteVentas(acc, nombre, filas, hRep, stats, "starsoft"); continue; }
    const a1 = String(filas[0]?.[0] ?? "").trim();
    const empresaA1 = a1 && !/^fecha$/i.test(a1) && !esNombreGenerico(a1) ? a1 : "";
    const empresa = empresaDeNombre(nombre) || empresaA1; // el nombre del archivo manda
    // Cabecera: fila que contiene "Total" y "Documento"/"R.U.C.".
    let hRow = filas.findIndex((f) => f.some((c) => /^total$/i.test(String(c).trim())) && f.some((c) => /documento|r\.?u\.?c/i.test(String(c))));
    if (hRow < 0) hRow = filas.findIndex((f) => f.some((c) => /^total$/i.test(String(c).trim())));
    if (hRow < 0) continue;
    const H = filas[hRow].map((c) => String(c).toUpperCase().replace(/\s+/g, " ").trim());
    const iTotal = H.indexOf("TOTAL");
    const iDoc = H.indexOf("DOCUMENTO");
    const iFecha = H.findIndex((h) => /^FECHA/.test(h));
    const iTD = H.findIndex((h) => /T\/D|TIPO/.test(h));
    const iRuc = H.findIndex((h) => /R\.?U\.?C|RUC|DNI/.test(h));
    const iNom = H.findIndex((h) => /NOMBRE|RAZON/.test(h));
    if (iTotal < 0 || iDoc < 0) continue;
    const key = empresa ? (normEmpresa(empresa) || empresa.toUpperCase().trim()) : SIN_EMPRESA;
    const label = empresa || "StarSoft (empresa no identificada)";
    for (let i = hRow + 1; i < filas.length; i++) {
      const f = filas[i]; if (!f) continue;
      const doc = String(f[iDoc] ?? "").trim();
      if (!doc) continue; // pie "Total ..." sin documento
      // Las notas de crédito SÍ se consideran: en el registro ya vienen en negativo.
      if (iTD >= 0 && esNotaCredito(f[iTD]) && stats) stats.starsoft++;
      agregarComp(acc, key, label, {
        comprobante: doc.replace(/\s+/g, " ").trim(),
        norm: normComp(doc),
        fecha: String(f[iFecha] ?? "").trim(),
        tipoDoc: iTD >= 0 ? String(f[iTD] ?? "").trim() : "",
        ruc: iRuc >= 0 ? String(f[iRuc] ?? "").trim() : "",
        cliente: iNom >= 0 ? String(f[iNom] ?? "").trim() : "",
        total: num(f[iTotal]),
      });
    }
    if (!acc[key]) acc[key] = { key, label, total: 0, comprobantes: [] };
  }
  return acc;
}

/** Caja Virtual (export contable "Resultado"): agrupa las líneas "D" por NRO
 *  DOCUMENTO (cada venta) → un comprobante con su total. Empresa desde el nombre
 *  del archivo. */
export function ingresosCaja(archivos: FuenteArchivo[], stats?: StatsExcluidos): Record<string, IngresoEmpresa> {
  const acc: Record<string, IngresoEmpresa> = {};
  for (const { nombre, buffer } of archivos) {
    const hojas = leerHojas(buffer);
    const filas = hojas["Resultado"] ?? Object.values(hojas)[0] ?? [];
    if (!filas.length) continue;

    // ¿Formato REPORTE de Caja Virtual? (cabecera con Comprobante + Total, y
    // columnas Empresa/Comisión). Es distinto del export contable "Resultado".
    const hRepIdx = filaCabeceraReporte(filas);
    if (hRepIdx >= 0) {
      parseReporteVentas(acc, nombre, filas, hRepIdx, stats, "caja");
      continue;
    }

    const H = (filas[0] ?? []).map((c) => String(c).toUpperCase().replace(/\s+/g, " ").trim());
    const iImp = H.indexOf("IMPORTE");
    const iDH = H.findIndex((h) => h.replace(/\s/g, "") === "DEBE/HABER");
    const iCta = H.findIndex((h) => /CTA CONTABLE|CUENTA CONTABLE/.test(h));
    if (iImp < 0 || iDH < 0 || iCta < 0) continue;
    const iNro = H.findIndex((h) => /^NRO DOCUMENTO$|NRO\.? DOC/.test(h));
    const iTD = H.findIndex((h) => /^TIPO DOCUMENTO/.test(h));
    const iFe = H.findIndex((h) => /FECHA EMISION|FECHA REGISTRO/.test(h));
    const iRuc = H.findIndex((h) => /RUC CLIENTE/.test(h));
    const iRazon = H.findIndex((h) => /RAZON SOCIAL/.test(h));
    const iCod = H.findIndex((h) => /CODIGO CLIENTE|CODIGO ANEXO/.test(h));
    const iGlosaMov = H.findIndex((h) => /GLOSA MOVIMIENTO/.test(h));

    const empresa = empresaDeNombre(nombre);
    const key = empresa ? (normEmpresa(empresa) || empresa.toUpperCase().trim()) : SIN_EMPRESA;
    const label = empresa || "Caja (empresa no identificada)";

    // Cada BOLETA/FACTURA está en una línea de cuenta 12x (cuentas por cobrar del
    // cliente) con su nro. de comprobante — así funciona tanto si el asiento la
    // pone en el Debe (ventas) como en el Haber (cobranzas). Se agrupa por
    // comprobante; el importe es el de la boleta. Las notas de crédito restan.
    const porComp = new Map<string, Comprobante & { esNC: boolean }>();
    const ncNorms = new Set<string>();
    for (let i = 1; i < filas.length; i++) {
      const f = filas[i]; if (!f) continue;
      if (!String(f[iCta] ?? "").trim().startsWith("12")) continue; // solo cuentas por cobrar
      const doc = iNro >= 0 ? String(f[iNro] ?? "").trim() : "";
      if (!pareceComprobante(doc)) continue; // debe ser una boleta/factura (B001…, F001…)
      const imp = Math.abs(num(f[iImp])); if (!imp) continue;
      const nk = normComp(doc);
      const esNC = iTD >= 0 && esNotaCredito(f[iTD]);
      if (esNC) ncNorms.add(nk);
      const prev = porComp.get(nk);
      if (prev) { prev.total = r2(prev.total + imp); prev.esNC = prev.esNC || esNC; }
      else porComp.set(nk, {
        comprobante: doc,
        norm: nk,
        fecha: iFe >= 0 ? String(f[iFe] ?? "").trim() : "",
        tipoDoc: esNC ? "NC" : (iTD >= 0 ? String(f[iTD] ?? "").trim() : ""),
        ruc: (iRuc >= 0 && String(f[iRuc] ?? "").trim()) || (iCod >= 0 ? String(f[iCod] ?? "").trim() : ""),
        cliente: (iRazon >= 0 && String(f[iRazon] ?? "").trim()) || (iGlosaMov >= 0 ? String(f[iGlosaMov] ?? "").trim() : ""),
        total: r2(imp), esNC,
      });
    }
    for (const c of porComp.values()) {
      const { esNC, ...comp } = c;
      if (esNC) comp.total = r2(-comp.total); // NC → ingreso negativo
      agregarComp(acc, key, label, comp);
    }
    if (stats) stats.caja += ncNorms.size;
    if (!acc[key]) acc[key] = { key, label, total: 0, comprobantes: [] };
  }
  return acc;
}

/** Detecta la fila de cabecera del formato REPORTE (Comprobante + Total +
 *  Empresa/Comisión/Fecha Pago). Devuelve -1 si no es ese formato. */
function filaCabeceraReporte(filas: any[][]): number {
  return filas.findIndex((f) => {
    const hh = (f ?? []).map((c) => String(c).toUpperCase().replace(/\s+/g, " ").trim());
    return hh.includes("COMPROBANTE") && hh.includes("TOTAL") && hh.some((h) => /EMPRESA|FECHA PAGO|COMISION/.test(h));
  });
}

/** Formato REPORTE (una fila por comprobante, con Empresa, Comprobante, Comisión
 *  y Total). El ingreso = columna **Total** (la comisión NO se resta). Agrupa por
 *  la columna Empresa; salta el pie ("Tiene N Facturas") y las notas de crédito /
 *  devoluciones. Sirve tanto para la Caja Virtual como para el slot StarSoft. */
function parseReporteVentas(
  acc: Record<string, IngresoEmpresa>, nombre: string, filas: any[][], hRow: number,
  stats?: StatsExcluidos, fuente: "starsoft" | "caja" = "caja",
) {
  const H = filas[hRow].map((c) => String(c).toUpperCase().replace(/\s+/g, " ").trim());
  const iEmp = H.findIndex((h) => /^EMPRESA$/.test(h));
  const iComp = H.findIndex((h) => /^COMPROBANTE$/.test(h));
  const iTot = H.findIndex((h) => /^TOTAL$/.test(h));
  const iCom = H.findIndex((h) => /COMISION/.test(h));       // se ignora en la suma
  const iTPago = H.findIndex((h) => /^TIPO PAGO$/.test(h));
  const iTComp = H.findIndex((h) => /^TIPO COMPROBANTE$/.test(h));
  const iFP = H.findIndex((h) => /^FECHA PAGO$/.test(h));
  const iNroDoc = H.findIndex((h) => /^NRO\.? DOCUMENTO$/.test(h)); // doc del cliente (DNI/RUC)
  const iContra = H.findIndex((h) => /^CONTRATANTE$/.test(h));
  const iSede = H.findIndex((h) => /^SEDE$/.test(h)); // categoría: POLICLINICO / ESCUELA
  if (iComp < 0 || iTot < 0) return;

  const empresaArch = empresaDeNombre(nombre); // respaldo si no hay col Empresa
  const seen = new Map<string, Set<string>>(); // empresaKey → comprobantes vistos
  for (let i = hRow + 1; i < filas.length; i++) {
    const f = filas[i]; if (!f) continue;
    const comp = String(f[iComp] ?? "").trim();
    if (!comp) continue; // fila vacía o pie ("Tiene N Facturas" no trae comprobante)
    // Las notas de crédito / devoluciones SÍ se consideran: en el REPORTE su Total
    // ya viene en negativo, así que se suman tal cual.
    const tp = String(iTPago >= 0 ? f[iTPago] : "").toUpperCase();
    const tc = iTComp >= 0 ? f[iTComp] : "";
    if ((esNotaCredito(tc) || /NOTA\s*CR[EÉ]DITO|DEVOLUC|^DEV\b|DEV\./.test(tp)) && stats) stats[fuente]++;

    const empRaw = iEmp >= 0 ? String(f[iEmp] ?? "").trim() : "";
    // El nombre del archivo manda; la columna Empresa es respaldo (multi-empresa).
    const empresa = empresaArch || (empRaw && !esNombreGenerico(empRaw) ? empRaw : "");
    const key = empresa ? (normEmpresa(empresa) || empresa.toUpperCase().trim()) : SIN_EMPRESA;
    const label = empresa || "Caja (empresa no identificada)";

    const nk = normComp(comp);
    let vistos = seen.get(key); if (!vistos) { vistos = new Set(); seen.set(key, vistos); }
    if (nk && vistos.has(nk)) continue; // no duplicar el mismo comprobante
    if (nk) vistos.add(nk);

    agregarComp(acc, key, label, {
      comprobante: comp,
      norm: nk,
      fecha: iFP >= 0 ? String(f[iFP] ?? "").trim() : "",
      tipoDoc: iTComp >= 0 ? String(f[iTComp] ?? "").trim() : "",
      ruc: iNroDoc >= 0 ? String(f[iNroDoc] ?? "").trim() : "",
      cliente: iContra >= 0 ? String(f[iContra] ?? "").trim() : "",
      total: r2(num(f[iTot])), // Total (bruto). La comisión (col iCom) NO se resta.
      categoria: iSede >= 0 ? catDeSede(f[iSede]) : "",
    });
  }
}

// ---- Emparejamiento tolerante de empresas ----------------------------------
// El extracto del banco puede escribir la empresa distinto al nombre del archivo
// ("BREVETES APURIMAC" vs "BREVETE APURIMC"). Emparejamos por SIMILITUD (Dice de
// bigramas) con umbral alto, para no confundir "SAN CRISTOBAL" con "SAN
// CRISTOBAL VIP" (que difieren en un token completo).
function similitud(a: string, b: string): number {
  const bg = (s: string) => { const t = s.replace(/\s+/g, ""); const set = new Set<string>(); for (let i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 2)); return set; };
  if (a === b) return 1;
  const A = bg(a), B = bg(b); if (!A.size || !B.size) return 0;
  let inter = 0; for (const x of A) if (B.has(x)) inter++;
  return (2 * inter) / (A.size + B.size);
}
/** Mejor candidato para `target` entre `cands` (claves normalizadas). Exacto si
 *  existe; si no, el más parecido por encima del umbral. */
function mejorMatch(target: string, cands: string[], min = 0.78): string | null {
  if (cands.includes(target)) return target;
  let best: string | null = null, bs = min;
  for (const c of cands) { const s = similitud(target, c); if (s > bs) { bs = s; best = c; } }
  return best;
}

// ---- Ensamblado ------------------------------------------------------------
export function armarComparativo(
  banco: FuenteArchivo[],
  starsoft: FuenteArchivo[],
  caja: FuenteArchivo[],
): { resultado: ResultadoComparativo; eecc: Record<string, IngresoEmpresa>; std: Record<string, IngresoEmpresa>; cja: Record<string, IngresoEmpresa> } {
  const stats: StatsExcluidos = { starsoft: 0, caja: 0 };
  const eecc = ingresosBanco(banco);
  const std = ingresosStarsoft(starsoft, stats);
  const cja = ingresosCaja(caja, stats);
  const avisos: string[] = [];
  if (stats.starsoft || stats.caja) {
    avisos.push(`Se consideraron las notas de crédito (restan del ingreso): ${stats.starsoft} en StarSoft, ${stats.caja} en Caja.`);
  }

  // Empresas REALES identificadas en los documentos (StarSoft / Caja).
  const realDoc = new Set<string>([...Object.keys(std), ...Object.keys(cja)].filter((k) => k !== SIN_EMPRESA));

  // Un documento cuya empresa no se identificó por el nombre (p. ej. Caja Virtual
  // sin "caja - empresa - periodo"): si hay UNA sola empresa objetivo, se le
  // atribuye; si no, se avisa y se deja aparte (para no inventar "Caja Virtual").
  const reasignarSin = (acc: Record<string, IngresoEmpresa>, tipo: string) => {
    const sin = acc[SIN_EMPRESA];
    if (!sin) return;
    const targets = [...realDoc].filter((k) => k !== SIN_EMPRESA);
    if (targets.length === 1) {
      const k = targets[0];
      const prev = acc[k];
      acc[k] = {
        key: k, label: prev?.label ?? k, total: r2((prev?.total ?? 0) + sin.total), detalle: prev?.detalle,
        comprobantes: [...(prev?.comprobantes ?? []), ...(sin.comprobantes ?? [])],
      };
      delete acc[SIN_EMPRESA];
    } else {
      avisos.push(`El archivo de ${tipo} no tiene la empresa en el nombre; nómbralo "${tipo.toLowerCase()} - empresa - periodo".`);
    }
  };
  reasignarSin(cja, "Caja");
  reasignarSin(std, "StarSoft");

  // El comparativo lo MANDA la empresa del documento (StarSoft / Caja): el
  // extracto bancario es un solo Excel con MUCHAS empresas, pero solo queremos
  // ver la(s) empresa(s) cuyos documentos subió el usuario. Si no subió ninguno
  // (solo banco), mostramos todas las del banco.
  const keysDoc = new Set<string>([...Object.keys(std), ...Object.keys(cja)]);
  const keys = keysDoc.size ? keysDoc : new Set<string>(Object.keys(eecc));
  const label = (k: string) => std[k]?.label ?? cja[k]?.label ?? eecc[k]?.label ?? k;

  // El banco escribe la empresa a su manera; empareja cada empresa-documento con
  // la del banco por similitud (exacto o parecido) para que caigan en la misma fila.
  const eeccKeys = Object.keys(eecc);
  const eeccMatch: Record<string, string | null> = {};
  for (const k of keys) eeccMatch[k] = eecc[k] ? k : mejorMatch(k, eeccKeys);
  const eeccDe = (k: string) => { const m = eeccMatch[k]; return m ? eecc[m] : undefined; };

  // Sub-filas por CATEGORÍA (p. ej. MI BREVETE SEGURO: Policlínico / Escuela).
  // La categoría de StarSoft viene de la "Sede"; la de la caja se hereda por
  // boleta (mismo comprobante) desde StarSoft. El banco no tiene categoría.
  const catLabel = (c: string) => c === "POLICLINICO" ? "Policlínico" : c === "ESCUELA" ? "Escuela" : c;
  const subfilasDe = (k: string): FilaComparativo[] => {
    const s = std[k]?.comprobantes ?? [];
    const c = cja[k]?.comprobantes ?? [];
    const stdCatMap = new Map<string, string>();
    for (const x of s) if (x.categoria && x.norm) stdCatMap.set(x.norm, x.categoria);
    const catOf = (x: Comprobante) => x.categoria || (x.norm ? stdCatMap.get(x.norm) : "") || "";
    const cats = new Set<string>();
    for (const x of s) if (x.categoria) cats.add(x.categoria);
    for (const x of c) { const cc = catOf(x); if (cc) cats.add(cc); }
    if (!cats.size) return [];
    const orden = ["POLICLINICO", "ESCUELA", ...[...cats].filter((x) => x !== "POLICLINICO" && x !== "ESCUELA")];
    const rows: FilaComparativo[] = [];
    for (const cat of orden) {
      if (!cats.has(cat)) continue;
      const sc = s.filter((x) => (x.categoria || "") === cat);
      const cc = c.filter((x) => catOf(x) === cat);
      rows.push({
        empresa: `${label(k)} — ${catLabel(cat)}`, eecc: null,
        starsoft: sc.length ? r2(sc.reduce((a, x) => a + x.total, 0)) : null,
        caja: cc.length ? r2(cc.reduce((a, x) => a + x.total, 0)) : null,
        detalleEecc: "",
      });
    }
    // Residual sin categoría (p. ej. VISA en bloque de la caja que no cruzó boleta).
    const scSin = s.filter((x) => !x.categoria);
    const ccSin = c.filter((x) => !catOf(x));
    if (scSin.length || ccSin.length) {
      const st = scSin.reduce((a, x) => a + x.total, 0), ct = ccSin.reduce((a, x) => a + x.total, 0);
      if (Math.abs(st) >= 0.5 || Math.abs(ct) >= 0.5)
        rows.push({ empresa: `${label(k)} — Sin categoría`, eecc: null, starsoft: scSin.length ? r2(st) : null, caja: ccSin.length ? r2(ct) : null, detalleEecc: "" });
    }
    return rows;
  };

  const filas: FilaComparativo[] = [...keys]
    .sort((a, b) => label(a).localeCompare(label(b)))
    .flatMap((k) => [
      { empresa: label(k), eecc: eeccDe(k)?.total ?? null, starsoft: std[k]?.total ?? null, caja: cja[k]?.total ?? null, detalleEecc: eeccDe(k)?.detalle ?? "" },
      ...subfilasDe(k),
    ]);

  if (!Object.keys(std).length && !Object.keys(cja).length && !Object.keys(eecc).length) {
    avisos.push("No se detectaron ingresos en ninguna fuente. Revisa que los Excel sean los correctos.");
  }
  // Empresas del documento que no se encontraron en el extracto bancario (ni exacto ni parecido).
  for (const k of keysDoc) {
    if (k === SIN_EMPRESA) continue;
    if (eeccKeys.length && !eeccMatch[k]) avisos.push(`"${label(k)}" no se encontró en el extracto bancario (revisa el nombre de la empresa).`);
  }
  // empresas que solo aparecen en una fuente → no se pueden conciliar (sin sub-filas)
  for (const f of filas) {
    if (f.empresa.includes(" — ")) continue; // sub-fila por categoría
    const presentes = [f.eecc, f.starsoft, f.caja].filter((v) => v != null).length;
    if (presentes === 1) avisos.push(`"${f.empresa}" solo aparece en una fuente (no se puede cruzar).`);
  }

  // ---- Detalle POR COMPROBANTE (StarSoft vs Caja Virtual) ----
  // El banco (EECC) son depósitos, no comprobantes, por eso el detalle fino
  // cruza StarSoft ↔ Caja comprobante por comprobante (por N° normalizado).
  const detalle: DetalleComprobante[] = [];
  for (const k of keys) {
    if (k === SIN_EMPRESA) continue;
    const emp = label(k);
    const sComps = std[k]?.comprobantes ?? [];
    const cComps = cja[k]?.comprobantes ?? [];
    if (!sComps.length && !cComps.length) continue;
    const cMap = new Map<string, Comprobante>();
    for (const c of cComps) if (c.norm) cMap.set(c.norm, cMap.has(c.norm) ? { ...c, total: r2(cMap.get(c.norm)!.total + c.total) } : c);
    const stdCatMap = new Map<string, string>();
    for (const x of sComps) if (x.categoria && x.norm) stdCatMap.set(x.norm, x.categoria);
    const usadosCaja = new Set<string>();
    for (const s of sComps) {
      const c = s.norm ? cMap.get(s.norm) : undefined;
      if (c) usadosCaja.add(s.norm);
      const cajaTot = c ? c.total : null;
      const d = cajaTot != null ? r2(s.total - cajaTot) : null;
      const estado = cajaTot == null ? "Solo StarSoft" : (Math.abs(d ?? 0) < 0.5 ? "Cuadra" : "Difiere");
      detalle.push({
        empresa: emp, compStarsoft: s.comprobante, compCaja: c?.comprobante ?? "",
        fecha: s.fecha || c?.fecha || "", tipoDoc: s.tipoDoc,
        ruc: s.ruc || c?.ruc || "", cliente: s.cliente || c?.cliente || "",
        starsoft: s.total, caja: cajaTot, dif: d, estado, categoria: s.categoria || c?.categoria || "",
      });
    }
    // Comprobantes que solo están en Caja.
    for (const c of cComps) {
      if (!c.norm || usadosCaja.has(c.norm)) continue;
      detalle.push({
        empresa: emp, compStarsoft: "", compCaja: c.comprobante, fecha: c.fecha, tipoDoc: c.tipoDoc,
        ruc: c.ruc, cliente: c.cliente, starsoft: null, caja: c.total, dif: null, estado: "Solo Caja",
        categoria: c.categoria || stdCatMap.get(c.norm) || "",
      });
    }
  }
  detalle.sort((a, b) => a.empresa.localeCompare(b.empresa) || (a.compStarsoft || a.compCaja).localeCompare(b.compStarsoft || b.compCaja));

  return {
    resultado: { filas, detalle, fuentes: { eecc: banco.length, starsoft: starsoft.length, caja: caja.length }, avisos },
    eecc, std, cja,
  };
}

// ---- Excel de salida -------------------------------------------------------
export async function excelComparativoIngresos(res: ResultadoComparativo): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Radar Tributar IA";
  const AMBER = "FFB45309";
  const money = "#,##0.00;[Red]-#,##0.00";

  // ---------- Hoja 1: Ingresos por fuente ----------
  const s1 = wb.addWorksheet("Ingresos por fuente");
  s1.columns = [
    { header: "Empresa", key: "empresa", width: 34 },
    { header: "EECC (banco, abonos)", key: "eecc", width: 20 },
    { header: "StarSoft (ventas)", key: "starsoft", width: 18 },
    { header: "Caja Virtual", key: "caja", width: 16 },
    { header: "Máx − Mín", key: "spread", width: 14 },
    { header: "¿Coinciden?", key: "ok", width: 14 },
  ];
  let tE = 0, tS = 0, tC = 0;
  for (const f of res.filas) {
    const esSub = f.empresa.includes(" — "); // sub-fila por categoría
    const vals = [f.eecc, f.starsoft, f.caja].filter((v): v is number => v != null);
    const spread = vals.length >= 2 ? r2(Math.max(...vals) - Math.min(...vals)) : 0;
    const ok = vals.length >= 2 ? (Math.abs(spread) < 0.5 ? "✔ Sí" : "✗ No") : "—";
    const row = s1.addRow({ empresa: esSub ? `    ${f.empresa}` : f.empresa, eecc: f.eecc ?? "", starsoft: f.starsoft ?? "", caja: f.caja ?? "", spread: vals.length >= 2 ? spread : "", ok });
    ["eecc", "starsoft", "caja", "spread"].forEach((k) => (row.getCell(k).numFmt = money));
    if (esSub) row.getCell("empresa").font = { italic: true, color: { argb: "FF64748B" } };
    if (vals.length >= 2 && Math.abs(spread) >= 0.5) {
      row.getCell("spread").font = { color: { argb: AMBER }, bold: true };
      row.getCell("ok").font = { color: { argb: AMBER }, bold: true };
    }
    if (!esSub) { tE += f.eecc ?? 0; tS += f.starsoft ?? 0; tC += f.caja ?? 0; } // el TOTAL no cuenta las sub-filas
  }
  const tot = s1.addRow({ empresa: "TOTAL", eecc: r2(tE), starsoft: r2(tS), caja: r2(tC), spread: "", ok: "" });
  tot.font = { bold: true };
  ["eecc", "starsoft", "caja"].forEach((k) => (tot.getCell(k).numFmt = money));

  // ---------- Hoja 2: DETALLE POR COMPROBANTE (StarSoft vs Caja Virtual) ----------
  const sDet = wb.addWorksheet("Detalle por comprobante");
  sDet.columns = [
    { header: "Empresa", key: "empresa", width: 28 },
    { header: "Comprob. StarSoft", key: "cS", width: 18 },
    { header: "Comprob. Caja", key: "cC", width: 18 },
    { header: "¿Match?", key: "match", width: 9 },
    { header: "Fecha", key: "fecha", width: 11 },
    { header: "T/D", key: "td", width: 6 },
    { header: "RUC/DNI", key: "ruc", width: 13 },
    { header: "Cliente", key: "cliente", width: 32 },
    { header: "Categoría", key: "categoria", width: 13 },
    { header: "Total StarSoft", key: "starsoft", width: 14 },
    { header: "Total Caja", key: "caja", width: 13 },
    { header: "Diferencia", key: "dif", width: 13 },
    { header: "Estado", key: "estado", width: 16 },
  ];
  const ESTADO_COLOR: Record<string, string> = { "Difiere": AMBER, "Solo StarSoft": "FFB91C1C", "Solo Caja": "FFB91C1C" };
  let dS = 0, dC = 0;
  for (const d of res.detalle) {
    const match = d.compStarsoft && d.compCaja ? "✔" : "✗";
    const row = sDet.addRow({
      empresa: d.empresa, cS: d.compStarsoft || "—", cC: d.compCaja || "—", match,
      fecha: d.fecha, td: d.tipoDoc, ruc: d.ruc, cliente: d.cliente, categoria: d.categoria || "",
      starsoft: d.starsoft ?? "", caja: d.caja ?? "", dif: d.dif ?? "", estado: d.estado,
    });
    ["starsoft", "caja", "dif"].forEach((k) => (row.getCell(k).numFmt = money));
    row.getCell("match").alignment = { horizontal: "center" };
    row.getCell("match").font = { color: { argb: match === "✔" ? "FF15803D" : "FFB91C1C" }, bold: true };
    const col = ESTADO_COLOR[d.estado];
    if (col) { row.getCell("estado").font = { color: { argb: col }, bold: true }; if (d.dif != null) row.getCell("dif").font = { color: { argb: col }, bold: true }; }
    dS += d.starsoft ?? 0; dC += d.caja ?? 0;
  }
  if (res.detalle.length) {
    const t = sDet.addRow({ empresa: "TOTAL", cS: "", cC: "", match: "", fecha: "", td: "", ruc: "", cliente: `${res.detalle.length} comprobante(s)`, starsoft: r2(dS), caja: r2(dC), dif: r2(dS - dC), estado: "" });
    t.font = { bold: true };
    ["starsoft", "caja", "dif"].forEach((k) => (t.getCell(k).numFmt = money));
  } else {
    sDet.addRow({ empresa: "Sin comprobantes para cruzar (sube StarSoft y/o Caja Virtual con detalle).", cS: "" });
  }

  // ---------- Hoja 3: Resumen Ventas (StarSoft) vs Caja ----------
  // Conteos y montos del cruce comprobante a comprobante (como el módulo
  // "Ventas vs Caja"): cuántas ventas del libro se cobraron en caja y el faltante.
  const sVC = wb.addWorksheet("Resumen Ventas vs Caja");
  sVC.columns = [{ width: 40 }, { width: 18 }];
  {
    const D = res.detalle;
    const ventasTotal = D.filter((d) => d.starsoft != null).length;
    const cajaTotal = D.filter((d) => d.caja != null).length;
    const matched = D.filter((d) => d.starsoft != null && d.caja != null);
    const conciliados = matched.length;
    const conDiferencia = D.filter((d) => d.estado === "Difiere").length;
    const faltanEnCaja = D.filter((d) => d.estado === "Solo StarSoft").length;
    const cajaSinVenta = D.filter((d) => d.estado === "Solo Caja").length;
    const montoVentas = r2(D.reduce((a, d) => a + (d.starsoft ?? 0), 0));
    const montoConciliado = r2(matched.reduce((a, d) => a + (d.starsoft ?? 0), 0));
    const montoFaltante = r2(D.filter((d) => d.estado === "Solo StarSoft").reduce((a, d) => a + (d.starsoft ?? 0), 0));
    const filasVC: [string, number][] = [
      ["Ventas (libro)", ventasTotal],
      ["Pagos en caja", cajaTotal],
      ["Conciliados", conciliados],
      ["  · con diferencia de monto", conDiferencia],
      ["Faltan en caja (ventas sin cobro)", faltanEnCaja],
      ["En caja sin venta (fact/bol)", cajaSinVenta],
      ["Monto total ventas (S/)", montoVentas],
      ["Monto conciliado (S/)", montoConciliado],
      ["Monto faltante en caja (S/)", montoFaltante],
    ];
    for (const [k, v] of filasVC) {
      const row = sVC.addRow([k, v]);
      if (/S\//.test(k)) row.getCell(2).numFmt = money;
      if (/^Faltan|^En caja sin|^Monto faltante/.test(k) && v) { row.getCell(2).font = { color: { argb: AMBER }, bold: true }; }
    }
  }

  // ---------- Hoja 4: Conciliación por empresa (resumen entre fuentes) ----------
  const s2 = wb.addWorksheet("Conciliación (resumen)");
  s2.columns = [
    { header: "Empresa", key: "empresa", width: 34 },
    { header: "EECC (banco)", key: "eecc", width: 15 },
    { header: "Cuentas banco", key: "ctas", width: 26 },
    { header: "StarSoft (ventas)", key: "starsoft", width: 16 },
    { header: "EECC − StarSoft", key: "d1", width: 16 },
    { header: "Caja Virtual", key: "caja", width: 15 },
    { header: "EECC − Caja", key: "d2", width: 16 },
    { header: "StarSoft − Caja", key: "d3", width: 16 },
    { header: "Observación", key: "obs", width: 42 },
  ];
  const dif = (a: number | null, b: number | null): number | "" => (a != null && b != null ? r2(a - b) : "");
  for (const f of res.filas) {
    const d1 = dif(f.eecc, f.starsoft), d2 = dif(f.eecc, f.caja), d3 = dif(f.starsoft, f.caja);
    const flags: string[] = [];
    if (typeof d1 === "number" && Math.abs(d1) >= 0.5) flags.push("EECC≠StarSoft");
    if (typeof d2 === "number" && Math.abs(d2) >= 0.5) flags.push("EECC≠Caja");
    if (typeof d3 === "number" && Math.abs(d3) >= 0.5) flags.push("StarSoft≠Caja");
    const faltan = [f.eecc, f.starsoft, f.caja].filter((v) => v == null).length;
    const obs = faltan ? `Falta ${faltan} fuente(s)` : (flags.length ? flags.join(" · ") : "✔ Cuadra");
    const row = s2.addRow({ empresa: f.empresa, eecc: f.eecc ?? "", ctas: f.detalleEecc ?? "", starsoft: f.starsoft ?? "", d1, caja: f.caja ?? "", d2, d3, obs });
    ["eecc", "starsoft", "d1", "caja", "d2", "d3"].forEach((k) => (row.getCell(k).numFmt = money));
    (["d1", "d2", "d3"] as const).forEach((k) => {
      const v = row.getCell(k).value;
      if (typeof v === "number" && Math.abs(v) >= 0.5) row.getCell(k).font = { color: { argb: AMBER }, bold: true };
    });
    if (flags.length) row.getCell("obs").font = { color: { argb: AMBER }, bold: true };
  }

  // Encabezado azul en las hojas con cabecera de columnas (sVC es lista k/v).
  for (const s of [s1, sDet, s2]) {
    s.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A8A" } };
    s.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    s.views = [{ state: "frozen", ySplit: 1 }];
  }
  const ab = await wb.xlsx.writeBuffer();
  return Buffer.from(ab);
}
