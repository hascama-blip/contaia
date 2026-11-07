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
    const rows = desdeEncabezado(p.rows);
    if (!rows) { avisos.push(`"${p.nombre}": no parece un SIRE (no tiene la columna "Serie del CDP").`); return; }
    const h = rows[0].map(normH);
    const libro: TipoLibro = h.some((x) => x === "bi gravada") && !h.some((x) => x.startsWith("bi gravado")) ? "ventas" : "compras";
    const s = libro === "ventas" ? parseSireVentas(rows) : parseSireCompras(rows);
    if (!s.comprobantes.length) { avisos.push(`"${p.nombre}": sin comprobantes.`); return; }
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
    leidos.push({ id: `${nArchivo}:${i}`, libro, nombre: p.nombre, ruc: s.ruc ?? "", razonSocial: s.razonSocial ?? "", periodo: s.periodo ?? "", comprobantes: s.comprobantes });
  });
  return { leidos, avisos };
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
    if (doc) f.observaciones.push(`Serie/número distinto: en contabilidad figura como ${doc}.`);
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
