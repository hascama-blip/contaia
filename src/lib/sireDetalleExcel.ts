import ExcelJS from "exceljs";

// Excel del Detalle SIRE de UN periodo: el detalle en una hoja y, si se consultaron, los
// comprobantes que SUNAT dejó fuera de la propuesta (no incluidos / excluidos) en otra.
// Lo usan la descarga de un mes (/api/sire-detalle/excel) y el ZIP por rango de meses.

const HEAD = { font: { bold: true, color: { argb: "FFFFFFFF" } }, fill: { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FF102B4D" } } };

interface Bloque { columnas?: unknown; filas?: unknown; noIncluidos?: any }

export async function excelDetalleSire(datos: { ventas?: Bloque | null; compras?: Bloque | null }): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const hoja = (nombre: string, bloque: any) => {
    if (!bloque || !Array.isArray(bloque.columnas) || !bloque.columnas.length) return;
    const ws = wb.addWorksheet(nombre);
    ws.addRow(bloque.columnas);
    ws.getRow(1).eachCell((c) => { c.font = HEAD.font; c.fill = HEAD.fill; });
    for (const fila of bloque.filas ?? []) ws.addRow(fila);
    ws.columns.forEach((col) => { col.width = 16; });
  };
  // No incluidos (rechazados / excluidos): en el MISMO Excel, en su propia hoja.
  const hojaNoIncluidos = (nombre: string, ni: any, vacio: string) => {
    if (!ni || typeof ni !== "object") return;
    if (Array.isArray(ni.columnas) && ni.columnas.length && (ni.filas ?? []).length) { hoja(nombre, ni); return; }
    const ws = wb.addWorksheet(nombre);
    ws.addRow([String(ni.nota || vacio).slice(0, 300)]);
    ws.getColumn(1).width = 80;
  };
  hoja("Ventas (RVIE)", datos.ventas);
  hojaNoIncluidos("Ventas - No incluidos", datos.ventas?.noIncluidos, "SUNAT no reporta comprobantes no incluidos (rechazados) en este periodo.");
  hoja("Compras (RCE)", datos.compras);
  hojaNoIncluidos("Compras - Excluidos", datos.compras?.noIncluidos, "SUNAT no reporta comprobantes excluidos en este periodo.");
  if (wb.worksheets.length === 0) wb.addWorksheet("Sin datos").addRow(["Sin comprobantes en este periodo."]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
