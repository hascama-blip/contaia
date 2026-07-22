import { NextResponse } from "next/server";
import { plantillaRelacionXlsx } from "@/lib/relacionComprobantes";

export const runtime = "nodejs";

// Descarga la plantilla Excel para llenar la relación de comprobantes a bajar.
export async function GET() {
  const buf = await plantillaRelacionXlsx();
  return new NextResponse(buf as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="plantilla-relacion-comprobantes.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
