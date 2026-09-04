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

/** Saca la empresa del nombre de archivo "prefijo - EMPRESA - periodo".
 *  Devuelve "" si no logra separarlo o si solo trae palabras genéricas. */
export function empresaDeNombre(nombre: string): string {
  const base = String(nombre ?? "").replace(/\.[a-z0-9]+$/i, ""); // sin extensión
  const partes = base.split(/\s*[-_]\s*/).map((p) => p.trim()).filter(Boolean);
  let emp = "";
  if (partes.length >= 3) emp = partes.slice(1, -1).join(" ").trim(); // prefijo | EMPRESA | periodo
  else if (partes.length === 2) emp = partes[1].trim();
  else emp = base.trim();
  return esNombreGenerico(emp) ? "" : emp;
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
/** Ingreso de una empresa según una fuente. `label` = nombre "bonito" que se muestra. */
export interface IngresoEmpresa { key: string; label: string; total: number; detalle?: string }

export interface FilaComparativo {
  empresa: string;         // etiqueta a mostrar
  eecc: number | null;     // banco (ABONOS)
  starsoft: number | null; // registro de ventas (Total)
  caja: number | null;     // caja virtual (líneas D)
  detalleEecc?: string;    // cuentas del banco que suman el EECC
}
export interface ResultadoComparativo {
  filas: FilaComparativo[];
  fuentes: { eecc: number; starsoft: number; caja: number }; // cuántos archivos por fuente
  avisos: string[];
}

// ---- Parsers de ingreso por fuente ----------------------------------------
/** EECC / banco: agrupa por empresa (leyenda / A1) y suma ABONOS por empresa. */
export function ingresosBanco(archivos: FuenteArchivo[]): Record<string, IngresoEmpresa> {
  const acc: Record<string, IngresoEmpresa> = {};
  for (const { buffer } of archivos) {
    let grupos: { empresa: string; cuentas: string[] }[] = [];
    try { grupos = agruparHojasPorEmpresa(buffer); } catch { grupos = []; }
    for (const g of grupos) {
      const movs = parseBancoStarsoft(buffer, g.cuentas);
      const abono = movs.reduce((a, m) => a + (m.abono || 0), 0);
      if (!abono) continue;
      const key = normEmpresa(g.empresa) || g.empresa.toUpperCase().trim();
      const prev = acc[key];
      if (prev) { prev.total = r2(prev.total + abono); }
      else acc[key] = { key, label: g.empresa, total: r2(abono), detalle: g.cuentas.join(", ") };
    }
  }
  return acc;
}

/** StarSoft (Registro de Ventas): suma la columna "Total". Empresa desde A1 o
 *  desde el nombre de archivo. Un archivo = una empresa. */
export function ingresosStarsoft(archivos: FuenteArchivo[]): Record<string, IngresoEmpresa> {
  const acc: Record<string, IngresoEmpresa> = {};
  for (const { nombre, buffer } of archivos) {
    const hojas = leerHojas(buffer);
    const filas = Object.values(hojas)[0] ?? [];
    if (!filas.length) continue;
    const a1 = String(filas[0]?.[0] ?? "").trim();
    const empresaA1 = a1 && !/^fecha$/i.test(a1) && !esNombreGenerico(a1) ? a1 : "";
    const empresa = empresaA1 || empresaDeNombre(nombre);
    // Cabecera: fila que contiene "Total" y "Documento"/"R.U.C.".
    let hRow = filas.findIndex((f) => f.some((c) => /^total$/i.test(String(c).trim())) && f.some((c) => /documento|r\.?u\.?c/i.test(String(c))));
    if (hRow < 0) hRow = filas.findIndex((f) => f.some((c) => /^total$/i.test(String(c).trim())));
    if (hRow < 0) continue;
    const H = filas[hRow].map((c) => String(c).toUpperCase().trim());
    const iTotal = H.indexOf("TOTAL");
    const iDoc = H.indexOf("DOCUMENTO");
    if (iTotal < 0) continue;
    let total = 0;
    for (let i = hRow + 1; i < filas.length; i++) {
      const f = filas[i]; if (!f) continue;
      // salta filas de pie ("Total ...") que no tienen documento
      if (iDoc >= 0 && !String(f[iDoc] ?? "").trim()) continue;
      total += num(f[iTotal]);
    }
    const key = empresa ? (normEmpresa(empresa) || empresa.toUpperCase().trim()) : SIN_EMPRESA;
    const prev = acc[key];
    if (prev) prev.total = r2(prev.total + total);
    else acc[key] = { key, label: empresa || "StarSoft (empresa no identificada)", total: r2(total) };
  }
  return acc;
}

/** Caja Virtual (export contable "Resultado"): suma IMPORTE de las líneas "D"
 *  (el débito de cada venta = su total). Empresa desde el nombre de archivo. */
export function ingresosCaja(archivos: FuenteArchivo[]): Record<string, IngresoEmpresa> {
  const acc: Record<string, IngresoEmpresa> = {};
  for (const { nombre, buffer } of archivos) {
    const hojas = leerHojas(buffer);
    const filas = hojas["Resultado"] ?? Object.values(hojas)[0] ?? [];
    if (!filas.length) continue;
    const H = (filas[0] ?? []).map((c) => String(c).toUpperCase().replace(/\s+/g, " ").trim());
    const iImp = H.indexOf("IMPORTE");
    const iDH = H.findIndex((h) => h.replace(/\s/g, "") === "DEBE/HABER");
    if (iImp < 0 || iDH < 0) continue;
    let total = 0;
    for (let i = 1; i < filas.length; i++) {
      const f = filas[i]; if (!f) continue;
      if (String(f[iDH] ?? "").trim().toUpperCase() === "D") total += num(f[iImp]);
    }
    const empresa = empresaDeNombre(nombre);
    const key = empresa ? (normEmpresa(empresa) || empresa.toUpperCase().trim()) : SIN_EMPRESA;
    const prev = acc[key];
    if (prev) prev.total = r2(prev.total + total);
    else acc[key] = { key, label: empresa || "Caja (empresa no identificada)", total: r2(total) };
  }
  return acc;
}

// ---- Ensamblado ------------------------------------------------------------
export function armarComparativo(
  banco: FuenteArchivo[],
  starsoft: FuenteArchivo[],
  caja: FuenteArchivo[],
): { resultado: ResultadoComparativo; eecc: Record<string, IngresoEmpresa>; std: Record<string, IngresoEmpresa>; cja: Record<string, IngresoEmpresa> } {
  const eecc = ingresosBanco(banco);
  const std = ingresosStarsoft(starsoft);
  const cja = ingresosCaja(caja);
  const avisos: string[] = [];

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
      acc[k] = { key: k, label: prev?.label ?? k, total: r2((prev?.total ?? 0) + sin.total), detalle: prev?.detalle };
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

  const filas: FilaComparativo[] = [...keys]
    .map((k) => ({
      empresa: label(k),
      eecc: eecc[k]?.total ?? null,
      starsoft: std[k]?.total ?? null,
      caja: cja[k]?.total ?? null,
      detalleEecc: eecc[k]?.detalle ?? "",
    }))
    .sort((a, b) => a.empresa.localeCompare(b.empresa));

  if (!Object.keys(std).length && !Object.keys(cja).length && !Object.keys(eecc).length) {
    avisos.push("No se detectaron ingresos en ninguna fuente. Revisa que los Excel sean los correctos.");
  }
  // Empresas del documento que no se encontraron en el extracto bancario.
  for (const k of keysDoc) {
    if (k === SIN_EMPRESA) continue;
    if (!eecc[k]) avisos.push(`"${label(k)}" no se encontró en el extracto bancario (revisa el nombre de la empresa).`);
  }
  // empresas que solo aparecen en una fuente → no se pueden conciliar
  for (const f of filas) {
    const presentes = [f.eecc, f.starsoft, f.caja].filter((v) => v != null).length;
    if (presentes === 1) avisos.push(`"${f.empresa}" solo aparece en una fuente (no se puede cruzar).`);
  }

  return {
    resultado: { filas, fuentes: { eecc: banco.length, starsoft: starsoft.length, caja: caja.length }, avisos },
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
    const vals = [f.eecc, f.starsoft, f.caja].filter((v): v is number => v != null);
    const spread = vals.length >= 2 ? r2(Math.max(...vals) - Math.min(...vals)) : 0;
    const ok = vals.length >= 2 ? (Math.abs(spread) < 0.5 ? "✔ Sí" : "✗ No") : "—";
    const row = s1.addRow({ empresa: f.empresa, eecc: f.eecc ?? "", starsoft: f.starsoft ?? "", caja: f.caja ?? "", spread: vals.length >= 2 ? spread : "", ok });
    ["eecc", "starsoft", "caja", "spread"].forEach((k) => (row.getCell(k).numFmt = money));
    if (vals.length >= 2 && Math.abs(spread) >= 0.5) {
      row.getCell("spread").font = { color: { argb: AMBER }, bold: true };
      row.getCell("ok").font = { color: { argb: AMBER }, bold: true };
    }
    tE += f.eecc ?? 0; tS += f.starsoft ?? 0; tC += f.caja ?? 0;
  }
  const tot = s1.addRow({ empresa: "TOTAL", eecc: r2(tE), starsoft: r2(tS), caja: r2(tC), spread: "", ok: "" });
  tot.font = { bold: true };
  ["eecc", "starsoft", "caja"].forEach((k) => (tot.getCell(k).numFmt = money));

  // ---------- Hoja 2: Conciliación DETALLADA (diferencias entre fuentes) ----------
  const s2 = wb.addWorksheet("Conciliación");
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

  for (const s of [s1, s2]) {
    s.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A8A" } };
    s.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    s.views = [{ state: "frozen", ySplit: 1 }];
  }
  const ab = await wb.xlsx.writeBuffer();
  return Buffer.from(ab);
}
