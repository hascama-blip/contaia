import { bloqueoModulo } from "@/lib/acceso";
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { excelDetalleSire } from "@/lib/sireDetalleExcel";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST JSON { periodo, ventas:{columnas,filas}, compras:{columnas,filas} } → Excel.
export async function POST(req: NextRequest) {
  const _bloqueo = await bloqueoModulo("detalle-sire"); if (_bloqueo) return _bloqueo;
  await requireUser();
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const buf = await excelDetalleSire({ ventas: body.ventas, compras: body.compras });
  return new NextResponse(buf as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="detalle-sire-${String(body.periodo ?? "").replace(/\D/g, "").slice(0, 6)}.xlsx"`,
    },
  });
}
