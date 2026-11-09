// ============================================================
//  Conciliación SIRE vs contabilidad, POR EMPRESA (análisis RTP)
// ============================================================
// VENTAS: SIRE RVIE  vs  Registro de Ventas del sistema contable (Excel con una
//         pestaña por empresa: Fecha · [T/D] · Documento "B002 0005839" · R.U.C.
//         · Nombre · Afecto · Inafecto · IGV e IPM · Otros · Total …; el RUC de la
//         empresa va en la fila 2). Se empareja por TIPO + SERIE + NÚMERO (las
//         notas de crédito pueden usar la misma serie que las boletas/facturas) y
//         se compara base, IGV, no gravadas, total y fecha.
// COMPRAS: SIRE RCE  vs  Libro Diario (el mismo del análisis de egresos). Cada
//         comprobante contabilizado (movimientos con el mismo "Documento" que
//         tienen cuenta por pagar 42/46) se empareja por serie + número + RUC
//         del proveedor:
//   Documento "FTF00167214" = tipo (FT) + serie (F001) + número (67214)
//   Anexo     "0320605162682" = prefijo + RUC del proveedor (últimos 11 dígitos)
//   Total = Haber − Debe de la 42/46 · IGV = Debe − Haber de la 4011
//   Base  = Debe − Haber del resto (6x, 33…), sin 9x ni 79 (analítica); si el
//           asiento no tiene esa línea (va directo a la 9x), la base es la 9x.
// El motor de comparación es el de `cruceSire.ts`.

import ExcelJS from "exceljs";
import { parseSireCompras, parseSireVentas, cruzarLibro, esMonedaExtranjera, type CompNorm, type CruceLibro, type TipoLibro } from "./cruceSire";
import type { MovDiario } from "./analisisCompras";
import { esZipContenedor, extraerDeZip } from "./zip";

const r2 = (n: number) => Math.round(n * 100) / 100;
const sinCerosIzq = (s: string) => s.replace(/^0+/, "") || "0";

/** Prefijo del Documento del Diario → tipo de comprobante SUNAT (tabla 10). */
const TIPO_PREFIJO: Record<string, string> = {
  FT: "1", FA: "1", BV: "3", BO: "3", LC: "4", NC: "7", ND: "8", RC: "14", RS: "14", TK: "12", DU: "50", DS: "91",
};

export interface ExcluidosDiario {
  /** Recibos por honorarios (no van al RCE). */
  honorarios: number;
  /** Documentos sin RUC de proveedor legible en el anexo. */
  sinRuc: number;
}

/** Comprobantes de compra del Libro Diario de UNA empresa, en el formato del cruce. */
export function diarioAComprobantes(movs: MovDiario[]): { comprobantes: CompNorm[]; documento: Map<string, string>; excluidos: ExcluidosDiario } {
  const porDoc = new Map<string, MovDiario[]>();
  for (const m of movs) {
    const d = (m.documento || "").trim().toUpperCase().replace(/\s+/g, "");
    if (!d) continue;
    (porDoc.get(d) ?? porDoc.set(d, []).get(d)!).push(m);
  }
  const comprobantes: CompNorm[] = [];
  const documento = new Map<string, string>(); // clave → documento original del Diario
  const excluidos: ExcluidosDiario = { honorarios: 0, sinRuc: 0 };
  for (const [doc, ms] of Array.from(porDoc.entries())) {
    const porPagar = ms.filter((m) => /^4[26]/.test(m.cuenta));
    if (!porPagar.length) continue; // no es una compra (planilla, provisión…)
    const prefijo = doc.slice(0, 2);
    if (prefijo === "RH") { excluidos.honorarios++; continue; }
    const anexo = (porPagar.find((m) => m.anexo)?.anexo || ms.find((m) => m.anexo)?.anexo || "").replace(/\D/g, "");
    const ruc = anexo.length >= 11 ? anexo.slice(-11) : "";
    if (!/^(10|15|16|17|20)\d{9}$/.test(ruc)) { excluidos.sinRuc++; continue; }
    const resto = doc.slice(2);
    const serie = sinCerosIzq(resto.slice(0, 4));
    const numero = sinCerosIzq(resto.slice(4).replace(/\D/g, ""));
    let total = 0, igv = 0, base = 0, base9 = 0, lineasBase = 0;
    for (const m of ms) {
      if (/^4[26]/.test(m.cuenta)) total += m.haber - m.debe;
      else if (m.cuenta.startsWith("4011")) igv += m.debe - m.haber;
      else if (m.cuenta.startsWith("9")) base9 += m.debe - m.haber;
      else if (m.cuenta.startsWith("79") || m.cuenta.startsWith("40")) continue;
      else { base += m.debe - m.haber; lineasBase++; }
    }
    // Algunos asientos van directo a la clase 9 (sin la 6): la base sale de ahí.
    if (!lineasBase) base = base9;
    total = r2(total); igv = r2(igv); base = r2(base);
    const clave = `${serie}|${numero}|${ruc}`;
    documento.set(clave, doc);
    comprobantes.push({
      clave,
      tipoDoc: TIPO_PREFIJO[prefijo] ?? prefijo,
      serie, numero,
      rucContraparte: ruc,
      razonSocial: "",
      fecha: ms.find((m) => m.fecDoc)?.fecDoc || ms[0].fecReg || "",
      baseGravada: base,
      igv,
      noGravado: r2(total - base - igv),
      total,
      moneda: "PEN",
      tipoCambio: 0,
    });
  }
  return { comprobantes, documento, excluidos };
}

// ---- Registro de Ventas del sistema contable --------------------------------

const claveVenta = (tipo: string, serie: string, numero: string) => `${sinCerosIzq(String(tipo).replace(/\D/g, ""))}|${serie}|${numero}`;
const numCel = (v: unknown) => { const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/[^\d.-]/g, "")); return Number.isFinite(n) ? r2(n) : 0; };
function fechaCel(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const t = String(v ?? "").trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return "";
}

export interface RegistroVentasHoja { hoja: string; empresa: string; ruc: string; comprobantes: CompNorm[] }

/** Lee el Registro de Ventas contable: una pestaña por empresa (empresa en A1, RUC en la fila 2). */
export async function parseRegistroVentasHojas(buf: Buffer): Promise<RegistroVentasHoja[]> {
  const out: RegistroVentasHoja[] = [];
  for (const { hoja, rows } of await hojasXlsx(buf)) {
    const ih = rows.slice(0, 20).findIndex((r) => { const h = r.map(normH); return h.includes("documento") && h.some((x) => x.startsWith("afecto")) && h.includes("total"); });
    if (ih < 0) continue;
    const h = rows[ih].map(normH);
    const col = (pred: (x: string) => boolean) => h.findIndex(pred);
    const cFecha = col((x) => x === "fecha"), cTipo = col((x) => x.includes("t/d")), cDoc = col((x) => x === "documento");
    const cRuc = col((x) => x.includes("r.u.c") || x === "ruc"), cNom = col((x) => x.includes("nombre") || x.includes("razon"));
    const cAfecto = col((x) => x.startsWith("afecto")), cIgv = col((x) => x.startsWith("igv")), cTotal = col((x) => x === "total");
    const empresa = String(rows[0]?.find((c) => String(c ?? "").trim()) ?? hoja).trim();
    const ruc = (rows.slice(0, ih).flat().map((c) => String(c ?? "").replace(/\D/g, "")).find((x) => /^(10|15|16|17|20)\d{9}$/.test(x))) ?? "";
    const comprobantes: CompNorm[] = [];
    for (const r of rows.slice(ih + 1)) {
      const doc = String(r[cDoc] ?? "").trim().toUpperCase();
      if (!doc) continue; // vacías y "Total Ventas"
      const partes = doc.split(/[\s-]+/).filter(Boolean);
      const serie = sinCerosIzq(partes.length > 1 ? partes[0] : doc.slice(0, 4));
      const numero = sinCerosIzq((partes.length > 1 ? partes.slice(1).join("") : doc.slice(4)).replace(/\D/g, ""));
      const tipo = sinCerosIzq(String(r[cTipo] ?? "").replace(/\D/g, ""));
      const base = numCel(r[cAfecto]), igv = numCel(r[cIgv]), total = numCel(r[cTotal]);
      comprobantes.push({
        clave: claveVenta(tipo, serie, numero), tipoDoc: tipo, serie, numero,
        rucContraparte: String(r[cRuc] ?? "").replace(/\D/g, ""),
        razonSocial: String(r[cNom] ?? "").trim(),
        fecha: fechaCel(r[cFecha]),
        baseGravada: base, igv, noGravado: r2(total - base - igv), total,
        moneda: "PEN", tipoCambio: 0,
      });
    }
    if (comprobantes.length) out.push({ hoja, empresa, ruc, comprobantes });
  }
  return out;
}

// ---- Lectura de los SIRE -----------------------------------------------------

export interface SireLeido {
  id: string;            // "<nº archivo>:<hoja>"
  libro: TipoLibro;      // ventas (RVIE) o compras (RCE)
  nombre: string;        // archivo (y hoja)
  ruc: string;           // RUC de la empresa (adquiriente)
  razonSocial: string;
  periodo: string;
  comprobantes: CompNorm[];
}

const normH = (v: unknown) => String(v ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/** Matriz de filas que empieza en el encabezado del SIRE (o null si no lo es). */
function desdeEncabezado(rows: unknown[][]): unknown[][] | null {
  const i = rows.slice(0, 30).findIndex((r) => r.some((c) => normH(c).includes("serie del cdp")));
  return i >= 0 ? rows.slice(i) : null;
}

function filasTexto(txt: string): unknown[][] {
  const lineas = txt.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  const sep = lineas[0]?.includes("|") ? "|" : lineas[0]?.includes(";") ? ";" : lineas[0]?.includes("\t") ? "\t" : ",";
  return lineas.map((l) => l.split(sep).map((c) => c.trim().replace(/^"|"$/g, "")));
}

async function hojasXlsx(buf: Buffer): Promise<{ hoja: string; rows: unknown[][] }[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const out: { hoja: string; rows: unknown[][] }[] = [];
  for (const ws of wb.worksheets) {
    if (ws.state && ws.state !== "visible") continue;
    const rows: unknown[][] = [];
    const maxCol = ws.columnCount;
    ws.eachRow({ includeEmpty: true }, (row) => {
      const arr: unknown[] = [];
      for (let c = 1; c <= maxCol; c++) {
        let v = row.getCell(c).value as unknown;
        if (v && typeof v === "object" && !(v instanceof Date)) {
          const o = v as Record<string, unknown>;
          v = "result" in o ? o.result : "text" in o ? o.text : Array.isArray(o.richText) ? (o.richText as { text: string }[]).map((t) => t.text).join("") : "";
        }
        arr.push(v ?? "");
      }
      rows.push(arr);
    });
    out.push({ hoja: ws.name, rows });
  }
  return out;
}

/** Lee un archivo del SIRE (ventas RVIE o compras RCE): Excel (todas sus pestañas), TXT/CSV o ZIP de SUNAT. */
export async function leerSire(buf: Buffer, nombreArchivo: string, nArchivo: number): Promise<{ leidos: SireLeido[]; avisos: string[] }> {
  const avisos: string[] = [];
  const partes: { nombre: string; rows: unknown[][] }[] = [];
  const agregarArchivo = async (data: Buffer, nombre: string) => {
    if (/\.(txt|csv)$/i.test(nombre)) partes.push({ nombre, rows: filasTexto(data.toString("utf8")) });
    else {
      const hojas = await hojasXlsx(data);
      for (const h of hojas) partes.push({ nombre: hojas.length > 1 ? `${nombre} · ${h.hoja}` : nombre, rows: h.rows });
    }
  };
  if (esZipContenedor(buf, nombreArchivo)) {
    const internos = extraerDeZip(buf, [".xlsx", ".txt", ".csv"]);
    if (!internos.length) avisos.push(`"${nombreArchivo}": el ZIP no trae Excel ni TXT.`);
    for (const f of internos) await agregarArchivo(f.data, f.name);
  } else {
    await agregarArchivo(buf, nombreArchivo);
  }
  const leidos: SireLeido[] = [];
  partes.forEach((p, i) => {
    const r = sireDesdeFilas(p.rows, `${nArchivo}:${i}`, p.nombre);
    if (typeof r === "string") avisos.push(r);
    else leidos.push(r);
  });
  return { leidos, avisos };
}

/** SIRE ya descargado en el módulo Detalle SIRE (caché del cliente: columnas + filas). */
export function sireDesdeDetalle(bloque: { columnas: string[]; filas: string[][] }, id: string, nombre: string): SireLeido | string {
  return sireDesdeFilas([bloque.columnas, ...bloque.filas], id, nombre);
}

/** Convierte una matriz con encabezado SIRE (RVIE o RCE) en comprobantes listos para cruzar. */
function sireDesdeFilas(filas: unknown[][], id: string, nombre: string): SireLeido | string {
  {
    const p = { nombre, rows: filas };
    const rows = desdeEncabezado(p.rows);
    if (!rows) return `"${p.nombre}": no parece un SIRE (no tiene la columna "Serie del CDP").`;
    const h = rows[0].map(normH);
    const libro: TipoLibro = h.some((x) => x === "bi gravada") && !h.some((x) => x.startsWith("bi gravado")) ? "ventas" : "compras";
    const s = libro === "ventas" ? parseSireVentas(rows) : parseSireCompras(rows);
    if (!s.comprobantes.length) return `"${p.nombre}": sin comprobantes.`;
    // Moneda extranjera: se lleva a soles con su tipo de cambio (el Diario está en S/).
    for (const c of s.comprobantes) {
      if (esMonedaExtranjera(c.moneda) && c.tipoCambio > 0) {
        c.baseGravada = r2(c.baseGravada * c.tipoCambio);
        c.igv = r2(c.igv * c.tipoCambio);
        c.noGravado = r2(c.noGravado * c.tipoCambio);
        c.total = r2(c.total * c.tipoCambio);
      }
      // Ventas: tipo + serie + número. Compras: serie + número + RUC (el Diario usa prefijos propios: FT, RC…).
      c.clave = libro === "ventas" ? claveVenta(c.tipoDoc, c.serie, c.numero) : `${c.serie}|${c.numero}|${c.rucContraparte}`;
    }
    return { id, libro, nombre: p.nombre, ruc: s.ruc ?? "", razonSocial: s.razonSocial ?? "", periodo: s.periodo ?? "", comprobantes: s.comprobantes };
  }
}

/** Periodo (AAAAMM) más frecuente en un conjunto de fechas "AAAA-MM-DD". */
export function periodoMasFrecuente(fechas: string[]): string {
  const cont = new Map<string, number>();
  for (const f of fechas) if (/^\d{4}-\d{2}/.test(f)) { const k = f.slice(0, 4) + f.slice(5, 7); cont.set(k, (cont.get(k) ?? 0) + 1); }
  let mejor = "", max = 0;
  for (const [k, n] of Array.from(cont.entries())) if (n > max) { max = n; mejor = k; }
  return mejor;
}

// ---- Conciliación por empresa ----------------------------------------------

export interface ConciliacionEmpresa {
  empresa: string;
  clave: string;
  libro: TipoLibro;
  ruc: string;
  periodo: string;
  archivosSire: string[];
  cruce: CruceLibro;
  excluidos: ExcluidosDiario;
  /** Emparejados por importe aunque serie/número no coincidan. */
  docDistinto: number;
  /** Cierre del periodo: vencimiento de la DJ mensual y tiempo para regularizar. */
  cierre?: import("./cronogramaSunat").CierrePeriodo | null;
  /** Comprobantes "solo SIRE" encontrados en un subdiario aparte (misceláneos). */
  subdiario?: { conciliados: number; conMontoDistinto: number; archivos: string[] };
}

/**
 * Concilia una empresa y un libro. Además del emparejamiento exacto, un segundo
 * paso para los sueltos: mismo total (±S/ 1) y misma contraparte (compras) o
 * mismo tipo y fecha (ventas). Suele ser el mismo comprobante con la serie o el
 * número digitado distinto en contabilidad.
 */
export function conciliar(libro: TipoLibro, empresa: string, clave: string, contable: CompNorm[], sires: SireLeido[], documento?: Map<string, string>, excluidos?: ExcluidosDiario): ConciliacionEmpresa {
  // Notas de crédito: siempre en negativo en ambos lados (cada sistema las
  // presenta con su propio signo; así no salen diferencias falsas).
  const signo = (c: CompNorm): CompNorm =>
    c.tipoDoc === "7" && c.total > 0
      ? { ...c, baseGravada: -c.baseGravada, igv: -c.igv, noGravado: -c.noGravado, total: -c.total }
      : { ...c };
  const cont = contable.map(signo);
  const sire = sires.flatMap((s) => s.comprobantes).map(signo);
  const clavesSire = new Set(sire.map((c) => c.clave));
  const clavesCont = new Set(cont.map((c) => c.clave));
  const sueltosSire = sire.filter((c) => !clavesCont.has(c.clave));
  const realineados = new Map<string, string>(); // clave SIRE → comprobante en contabilidad
  const mismo = (s: CompNorm, c: CompNorm) =>
    Math.abs(s.total - c.total) <= 1 &&
    (libro === "compras" ? s.rucContraparte === c.rucContraparte : s.tipoDoc === c.tipoDoc && s.fecha === c.fecha && (!s.rucContraparte || !c.rucContraparte || s.rucContraparte === c.rucContraparte));
  for (const c of cont) {
    if (clavesSire.has(c.clave)) continue;
    const j = sueltosSire.findIndex((s) => mismo(s, c));
    if (j < 0) continue;
    const s = sueltosSire.splice(j, 1)[0];
    realineados.set(s.clave, documento?.get(c.clave) ?? `${c.serie}-${c.numero}`);
    c.clave = s.clave;
  }
  const cruce = cruzarLibro(libro, sire, cont);
  for (const f of cruce.filas) {
    const doc = realineados.get(f.clave);
    if (doc) { f.observaciones.push(`Serie/número distinto: en contabilidad figura como ${doc}.`); f.nota = "num-distinto"; }
  }
  return {
    empresa, clave, libro,
    ruc: sires.find((s) => s.ruc)?.ruc ?? "",
    periodo: sires.find((s) => s.periodo)?.periodo ?? "",
    archivosSire: sires.map((s) => s.nombre),
    cruce,
    excluidos: excluidos ?? { honorarios: 0, sinRuc: 0 },
    docDistinto: realineados.size,
  };
}

// ---- Subdiario aparte (p. ej. MISCELÁNEOS) -------------------------------------
// Algunas notas de crédito (u otros comprobantes) no van al Registro de Ventas
// sino a otro subdiario. Tras la conciliación salen como "Solo SIRE"; subiendo
// ese subdiario se buscan por tipo + serie + número y, si el monto cuadra, la
// diferencia queda anulada ("Conciliado con subdiario").

export interface DocSubdiario { tipo: string; serie: string; numero: string; total: number; base?: number; igv?: number; fecha: string; doc: string; aplicaA?: string }
export interface HojaSubdiario { hoja: string; empresa: string; ruc: string; docs: DocSubdiario[] }

// En el sistema contable (BAPU) la nota de crédito va con prefijo "CC" en el Documento
// (CCB0010000010); también se acepta "NC". ND = nota de débito.
const PREFIJO_TIPO: Record<string, string> = { CC: "7", NC: "7", ND: "8", FT: "1", FA: "1", BV: "3", BO: "3", TK: "12" };

/** "NCB0010000545", "07 B001-0000545", "B001 0000545"… → tipo, serie, número. */
export function partirDocumento(doc: string, tipoCol = ""): { tipo: string; serie: string; numero: string } | null {
  const s = doc.trim().toUpperCase();
  const tipoDe = (t: string) => sinCerosIzq((PREFIJO_TIPO[t] ?? t).replace(/\D/g, "")) || "";
  let m = s.match(/^(\d{2})[\s-]+([A-Z0-9]{4})[\s-]*(\d+)$/);
  if (m) return { tipo: tipoDe(m[1]), serie: sinCerosIzq(m[2]), numero: sinCerosIzq(m[3]) };
  m = s.match(/^([A-Z]{2})[\s-]*([A-Z0-9]{4})[\s-]*(\d+)$/);
  if (m && PREFIJO_TIPO[m[1]]) return { tipo: tipoDe(m[1]), serie: sinCerosIzq(m[2]), numero: sinCerosIzq(m[3]) };
  m = s.match(/^([A-Z0-9]{4})[\s-]+(\d+)$/);
  if (m) return { tipo: tipoDe(tipoCol), serie: sinCerosIzq(m[1]), numero: sinCerosIzq(m[2]) };
  return null;
}

/** Lee el subdiario: formato Registro (Documento + Total) o formato Libro Diario (Cuenta, Debe, Haber). */
export async function parseSubdiario(buf: Buffer, parseDiario: (b: Buffer) => Promise<{ hoja: string; empresa: string; movimientos: MovDiario[] }[]>): Promise<HojaSubdiario[]> {
  const out: HojaSubdiario[] = [];
  const registro = await parseRegistroVentasHojas(buf);
  for (const h of registro) {
    out.push({ hoja: h.hoja, empresa: h.empresa, ruc: h.ruc, docs: h.comprobantes.map((c) => ({ tipo: c.tipoDoc, serie: c.serie, numero: c.numero, total: c.total, base: c.baseGravada, igv: c.igv, fecha: c.fecha, doc: `${c.serie}-${c.numero}` })) });
  }
  const yaLeidas = new Set(registro.map((h) => h.hoja));
  for (const h of await parseDiario(buf)) {
    if (yaLeidas.has(h.hoja)) continue;
    // Formato Libro Diario (subdiario 09 MISCELÁNEOS): cada asiento aplica la NC
    // contra el comprobante original, ambos en la 12:
    //   12121001 · CCB0010000010 · Debe 100   ← la NOTA DE CRÉDITO
    //   12121001 · BVB0010005087 · Haber 100  ← la boleta/factura a la que se aplica
    // Solo se toman las NC / ND (tipo 7 / 8); la línea vecina con el mismo anexo
    // indica a qué comprobante se aplicó.
    const movs = h.movimientos;
    // Nº de asiento de cada línea: la secuencia (Sec.) vuelve a 00001 en cada asiento.
    const asiento: number[] = [];
    movs.forEach((m, i) => asiento.push(i === 0 ? 0 : asiento[i - 1] + (Number(m.sec) === 1 ? 1 : 0)));
    const porDoc = new Map<string, number[]>();
    movs.forEach((m, i) => { const d = (m.documento || "").trim().toUpperCase(); if (d) (porDoc.get(d) ?? porDoc.set(d, []).get(d)!).push(i); });
    const docs: DocSubdiario[] = [];
    for (const [d, idxs] of Array.from(porDoc.entries())) {
      const p = partirDocumento(d);
      if (!p || (p.tipo !== "7" && p.tipo !== "8")) continue;
      const ms = idxs.map((i) => movs[i]);
      const cxc = ms.filter((m) => /^1[236]/.test(m.cuenta));
      const debe = ms.reduce((a, m) => a + m.debe, 0), haber = ms.reduce((a, m) => a + m.haber, 0);
      const total = cxc.length ? Math.abs(cxc.reduce((a, m) => a + m.debe - m.haber, 0)) : Math.max(debe, haber);
      const igv = Math.abs(ms.filter((m) => m.cuenta.startsWith("4011")).reduce((a, m) => a + m.debe - m.haber, 0));
      const base = Math.abs(ms.filter((m) => /^7[0-5]/.test(m.cuenta)).reduce((a, m) => a + m.debe - m.haber, 0));
      // Comprobante al que se aplica: otra línea del MISMO asiento con el mismo anexo y otro documento.
      let aplicaA: string | undefined;
      for (const i of idxs) {
        for (let j = 0; j < movs.length; j++) {
          if (asiento[j] !== asiento[i] || j === i) continue;
          const v = movs[j];
          if (v.documento && v.documento.trim().toUpperCase() !== d && v.anexo === movs[i].anexo) {
            const q = partirDocumento(v.documento);
            aplicaA = q ? `${({ "1": "FT", "3": "BV", "7": "NC", "8": "ND" } as Record<string, string>)[q.tipo] ?? q.tipo} ${q.serie}-${q.numero}` : v.documento;
            break;
          }
        }
        if (aplicaA) break;
      }
      docs.push({ ...p, total: r2(total), base: base ? r2(base) : undefined, igv: igv ? r2(igv) : undefined, fecha: ms.find((m) => m.fecDoc)?.fecDoc || ms[0].fecReg || "", doc: `${p.tipo === "7" ? "NC" : "ND"} ${p.serie}-${p.numero}`, aplicaA });
    }
    if (docs.length) out.push({ hoja: h.hoja, empresa: h.empresa, ruc: "", docs });
  }
  return out;
}

/** Anula las diferencias "Solo SIRE" que están en el subdiario (si el monto cuadra). */
export function aplicarSubdiario(res: ConciliacionEmpresa, docs: DocSubdiario[], archivos: string[]): void {
  const idx = new Map<string, DocSubdiario>();
  for (const d of docs) idx.set(`${d.tipo}|${d.serie}|${d.numero}`, d);
  const c = res.cruce;
  let conciliados = 0, conMontoDistinto = 0;
  for (const f of c.filas) {
    if (f.estado !== "solo-sire") continue;
    const d = idx.get(`${sinCerosIzq(f.tipoDoc)}|${f.serie}|${f.numero}`);
    if (!d) continue;
    const signo = f.totalSire < 0 ? -1 : 1; // el SIRE ya trae las NC en negativo
    const total = r2(signo * Math.abs(d.total));
    const base = d.base !== undefined ? r2(signo * Math.abs(d.base)) : f.baseSire;
    const igv = d.igv !== undefined ? r2(signo * Math.abs(d.igv)) : f.igvSire;
    f.totalContable = total; f.baseContable = base; f.igvContable = igv;
    f.noGravadoContable = r2(total - base - igv);
    f.difTotal = r2(f.totalSire - total); f.difBase = r2(f.baseSire - base); f.difIgv = r2(f.igvSire - igv);
    f.difNoGravado = r2(f.noGravadoSire - f.noGravadoContable);
    f.fechaContable = d.fecha;
    f.nota = "subdiario";
    f.observaciones = [`Registrado en el subdiario de misceláneos como ${d.doc}${d.fecha ? ` (${d.fecha})` : ""}${d.aplicaA ? `, aplicada a ${d.aplicaA}` : ""}.`];
    c.soloSire--;
    if (Math.abs(f.difTotal) <= 1) { f.estado = "ok"; c.ok++; conciliados++; }
    else { f.estado = "dif-monto"; c.difMonto++; conMontoDistinto++; f.observaciones.push(`Total: SIRE ${f.totalSire.toFixed(2)} vs subdiario ${total.toFixed(2)} (dif ${f.difTotal.toFixed(2)})`); }
    c.totalesContable.comprobantes++;
    c.totalesContable.total = r2(c.totalesContable.total + total);
    c.totalesContable.baseGravada = r2(c.totalesContable.baseGravada + base);
    c.totalesContable.igv = r2(c.totalesContable.igv + igv);
    c.totalesContable.noGravado = r2(c.totalesContable.noGravado + f.noGravadoContable);
  }
  res.subdiario = { conciliados, conMontoDistinto, archivos };
}

