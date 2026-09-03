import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { parseReferenciaHonorarios } from "@/lib/honorarios";
import { mergeCuentasHonorarios, getCuentasHonorarios } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX = 15 * 1024 * 1024;

// Aprende las cuentas de honorarios subiendo la plantilla YA LLENA del mes
// anterior (Contasis). Arma el mapa emisor+concepto → cuentas y lo guarda.
export async function POST(req: NextRequest) {
  await requireUser();
  const form = await req.formData().catch(() => null);
  const f = form?.get("archivo");
  if (!(f instanceof File) || f.size === 0) {
    return NextResponse.json({ error: "Adjunta la plantilla del mes anterior (.xlsx)." }, { status: 400 });
  }
  if (f.size > MAX) return NextResponse.json({ error: "El archivo supera 15 MB." }, { status: 400 });
  if (!/\.xlsx$/i.test(f.name)) return NextResponse.json({ error: "Debe ser un Excel .xlsx." }, { status: 400 });

  try {
    const mapa = await parseReferenciaHonorarios(Buffer.from(await f.arrayBuffer()));
    const n = await mergeCuentasHonorarios(mapa);
    const total = Object.keys(await getCuentasHonorarios()).length;
    return NextResponse.json({ ok: true, aprendidas: n, total });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "No se pudo leer la plantilla." }, { status: 500 });
  }
}

// GET → cuántas combinaciones emisor+concepto hay aprendidas.
export async function GET() {
  await requireUser();
  const total = Object.keys(await getCuentasHonorarios()).length;
  return NextResponse.json({ total });
}
