import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST JSON { filas:[{fecha,serieNumero,ruc,razonSocial,glosa,base,igv,total,cuenta,estado}] }
// -> Excel masivo listo para Contasis (SIRE + glosa del XML + cuenta + estado).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const rows: any[] = Array.isArray(body?.filas) ? body.filas : [];
  if (rows.length === 0) {
    return NextResponse.json({ error: "No hay filas que exportar." }, { status: 400 });
  }

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Masivo compras");
  ws.columns = [
    { header: "Fecha", key: "fecha", width: 12 },
    { header: "Serie-Número", key: "serieNumero", width: 18 },
    { header: "RUC", key: "ruc", width: 14 },
    { header: "Razón social", key: "razonSocial", width: 38 },
    { header: "Glosa (descripción)", key: "glosa", width: 50 },
    { header: "Base", key: "base", width: 14 },
    { header: "IGV", key: "igv", width: 12 },
    { header: "Total", key: "total", width: 14 },
    { header: "Cuenta", key: "cuenta", width: 12 },
    { header: "Estado", key: "estado", width: 16 },
  ];
  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF102B4D" } };
  for (const r of rows) {
    ws.addRow({
      fecha: r.fecha ?? "",
      serieNumero: r.serieNumero ?? "",
      ruc: r.ruc ?? "",
      razonSocial: r.razonSocial ?? "",
      glosa: r.glosa ?? "",
      base: Number(r.base) || 0,
      igv: Number(r.igv) || 0,
      total: Number(r.total) || 0,
      cuenta: r.cuenta ?? "",
      estado: r.estado ?? "",
    });
  }
  ["base", "igv", "total"].forEach((k) => (ws.getColumn(k).numFmt = "#,##0.00"));

  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(buf as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="masivo-compras-contasis.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
