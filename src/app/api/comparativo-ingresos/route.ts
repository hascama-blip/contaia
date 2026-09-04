import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { armarComparativo, excelComparativoIngresos, FuenteArchivo } from "@/lib/comparativoIngresos";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX = 25 * 1024 * 1024;

async function leerFuente(form: FormData, campo: string): Promise<FuenteArchivo[]> {
  const files = form.getAll(campo).filter((v): v is File => v instanceof File && v.size > 0);
  const out: FuenteArchivo[] = [];
  for (const f of files) {
    if (f.size > MAX) throw new Error(`"${f.name}" supera 25 MB.`);
    out.push({ nombre: f.name, buffer: Buffer.from(await f.arrayBuffer()) });
  }
  return out;
}

// Sube EECC (banco) + StarSoft + Caja Virtual → comparativo de ingresos por
// empresa/fuente + conciliación de diferencias, en un Excel de 2 hojas.
export async function POST(req: NextRequest) {
  await requireUser();
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Envío inválido." }, { status: 400 });

  try {
    const banco = await leerFuente(form, "eecc");
    const starsoft = await leerFuente(form, "starsoft");
    const caja = await leerFuente(form, "caja");
    if (!banco.length && !starsoft.length && !caja.length) {
      return NextResponse.json({ error: "Sube al menos una fuente (EECC, StarSoft o Caja Virtual)." }, { status: 400 });
    }

    const { resultado } = armarComparativo(banco, starsoft, caja);
    const buf = await excelComparativoIngresos(resultado);
    return NextResponse.json({
      ok: true,
      resultado,
      nombre: "Comparativo_Ingresos.xlsx",
      excel: buf.toString("base64"),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "No se pudo generar el comparativo." }, { status: 500 });
  }
}
