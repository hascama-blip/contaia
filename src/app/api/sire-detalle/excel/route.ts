import { bloqueoModulo } from "@/lib/acceso";
import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 60;

const HEAD = { font: { bold: true, color: { argb: "FFFFFFFF" } }, fill: { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FF102B4D" } } };

// POST JSON { periodo, ventas:{columnas,filas}, compras:{columnas,filas} } → Excel.
export async function POST(req: NextRequest) {
  const _bloqueo = await bloqueoModulo("detalle-sire"); if (_bloqueo) return _bloqueo;
  await requireUser();
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

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
  hoja("Ventas (RVIE)", body.ventas);
  hojaNoIncluidos("Ventas - No incluidos", body.ventas?.noIncluidos, "SUNAT no reporta comprobantes no incluidos (rechazados) en este periodo.");
  hoja("Compras (RCE)", body.compras);
  hojaNoIncluidos("Compras - Excluidos", body.compras?.noIncluidos, "SUNAT no reporta comprobantes excluidos en este periodo.");
  if (wb.worksheets.length === 0) wb.addWorksheet("Sin datos");

  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="detalle-sire-${body.periodo ?? ""}.xlsx"`,
    },
  });
}
