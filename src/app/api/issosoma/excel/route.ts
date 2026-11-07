import { puedeVerIssosoma } from "@/lib/acceso";
import { getCurrentUser as _usuarioIsso } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { analizarIssosoma, excelIssosoma } from "@/lib/issosoma";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

// GET → Excel de ISSOSOMA: pestaña Ingreso-Egreso-Utilidad + índice + una pestaña
// por proyecto. Con ?empresa=<cliente> exporta SOLO los proyectos de esa empresa.
// Usa el análisis cacheado (no recalcula Drive).
export async function GET(req: NextRequest) {
  if (!puedeVerIssosoma(await _usuarioIsso())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  if (!(await getCurrentUser())) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const empresa = (new URL(req.url).searchParams.get("empresa") || "").trim() || undefined;
  const data = await analizarIssosoma();
  const buf = await excelIssosoma(data, { empresa });
  const slug = (empresa ? `issosoma-${empresa}` : "issosoma-costo-beneficio").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.-]+/g, "-").replace(/-+/g, "-").slice(0, 80);
  return new NextResponse(buf as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${slug}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
