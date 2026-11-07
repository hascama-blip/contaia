import { bloqueoModulo } from "@/lib/acceso";
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { excelComprobantesCompleto, type FaltanteExcel } from "@/lib/excelComprobantes";

export const runtime = "nodejs";
export const maxDuration = 180;

// POST { facturas:[...], faltantes:[...], periodo?, empresa? } → Excel completo:
// Resumen + Comprobantes (A–AH, con detracción) + Ítems + Faltantes (si hay).
// Las facturas con xmlBase64 se re-parsean; las que solo traen pdfBase64 (modo
// PDF masivo) se leen por la capa de texto del PDF (unpdf, sin OCR).
export async function POST(req: NextRequest) {
  const _bloqueo = await bloqueoModulo("comprobantes-xml"); if (_bloqueo) return _bloqueo;
  await requireUser();
  const body = await req.json().catch(() => null);
  const facturas: any[] = Array.isArray(body?.facturas) ? body.facturas : [];
  const faltantes: FaltanteExcel[] = Array.isArray(body?.faltantes) ? body.faltantes : [];
  if (!facturas.length && !faltantes.length) {
    return NextResponse.json({ error: "No hay comprobantes que exportar." }, { status: 400 });
  }
  const periodo = typeof body?.periodo === "string" ? body.periodo : "";
  const empresa = typeof body?.empresa === "string" ? body.empresa : "";
  const buf = await excelComprobantesCompleto(facturas, faltantes, { periodo, empresa });
  const nombre = `comprobantes-${periodo || "relacion"}${faltantes.length ? "-incompleto" : ""}.xlsx`;
  return new NextResponse(buf as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${nombre}"`,
      "Cache-Control": "no-store",
    },
  });
}
