import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST JSON { comprobantes:[{fecha,serie,numero,ruc,razonSocial,base,igv,total,cuenta}] }
// -> Excel listo para revisar/importar a Contasis.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const rows: any[] = Array.isArray(body?.comprobantes) ? body.comprobantes : [];
  if (rows.length === 0) {
    return NextResponse.json({ error: "No hay comprobantes que exportar." }, { status: 400 });
  }

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Compras clasificadas");
  ws.columns = [
    { header: "Fecha", key: "fecha", width: 12 },
    { header: "Serie", key: "serie", width: 10 },
    { header: "Número", key: "numero", width: 12 },
    { header: "RUC proveedor", key: "ruc", width: 14 },
    { header: "Razón social", key: "razonSocial", width: 40 },
    { header: "Base", key: "base", width: 14 },
    { header: "IGV", key: "igv", width: 12 },
    { header: "Total", key: "total", width: 14 },
    { header: "Cuenta", key: "cuenta", width: 12 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF102B4D" } };
  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  for (const r of rows) {
    ws.addRow({
      fecha: r.fecha ?? "",
      serie: r.serie ?? "",
      numero: r.numero ?? "",
      ruc: r.ruc ?? "",
      razonSocial: r.razonSocial ?? "",
      base: Number(r.base) || 0,
      igv: Number(r.igv) || 0,
      total: Number(r.total) || 0,
      cuenta: r.cuenta ?? "",
    });
  }
  ["base", "igv", "total"].forEach((k) => {
    ws.getColumn(k).numFmt = "#,##0.00";
  });

  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(buf as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="compras-clasificadas.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
