import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { analizarIssosoma, excelIssosoma } from "@/lib/issosoma";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

// GET → Excel de ISSOSOMA (Ventas / Compras / Gastos / Por proyecto / Resumen
// mensual con utilidad). Usa el análisis cacheado (no recalcula Drive).
export async function GET() {
  if (!(await getCurrentUser())) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const data = await analizarIssosoma();
  const buf = await excelIssosoma(data);
  return new NextResponse(buf as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="issosoma-costo-beneficio.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
