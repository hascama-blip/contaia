import { bloqueoModulo } from "@/lib/acceso";
import { NextResponse } from "next/server";
import { plantillaRelacionXlsx } from "@/lib/relacionComprobantes";

export const runtime = "nodejs";

// Descarga la plantilla Excel para llenar la relación de comprobantes a bajar.
export async function GET() {
  const _bloqueo = await bloqueoModulo("comprobantes-xml", "detalle-sire"); if (_bloqueo) return _bloqueo;
  const buf = await plantillaRelacionXlsx();
  return new NextResponse(buf as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="plantilla-relacion-comprobantes.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
