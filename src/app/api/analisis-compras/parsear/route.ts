import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { parseLibroDiario, analizarCompras } from "@/lib/analisisCompras";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST (multipart) file = Libro Diario (Excel) → análisis de compras/gastos.
export async function POST(req: NextRequest) {
  await requireUser();
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Sube el Libro Diario en Excel." }, { status: 400 });
  }
  const buf = Buffer.from(await file.arrayBuffer());
  try {
    const { empresa, movimientos } = await parseLibroDiario(buf);
    if (!movimientos.length) {
      return NextResponse.json({ error: "No se reconocieron movimientos. Verifica que el Excel sea el Libro Diario (columnas Cuenta, Debe, Haber…)." }, { status: 422 });
    }
    const analisis = analizarCompras(movimientos, empresa);
    if (analisis.totalGasto <= 0) {
      return NextResponse.json({ error: "No se hallaron cuentas de clase 9 (gastos por función). ¿El Libro Diario incluye la contabilidad analítica?" }, { status: 422 });
    }
    return NextResponse.json({ analisis });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "No se pudo leer el archivo." }, { status: 500 });
  }
}
