// ============================================================
//  Lectura y escritura de Excel (.xlsx) con exceljs — para el cruce SIRE/contable
// ============================================================
import ExcelJS from "exceljs";
import type { CruceLibro, FilaCruce, ResultadoCruce, EstadoFila } from "./cruceSire";
import { esMonedaExtranjera, TOLERANCIA_TC } from "./cruceSire";

/** Lee la primera hoja de un .xlsx a una matriz de filas (fila 0 = encabezados). */
export async function leerFilas(buf: Buffer): Promise<unknown[][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const maxCol = ws.columnCount;
  const rows: unknown[][] = [];
  ws.eachRow({ includeEmpty: true }, (row) => {
    const arr: unknown[] = [];
    for (let c = 1; c <= maxCol; c++) {
      arr.push(cellVal(row.getCell(c)));
    }
    rows.push(arr);
  });
  return rows;
}

function cellVal(cell: ExcelJS.Cell): unknown {
  const v = cell.value as unknown;
  if (v == null) return "";
  if (v instanceof Date) return v;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("result" in o) return o.result; // fórmula
    if ("text" in o) return o.text; // hipervínculo
    if ("richText" in o && Array.isArray(o.richText)) {
      return (o.richText as { text: string }[]).map((r) => r.text).join("");
    }
    return "";
  }
  return v;
}

// ---- Escritura del comparativo --------------------------------------------

const ESTADO_LABEL: Record<EstadoFila, string> = {
  ok: "Coincide",
  "dif-monto": "Diferencia de montos",
  "dif-fecha": "Diferencia de fecha",
  "solo-sire": "Solo en SIRE (falta en contable)",
  "solo-contable": "Solo en contable (falta en SIRE)",
};

const ESTADO_FILL: Record<EstadoFila, string | null> = {
  ok: null,
  "dif-monto": "FFFDE2E2", // rojo claro
  "dif-fecha": "FFFEF3C7", // ámbar claro
  "solo-sire": "FFFFE4C7", // naranja claro
  "solo-contable": "FFFFE4C7",
};

const AZUL = "FF1D4ED8"; // brand-700 aprox.

/** Genera el Excel del comparativo (hojas Resumen, Compras y/o Ventas). */
export async function construirExcelCruce(res: ResultadoCruce): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "ASENCOIA";
  wb.created = new Date();

  hojaResumen(wb, res);
  hojaFaltantes(wb, res);
  hojaTipoCambio(wb, res);
  if (res.compras) hojaLibro(wb, "Compras", res.compras);
  if (res.ventas) hojaLibro(wb, "Ventas", res.ventas);

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}

function tituloCelda(ws: ExcelJS.Worksheet, texto: string) {
  const row = ws.addRow([texto]);
  row.font = { bold: true, size: 13, color: { argb: AZUL } };
}

function hojaResumen(wb: ExcelJS.Workbook, res: ResultadoCruce) {
  const ws = wb.addWorksheet("Resumen");
  ws.columns = [
    { width: 34 },
    { width: 18 },
    { width: 18 },
    { width: 18 },
  ];

  tituloCelda(ws, "Comparativo SIRE vs Sistema contable");
  ws.addRow([]);
  if (res.razonSocial) ws.addRow(["Contribuyente", res.razonSocial]);
  if (res.ruc) ws.addRow(["RUC", res.ruc]);
  if (res.periodo) ws.addRow(["Periodo", res.periodo]);
  ws.addRow(["Generado", new Date(res.generadoAt).toLocaleString("es-PE")]);
  ws.addRow([]);

  for (const [nombre, libro] of [
    ["COMPRAS", res.compras],
    ["VENTAS", res.ventas],
  ] as const) {
    if (!libro) continue;
    const t = ws.addRow([nombre]);
    t.font = { bold: true, size: 12 };

    const head = ws.addRow(["Concepto", "SIRE", "Sistema contable", "Diferencia"]);
    head.font = { bold: true };
    head.eachCell((c) => {
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFF4FF" } };
    });

    const filasResumen: [string, number, number][] = [
      ["N° de comprobantes", libro.totalesSire.comprobantes, libro.totalesContable.comprobantes],
      ["Base gravada", libro.totalesSire.baseGravada, libro.totalesContable.baseGravada],
      ["IGV", libro.totalesSire.igv, libro.totalesContable.igv],
      ["No gravadas", libro.totalesSire.noGravado, libro.totalesContable.noGravado],
      ["Total", libro.totalesSire.total, libro.totalesContable.total],
    ];
    for (const [concepto, s, c] of filasResumen) {
      const esConteo = concepto.startsWith("N°");
      const row = ws.addRow([concepto, s, c, Math.round((s - c) * 100) / 100]);
      if (!esConteo) {
        [2, 3, 4].forEach((i) => (row.getCell(i).numFmt = "#,##0.00"));
      }
      if (Math.abs(s - c) > 0.005) {
        row.getCell(4).font = { bold: true, color: { argb: "FFB91C1C" } };
      }
    }
    ws.addRow([]);
    const estados = ws.addRow([
      `Coinciden: ${libro.ok}  ·  Dif. montos: ${libro.difMonto}  ·  Dif. fecha: ${libro.difFecha}  ·  Solo SIRE: ${libro.soloSire}  ·  Solo contable: ${libro.soloContable}`,
    ]);
    estados.font = { italic: true, color: { argb: "FF475569" } };
    ws.addRow([]);
  }
}

// ---- Hoja "Faltantes" -------------------------------------------------------
// Comprobantes que están en el SIRE pero NO en el sistema contable (estado
// "solo-sire"): es lo que falta REGISTRAR en contabilidad (típicamente facturas
// de un mes anterior que recién aparecen en el SIRE). Junta compras y ventas.

const COL_FALT: { header: string; width: number; money?: boolean }[] = [
  { header: "Libro", width: 10 },
  { header: "Tipo", width: 6 },
  { header: "Serie", width: 10 },
  { header: "Número", width: 12 },
  { header: "RUC contraparte", width: 16 },
  { header: "Razón social", width: 36 },
  { header: "Fecha SIRE", width: 12 },
  { header: "Base gravada", width: 14, money: true },
  { header: "IGV", width: 12, money: true },
  { header: "No gravadas", width: 13, money: true },
  { header: "Total", width: 14, money: true },
  { header: "Acción", width: 26 },
];

function hojaFaltantes(wb: ExcelJS.Workbook, res: ResultadoCruce) {
  const ws = wb.addWorksheet("Faltantes");
  ws.columns = COL_FALT.map((c) => ({ width: c.width }));

  tituloCelda(ws, "Faltan registrar en contabilidad (están en el SIRE)");
  ws.addRow([
    "Comprobantes presentes en el SIRE pero ausentes en el sistema contable. Considerarlos para que la declaración cuadre.",
  ]).font = { italic: true, color: { argb: "FF475569" } };
  ws.addRow([]);

  const header = ws.addRow(COL_FALT.map((c) => c.header));
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.eachCell((c) => {
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AZUL } };
    c.alignment = { vertical: "middle", wrapText: true };
  });
  const headerRow = header.number;
  ws.views = [{ state: "frozen", ySplit: headerRow }];
  ws.autoFilter = {
    from: { row: headerRow, column: 1 },
    to: { row: headerRow, column: COL_FALT.length },
  };

  const recolectar = (libro: CruceLibro | undefined, nombre: string) =>
    (libro?.filas ?? [])
      .filter((f) => f.estado === "solo-sire")
      .map((f) => [
        nombre,
        f.tipoDoc,
        f.serie,
        f.numero,
        f.rucContraparte,
        f.razonSocial,
        f.fechaSire,
        f.baseSire,
        f.igvSire,
        f.noGravadoSire,
        f.totalSire,
        "Registrar en contabilidad",
      ] as (string | number)[]);

  const filas = [
    ...recolectar(res.compras, "Compras"),
    ...recolectar(res.ventas, "Ventas"),
  ];

  if (filas.length === 0) {
    const r = ws.addRow(["✓ No hay comprobantes faltantes: todo lo del SIRE está en contabilidad."]);
    r.font = { color: { argb: "FF047857" } };
    return;
  }

  for (const valores of filas) {
    const row = ws.addRow(valores);
    COL_FALT.forEach((col, i) => {
      if (col.money) row.getCell(i + 1).numFmt = "#,##0.00";
    });
    row.eachCell((c) => {
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFE4C7" } }; // naranja claro
    });
  }

  // Fila de totales.
  const totBase = filas.reduce((a, f) => a + (f[7] as number), 0);
  const totIgv = filas.reduce((a, f) => a + (f[8] as number), 0);
  const totNg = filas.reduce((a, f) => a + (f[9] as number), 0);
  const totTot = filas.reduce((a, f) => a + (f[10] as number), 0);
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const tot = ws.addRow(["", "", "", "", "", `TOTAL (${filas.length})`, "", r2(totBase), r2(totIgv), r2(totNg), r2(totTot), ""]);
  tot.font = { bold: true };
  [8, 9, 10, 11].forEach((i) => (tot.getCell(i).numFmt = "#,##0.00"));
}

// ---- Hoja "Tipo de cambio" --------------------------------------------------
// Comprobantes en moneda extranjera (dólares): compara el TC del SIRE con el del
// sistema contable. Si difieren, los importes en soles no cuadran.

const COL_TC: { header: string; width: number; money?: boolean; tc?: boolean }[] = [
  { header: "Libro", width: 10 },
  { header: "Tipo", width: 6 },
  { header: "Serie", width: 10 },
  { header: "Número", width: 12 },
  { header: "RUC contraparte", width: 16 },
  { header: "Razón social", width: 34 },
  { header: "Moneda", width: 9 },
  { header: "TC SIRE", width: 11, tc: true },
  { header: "TC contable", width: 12, tc: true },
  { header: "Dif. TC", width: 10, tc: true },
  { header: "Total SIRE", width: 13, money: true },
  { header: "Total contable", width: 13, money: true },
  { header: "Observación", width: 40 },
];

function hojaTipoCambio(wb: ExcelJS.Workbook, res: ResultadoCruce) {
  const ws = wb.addWorksheet("Tipo de cambio");
  ws.columns = COL_TC.map((c) => ({ width: c.width }));

  tituloCelda(ws, "Comparativo de tipo de cambio (comprobantes en dólares)");
  ws.addRow([
    "Operaciones en moneda extranjera: se compara el TC del SIRE con el del sistema contable. Si difieren, revisar el importe en soles.",
  ]).font = { italic: true, color: { argb: "FF475569" } };
  ws.addRow([]);

  const header = ws.addRow(COL_TC.map((c) => c.header));
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.eachCell((c) => {
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AZUL } };
    c.alignment = { vertical: "middle", wrapText: true };
  });
  const headerRow = header.number;
  ws.views = [{ state: "frozen", ySplit: headerRow }];
  ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: headerRow, column: COL_TC.length } };

  const enDolares = (f: FilaCruce) =>
    esMonedaExtranjera(f.monedaSire) || esMonedaExtranjera(f.monedaContable);

  const recolectar = (libro: CruceLibro | undefined, nombre: string) =>
    (libro?.filas ?? []).filter(enDolares).map((f) => {
      const ambos = f.tcSire > 0 && f.tcContable > 0;
      const difiere = ambos && Math.abs(f.tcSire - f.tcContable) > TOLERANCIA_TC;
      const obs = !ambos
        ? "Solo en un lado (no se puede comparar el TC)."
        : difiere
        ? `TC distinto (dif ${f.difTc.toFixed(3)}) → revisar importe en soles.`
        : "TC coincide.";
      return {
        difiere,
        valores: [
          nombre,
          f.tipoDoc,
          f.serie,
          f.numero,
          f.rucContraparte,
          f.razonSocial,
          f.monedaSire || f.monedaContable || "USD",
          f.tcSire || "",
          f.tcContable || "",
          ambos ? f.difTc : "",
          f.totalSire,
          f.totalContable,
          obs,
        ] as (string | number)[],
      };
    });

  const filas = [
    ...recolectar(res.compras, "Compras"),
    ...recolectar(res.ventas, "Ventas"),
  ];

  if (filas.length === 0) {
    const r = ws.addRow(["No hay comprobantes en moneda extranjera en este periodo."]);
    r.font = { color: { argb: "FF475569" } };
    return;
  }

  for (const { valores, difiere } of filas) {
    const row = ws.addRow(valores);
    COL_TC.forEach((col, i) => {
      if (col.money) row.getCell(i + 1).numFmt = "#,##0.00";
      if (col.tc) row.getCell(i + 1).numFmt = "0.000";
    });
    if (difiere) {
      row.eachCell((c) => {
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFDE2E2" } }; // rojo claro
      });
    }
  }
}

const COLUMNAS: { header: string; key: keyof FilaCruce; width: number; money?: boolean }[] = [
  { header: "Tipo", key: "tipoDoc", width: 6 },
  { header: "Serie", key: "serie", width: 10 },
  { header: "Número", key: "numero", width: 12 },
  { header: "RUC contraparte", key: "rucContraparte", width: 16 },
  { header: "Razón social", key: "razonSocial", width: 34 },
  { header: "Fecha SIRE", key: "fechaSire", width: 12 },
  { header: "Fecha contable", key: "fechaContable", width: 13 },
  { header: "Base SIRE", key: "baseSire", width: 13, money: true },
  { header: "Base contable", key: "baseContable", width: 13, money: true },
  { header: "Dif. base", key: "difBase", width: 11, money: true },
  { header: "IGV SIRE", key: "igvSire", width: 12, money: true },
  { header: "IGV contable", key: "igvContable", width: 12, money: true },
  { header: "Dif. IGV", key: "difIgv", width: 11, money: true },
  { header: "No grav. SIRE", key: "noGravadoSire", width: 13, money: true },
  { header: "No grav. contable", key: "noGravadoContable", width: 14, money: true },
  { header: "Dif. no grav.", key: "difNoGravado", width: 12, money: true },
  { header: "Total SIRE", key: "totalSire", width: 13, money: true },
  { header: "Total contable", key: "totalContable", width: 13, money: true },
  { header: "Dif. total", key: "difTotal", width: 12, money: true },
  { header: "Estado", key: "estado", width: 26 },
  { header: "Observaciones", key: "observaciones", width: 60 },
];

function hojaLibro(wb: ExcelJS.Workbook, nombre: string, libro: CruceLibro) {
  const ws = wb.addWorksheet(nombre);
  ws.columns = COLUMNAS.map((c) => ({ width: c.width }));

  const header = ws.addRow(COLUMNAS.map((c) => c.header));
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.eachCell((c) => {
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AZUL } };
    c.alignment = { vertical: "middle", wrapText: true };
  });
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLUMNAS.length } };

  for (const fila of libro.filas) {
    const values = COLUMNAS.map((col) => {
      if (col.key === "estado") return ESTADO_LABEL[fila.estado];
      if (col.key === "observaciones") return fila.observaciones.join(" | ");
      return fila[col.key] as string | number;
    });
    const row = ws.addRow(values);
    COLUMNAS.forEach((col, i) => {
      if (col.money) row.getCell(i + 1).numFmt = "#,##0.00";
    });
    const fill = ESTADO_FILL[fila.estado];
    if (fill) {
      row.eachCell((c) => {
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
      });
    }
  }
}
