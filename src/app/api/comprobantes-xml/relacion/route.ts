import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { plantillaRelacionLlenaXlsx, type ItemRelacion } from "@/lib/relacionComprobantes";

export const runtime = "nodejs";

// POST { items: ItemRelacion[], nombre? } → plantilla de relación YA LLENA con
// esos comprobantes (formato de Comprobantes XML), lista para revisar o volver a
// subir y reintentar. Se usa, p. ej., para la relación de los que NO se bajaron.
export async function POST(req: NextRequest) {
  await requireUser();
  const body = await req.json().catch(() => ({}));
  const items: ItemRelacion[] = Array.isArray(body?.items) ? body.items : [];
  if (!items.length) {
    return NextResponse.json({ error: "No hay comprobantes para armar la relación." }, { status: 400 });
  }
  const buf = await plantillaRelacionLlenaXlsx(items);
  const nombre = String(body?.nombre ?? "relacion-comprobantes").replace(/[^\w.-]/g, "-") || "relacion-comprobantes";
  return new NextResponse(buf as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${nombre}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
