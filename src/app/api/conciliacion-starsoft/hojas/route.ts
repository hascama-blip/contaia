import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { listarHojasBanco } from "@/lib/conciliacionStarsoft";

export const runtime = "nodejs";

// Devuelve los nombres de las hojas (cuentas) del FORMATO BANCO STARSOFT subido,
// para que el usuario elija con cuál conciliar.
export async function POST(req: NextRequest) {
  await requireUser();
  const form = await req.formData().catch(() => null);
  const f = form?.get("banco");
  if (!(f instanceof File) || f.size === 0) {
    return NextResponse.json({ error: "Adjunta el Excel del banco." }, { status: 400 });
  }
  try {
    const hojas = listarHojasBanco(Buffer.from(await f.arrayBuffer()));
    return NextResponse.json({ hojas });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "No se pudo leer el Excel." }, { status: 500 });
  }
}
