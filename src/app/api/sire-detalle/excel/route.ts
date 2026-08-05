import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 60;

const HEAD = { font: { bold: true, color: { argb: "FFFFFFFF" } }, fill: { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FF102B4D" } } };

// POST JSON { periodo, ventas:{columnas,filas}, compras:{columnas,filas} } → Excel.
export async function POST(req: NextRequest) {
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
  hoja("Ventas (RVIE)", body.ventas);
  hoja("Compras (RCE)", body.compras);
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
