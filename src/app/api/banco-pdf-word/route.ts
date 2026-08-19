import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { textoDePdf, parseEstadoBcp, wordEstadoBanco } from "@/lib/bancoPdfWord";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_SIZE = 20 * 1024 * 1024;

// PDF de estado de cuenta bancario → Word (.docx) con la estructura de conciliación.
export async function POST(req: NextRequest) {
  await requireUser();
  const form = await req.formData().catch(() => null);
  const f = form?.get("pdf");
  if (!(f instanceof File) || f.size === 0) {
    return NextResponse.json({ error: "Adjunta el PDF del estado de cuenta." }, { status: 400 });
  }
  if (f.size > MAX_SIZE) return NextResponse.json({ error: "El PDF supera 20 MB." }, { status: 400 });
  if (!/\.pdf$/i.test(f.name)) return NextResponse.json({ error: "Debe ser un archivo PDF." }, { status: 400 });

  try {
    const texto = await textoDePdf(Buffer.from(await f.arrayBuffer()));
    if (!texto || texto.replace(/\s/g, "").length < 50) {
      return NextResponse.json({ error: "El PDF no tiene capa de texto (parece escaneado). Debe ser el PDF original del banco." }, { status: 422 });
    }
    const est = parseEstadoBcp(texto);
    if (!est.movimientos.length) {
      return NextResponse.json({ error: "No se detectaron movimientos. Por ahora está calibrado para el estado de cuenta BCP." }, { status: 422 });
    }
    const word = await wordEstadoBanco(est);
    const base = f.name.replace(/\.pdf$/i, "");
    return NextResponse.json({
      ok: true,
      resumen: { empresa: est.empresa, cuenta: est.cuenta, periodo: est.periodo, saldoInicial: est.saldoInicial, movimientos: est.movimientos.length, saldoFinal: est.movimientos.at(-1)?.saldo ?? est.saldoInicial },
      word: word.toString("base64"),
      nombre: `${base || "estado_cuenta"}.docx`,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Error procesando el PDF." }, { status: 500 });
  }
}
