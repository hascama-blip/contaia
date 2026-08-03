import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { parseLibroDiario, analizarCompras, type MovDiario } from "@/lib/analisisCompras";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST (multipart) file(s) = Libro(s) Diario(s) en Excel (uno o varios meses,
// p. ej. enero…diciembre) → análisis combinado de compras/gastos.
export async function POST(req: NextRequest) {
  await requireUser();
  const form = await req.formData().catch(() => null);
  const files = form ? (form.getAll("file").filter((f) => f instanceof File) as File[]) : [];
  if (!files.length) {
    return NextResponse.json({ error: "Sube al menos un Libro Diario en Excel." }, { status: 400 });
  }

  try {
    const movimientos: MovDiario[] = [];
    let empresa = "";
    let asientos = 0;
    const archivos: { nombre: string; movimientos: number; asientos: number }[] = [];
    for (const file of files) {
      const buf = Buffer.from(await file.arrayBuffer());
      const r = await parseLibroDiario(buf);
      if (!empresa && r.empresa) empresa = r.empresa;
      movimientos.push(...r.movimientos);
      asientos += r.asientos;
      archivos.push({ nombre: file.name, movimientos: r.movimientos.length, asientos: r.asientos });
    }
    if (!movimientos.length) {
      return NextResponse.json({ error: "No se reconocieron movimientos. Verifica que sean Libros Diarios (columnas Cuenta, Debe, Haber…)." }, { status: 422 });
    }
    const analisis = analizarCompras(movimientos, empresa, asientos);
    if (analisis.totalGasto <= 0) {
      return NextResponse.json({ error: "No se hallaron cuentas de clase 9 (gastos por función). ¿Los Libros incluyen la contabilidad analítica?" }, { status: 422 });
    }
    return NextResponse.json({ analisis, archivos });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "No se pudo leer el archivo." }, { status: 500 });
  }
}
