import { NextRequest, NextResponse } from "next/server";
import { construirExcelCruce } from "@/lib/xlsxIO";
import type { ResultadoCruce } from "@/lib/cruceSire";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST con JSON { resultado } (el resultado ya calculado por /cruce-sire) ->
// genera y devuelve el Excel del comparativo. Se reenvía el resultado para no
// re-subir los archivos.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const resultado = body?.resultado as ResultadoCruce | undefined;
  if (!resultado || (!resultado.compras && !resultado.ventas)) {
    return NextResponse.json({ error: "No hay un cruce que exportar." }, { status: 400 });
  }

  const buf = await construirExcelCruce(resultado);
  const periodo = (resultado.periodo && /^\d{6}$/.test(resultado.periodo))
    ? resultado.periodo
    : "comparativo";
  const filename = `cruce-sire-contable-${periodo}.xlsx`;

  return new NextResponse(buf as unknown as BodyInit, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
