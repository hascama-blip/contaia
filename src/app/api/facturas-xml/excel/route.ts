import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST JSON { facturas:[...] } -> Excel con el detalle (glosa) y la cuenta.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const rows: any[] = Array.isArray(body?.facturas) ? body.facturas : [];
  if (rows.length === 0) {
    return NextResponse.json({ error: "No hay facturas que exportar." }, { status: 400 });
  }

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Facturas (XML)");
  ws.columns = [
    { header: "Fecha", key: "fecha", width: 12 },
    { header: "Tipo", key: "tipo", width: 16 },
    { header: "Serie-Número", key: "serieNumero", width: 18 },
    { header: "RUC emisor", key: "ruc", width: 14 },
    { header: "Razón social", key: "razonSocial", width: 36 },
    { header: "Descripción (glosa)", key: "glosa", width: 50 },
    { header: "Moneda", key: "moneda", width: 8 },
    { header: "Base", key: "base", width: 14 },
    { header: "IGV", key: "igv", width: 12 },
    { header: "Total", key: "total", width: 14 },
    { header: "Cuenta", key: "cuenta", width: 12 },
  ];
  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF102B4D" } };
  for (const r of rows) {
    ws.addRow({
      fecha: r.fecha ?? "",
      tipo: r.tipo ?? "",
      serieNumero: r.serieNumero ?? "",
      ruc: r.ruc ?? "",
      razonSocial: r.razonSocial ?? "",
      glosa: r.glosa ?? "",
      moneda: r.moneda ?? "",
      base: Number(r.base) || 0,
      igv: Number(r.igv) || 0,
      total: Number(r.total) || 0,
      cuenta: r.cuenta ?? "",
    });
  }
  ["base", "igv", "total"].forEach((k) => (ws.getColumn(k).numFmt = "#,##0.00"));

  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(buf as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="facturas-xml.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
