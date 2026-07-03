import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";

export const runtime = "nodejs";
export const maxDuration = 60;

const HEADER_FILL = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FF102B4D" } };
const HEADER_FONT = { bold: true, color: { argb: "FFFFFFFF" } };

// POST JSON { facturas:[...] } -> Excel con el detalle (glosa) y la cuenta.
// POST JSON { facturas:[...], detalle:true } -> Excel de detalle completo:
//   hoja "Comprobantes" (toda la cabecera) + hoja "Ítems" (un renglón por línea).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const rows: any[] = Array.isArray(body?.facturas) ? body.facturas : [];
  if (rows.length === 0) {
    return NextResponse.json({ error: "No hay facturas que exportar." }, { status: 400 });
  }

  if (body?.detalle) return detalleCompleto(rows);

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

// Excel de detalle completo: cabecera de cada comprobante + una fila por ítem.
async function detalleCompleto(rows: any[]) {
  const wb = new ExcelJS.Workbook();

  // Hoja 1: Comprobantes (cabecera completa).
  const wc = wb.addWorksheet("Comprobantes");
  wc.columns = [
    { header: "Fecha", key: "fecha", width: 12 },
    { header: "Hora", key: "hora", width: 10 },
    { header: "Tipo", key: "tipo", width: 16 },
    { header: "Cód.", key: "tipoDoc", width: 6 },
    { header: "Serie-Número", key: "serieNumero", width: 18 },
    { header: "RUC emisor", key: "rucEmisor", width: 14 },
    { header: "Razón social emisor", key: "razonSocialEmisor", width: 36 },
    { header: "RUC/Doc receptor", key: "rucReceptor", width: 16 },
    { header: "Razón social receptor", key: "razonSocialReceptor", width: 36 },
    { header: "Moneda", key: "moneda", width: 8 },
    { header: "Gravado", key: "gravado", width: 14 },
    { header: "Exonerado", key: "exonerado", width: 14 },
    { header: "Inafecto", key: "inafecto", width: 14 },
    { header: "Descuentos", key: "descuento", width: 12 },
    { header: "ISC", key: "isc", width: 12 },
    { header: "IGV", key: "igv", width: 12 },
    { header: "Otros trib.", key: "otrosTributos", width: 12 },
    { header: "Total", key: "total", width: 14 },
    { header: "Descripción (glosa)", key: "glosa", width: 50 },
  ];
  wc.getRow(1).font = HEADER_FONT;
  wc.getRow(1).fill = HEADER_FILL;
  for (const r of rows) {
    wc.addRow({
      fecha: r.fecha ?? "", hora: r.hora ?? "", tipo: r.tipo ?? "", tipoDoc: r.tipoDoc ?? "",
      serieNumero: r.serieNumero ?? "", rucEmisor: r.rucEmisor ?? "",
      razonSocialEmisor: r.razonSocialEmisor ?? "", rucReceptor: r.rucReceptor ?? "",
      razonSocialReceptor: r.razonSocialReceptor ?? "", moneda: r.moneda ?? "",
      gravado: Number(r.gravado) || 0, exonerado: Number(r.exonerado) || 0,
      inafecto: Number(r.inafecto) || 0, descuento: Number(r.descuento) || 0,
      isc: Number(r.isc) || 0, igv: Number(r.igv) || 0,
      otrosTributos: Number(r.otrosTributos) || 0, total: Number(r.total) || 0,
      glosa: r.glosa ?? "",
    });
  }
  ["gravado", "exonerado", "inafecto", "descuento", "isc", "igv", "otrosTributos", "total"].forEach(
    (k) => (wc.getColumn(k).numFmt = "#,##0.00")
  );

  // Hoja 2: Ítems (un renglón por línea, con referencia al comprobante).
  const wi = wb.addWorksheet("Ítems");
  wi.columns = [
    { header: "Serie-Número", key: "serieNumero", width: 18 },
    { header: "Fecha", key: "fecha", width: 12 },
    { header: "RUC emisor", key: "rucEmisor", width: 14 },
    { header: "Razón social emisor", key: "razonSocialEmisor", width: 34 },
    { header: "#", key: "numero", width: 5 },
    { header: "Código", key: "codigo", width: 14 },
    { header: "Descripción", key: "descripcion", width: 48 },
    { header: "Cantidad", key: "cantidad", width: 10 },
    { header: "Unidad", key: "unidad", width: 8 },
    { header: "Valor unit.", key: "valorUnitario", width: 12 },
    { header: "Valor", key: "valor", width: 12 },
    { header: "IGV", key: "igv", width: 12 },
    { header: "Precio unit.", key: "precioUnitario", width: 12 },
    { header: "Afectación", key: "afectacion", width: 16 },
    { header: "Moneda", key: "moneda", width: 8 },
  ];
  wi.getRow(1).font = HEADER_FONT;
  wi.getRow(1).fill = HEADER_FILL;
  for (const r of rows) {
    for (const l of Array.isArray(r.lineas) ? r.lineas : []) {
      wi.addRow({
        serieNumero: r.serieNumero ?? "", fecha: r.fecha ?? "", rucEmisor: r.rucEmisor ?? "",
        razonSocialEmisor: r.razonSocialEmisor ?? "", numero: l.numero ?? "", codigo: l.codigo ?? "",
        descripcion: l.descripcion ?? "", cantidad: Number(l.cantidad) || 0, unidad: l.unidad ?? "",
        valorUnitario: Number(l.valorUnitario) || 0, valor: Number(l.valor) || 0,
        igv: Number(l.igv) || 0, precioUnitario: Number(l.precioUnitario) || 0,
        afectacion: l.afectacion ?? "", moneda: r.moneda ?? "",
      });
    }
  }
  ["cantidad", "valorUnitario", "valor", "igv", "precioUnitario"].forEach(
    (k) => (wi.getColumn(k).numFmt = "#,##0.00")
  );

  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(buf as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="detalle-facturas-xml.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
