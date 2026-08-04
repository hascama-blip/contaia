import ExcelJS from "exceljs";
import type { AnalisisCompras } from "./analisisCompras";

// Genera el "Informe de compras/gastos para gerencia" en Excel a partir del
// análisis. Hojas: Resumen · Análisis Clase 9 · Detalle Clase 9 · Por
// Naturaleza · Por Centro de Costo.

const AZUL = "FF102B4D";
const DORADO = "FFB88A2A";
const HEAD = { font: { bold: true, color: { argb: "FFFFFFFF" } }, fill: { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: AZUL } } };
const SUB = { font: { bold: true, color: { argb: "FFFFFFFF" } }, fill: { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: DORADO } } };
const MONEDA = '#,##0.00';

function encabezado(ws: ExcelJS.Worksheet, cols: number) {
  ws.getRow(1).eachCell((c) => { c.font = HEAD.font; c.fill = HEAD.fill; });
}

export async function informeComprasXlsx(a: AnalisisCompras): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Radar Tributario · ASENCO";

  // --- Resumen ---
  const res = wb.addWorksheet("Resumen");
  res.columns = [{ width: 34 }, { width: 22 }, { width: 12 }];
  res.addRow(["INFORME DE COMPRAS Y GASTOS PARA GERENCIA"]);
  res.getRow(1).font = { bold: true, size: 14, color: { argb: AZUL } };
  res.addRow([a.empresa]);
  res.getRow(2).font = { bold: true, size: 12 };
  res.addRow([`Periodo: ${a.periodo || "—"}`]);
  res.addRow([]);
  const kpis: [string, number | string][] = [
    ["Total gasto (clase 9)", a.totalGasto],
    ["IGV / crédito fiscal", a.totalIgv],
    ["Comprobantes", a.nAsientos],
    ["Movimientos analizados", a.nMovimientos],
  ];
  const hk = res.addRow(["Indicador", "Valor"]);
  hk.eachCell((c) => { c.font = SUB.font; c.fill = SUB.fill; });
  for (const [k, v] of kpis) {
    const row = res.addRow([k, v]);
    if (typeof v === "number" && (k.includes("Total") || k.includes("IGV"))) row.getCell(2).numFmt = MONEDA;
  }
  res.addRow([]);
  const hf = res.addRow(["Gasto por función (destino)", "Importe", "%"]);
  hf.eachCell((c) => { c.font = SUB.font; c.fill = SUB.fill; });
  for (const f of a.porFuncion) {
    const row = res.addRow([`${f.cod} · ${f.nombre}`, f.debe, `${f.pct.toFixed(1)}%`]);
    row.getCell(2).numFmt = MONEDA;
  }
  const tot = res.addRow(["TOTAL", a.totalGasto, "100%"]);
  tot.font = { bold: true }; tot.getCell(2).numFmt = MONEDA;

  // --- Análisis Clase 9 (por función → cuentas) ---
  const c9 = wb.addWorksheet("Análisis Clase 9");
  c9.columns = [
    { header: "Función / Cuenta", key: "a", width: 42 },
    { header: "Concepto", key: "b", width: 40 },
    { header: "Nº mov.", key: "c", width: 10 },
    { header: "Importe (S/)", key: "d", width: 16 },
    { header: "% del total", key: "e", width: 12 },
  ];
  encabezado(c9, 5);
  for (const f of a.porFuncion) {
    const r = c9.addRow([`${f.cod} · ${f.nombre}`, "", f.n, f.debe, `${f.pct.toFixed(1)}%`]);
    r.eachCell((c) => { c.font = { bold: true }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3E7CC" } }; });
    r.getCell(4).numFmt = MONEDA;
    for (const cu of f.cuentas) {
      const row = c9.addRow([`   ${cu.cod}`, cu.nombre, cu.n, cu.debe, `${cu.pct.toFixed(1)}%`]);
      row.getCell(4).numFmt = MONEDA;
    }
  }

  // --- Detalle por cuenta (clase 9); movimientos ordenados por fecha ---
  const det = wb.addWorksheet("Detalle por cuenta");
  det.columns = [
    { header: "Fecha", key: "fecha", width: 12 },
    { header: "Glosa", key: "glosa", width: 46 },
    { header: "Factura / Doc.", key: "documento", width: 18 },
    { header: "C. Costo", key: "cenCos", width: 10 },
    { header: "Importe (S/)", key: "debe", width: 16 },
  ];
  encabezado(det, 5);
  for (const g of a.detalleCuentas) {
    const h = det.addRow({ fecha: `${g.cuenta} · ${g.funcion} — ${g.concepto}`, debe: g.total });
    h.getCell(1).font = { bold: true }; h.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3E7CC" } };
    h.getCell(5).numFmt = MONEDA; h.getCell(5).font = { bold: true };
    for (const m of g.movimientos) {
      const row = det.addRow({ fecha: m.fecha, glosa: m.glosa, documento: m.documento, cenCos: m.cenCos, debe: m.debe });
      row.getCell(5).numFmt = MONEDA;
    }
  }

  // --- Por Naturaleza (clase 6) ---
  const nat = wb.addWorksheet("Por Naturaleza");
  nat.columns = [
    { header: "Cuenta (clase 6)", key: "cod", width: 18 },
    { header: "Naturaleza del gasto", key: "nombre", width: 44 },
    { header: "Nº mov.", key: "n", width: 10 },
    { header: "Importe (S/)", key: "debe", width: 16 },
    { header: "%", key: "pct", width: 10 },
  ];
  encabezado(nat, 5);
  for (const x of a.porNaturaleza) {
    const row = nat.addRow({ cod: x.cod, nombre: x.nombre, n: x.n, debe: x.debe, pct: `${x.pct.toFixed(1)}%` });
    row.getCell(4).numFmt = MONEDA;
  }

  // --- Por Centro de Costo ---
  const cc = wb.addWorksheet("Por Centro de Costo");
  cc.columns = [
    { header: "Centro de costo", key: "cod", width: 20 },
    { header: "Nº mov.", key: "n", width: 10 },
    { header: "Importe (S/)", key: "debe", width: 16 },
    { header: "%", key: "pct", width: 10 },
  ];
  encabezado(cc, 4);
  for (const x of a.porCentroCosto) {
    const row = cc.addRow({ cod: x.cod, n: x.n, debe: x.debe, pct: `${x.pct.toFixed(1)}%` });
    row.getCell(3).numFmt = MONEDA;
  }

  // --- Revisión de clasificación (reclasificación sugerida) ---
  if (a.revision) {
    const rv = wb.addWorksheet("Revisión clasificación");
    rv.columns = [
      { header: "Confianza", key: "conf", width: 10 },
      { header: "Cuenta actual", key: "cuenta", width: 14 },
      { header: "Función actual", key: "funcionActual", width: 26 },
      { header: "Glosa", key: "glosa", width: 40 },
      { header: "Factura / Doc.", key: "documento", width: 18 },
      { header: "Fecha", key: "fecha", width: 12 },
      { header: "Importe (S/)", key: "importe", width: 14 },
      { header: "Reclasificar a", key: "cuentaSugerida", width: 14 },
      { header: "Subcuenta ref.", key: "subcuenta", width: 30 },
      { header: "Motivo", key: "motivo", width: 70 },
    ];
    encabezado(rv, 9);
    rv.addRow({ funcionActual: `Correctos: ${a.revision.correctos}`, glosa: `Observados: ${a.revision.observados}`, importe: a.revision.importeObservado }).font = { italic: true };
    for (const h of a.revision.hallazgos) {
      const row = rv.addRow(h);
      row.getCell(7).numFmt = MONEDA;
    }
    if (!a.revision.hallazgos.length) rv.addRow({ funcionActual: "Sin observaciones: todo clasificado de forma coherente." });
  }

  // --- Por Mes (si hay varios meses) ---
  if ((a.porMes ?? []).length > 1) {
    const mes = wb.addWorksheet("Por Mes");
    mes.columns = [
      { header: "Mes", key: "nombre", width: 20 },
      { header: "Nº mov.", key: "n", width: 10 },
      { header: "Importe (S/)", key: "debe", width: 16 },
    ];
    encabezado(mes, 3);
    for (const m of a.porMes) {
      const row = mes.addRow({ nombre: m.nombre, n: m.n, debe: m.debe });
      row.getCell(3).numFmt = MONEDA;
    }
    const t = mes.addRow({ nombre: "TOTAL", n: a.nMovimientos, debe: a.totalGasto });
    t.font = { bold: true }; t.getCell(3).numFmt = MONEDA;
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
