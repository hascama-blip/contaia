import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { informeComprasXlsx } from "@/lib/analisisComprasXlsx";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST JSON { analisis } → Excel "Informe de compras/gastos para gerencia".
export async function POST(req: NextRequest) {
  await requireUser();
  const body = await req.json().catch(() => null);
  const analisis = body?.analisis;
  if (!analisis || typeof analisis !== "object") {
    return NextResponse.json({ error: "Falta el análisis." }, { status: 400 });
  }
  const buf = await informeComprasXlsx(analisis);
  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="informe-compras-gerencia.xlsx"',
    },
  });
}
