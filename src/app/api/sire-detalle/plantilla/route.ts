import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { relacionDesdeSireCompras, plantillaRelacionLlenaXlsx } from "@/lib/relacionComprobantes";

export const runtime = "nodejs";

// POST { periodo, compras: { columnas, filas } } → plantilla de relación YA LLENA
// (formato de la plantilla de Comprobantes XML) a partir del Detalle SIRE de
// compras, lista para subir al módulo de Comprobantes XML.
export async function POST(req: NextRequest) {
  await requireUser();
  const body = await req.json().catch(() => ({}));
  const compras = body?.compras;
  const columnas: string[] = Array.isArray(compras?.columnas) ? compras.columnas : [];
  const filas: string[][] = Array.isArray(compras?.filas) ? compras.filas : [];
  if (!columnas.length || !filas.length) {
    return NextResponse.json({ error: "No hay compras extraídas para armar la plantilla." }, { status: 400 });
  }
  const items = relacionDesdeSireCompras(columnas, filas);
  if (!items.length) {
    return NextResponse.json({ error: "No se pudo mapear ningún comprobante del detalle SIRE." }, { status: 400 });
  }
  const buf = await plantillaRelacionLlenaXlsx(items);
  const periodo = String(body?.periodo ?? "").replace(/\D/g, "") || "compras";
  return new NextResponse(buf as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="relacion-comprobantes-${periodo}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
