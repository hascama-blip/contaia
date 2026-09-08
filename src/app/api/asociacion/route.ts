import { NextRequest, NextResponse } from "next/server";
import { getAsociacion, setAsociacion } from "@/lib/db";
import { ASOC_COOKIE, cookieValida, edicionHabilitada } from "@/lib/asociacion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET → contenido del sitio (público).
export async function GET() {
  const contenido = await getAsociacion();
  return NextResponse.json({ contenido, edicionHabilitada: edicionHabilitada() });
}

// PUT → guarda el contenido editado (requiere cookie de edición).
export async function PUT(req: NextRequest) {
  if (!cookieValida(req.cookies.get(ASOC_COOKIE)?.value)) {
    return NextResponse.json({ error: "No autorizado para editar." }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Contenido inválido." }, { status: 400 });
  const contenido = await setAsociacion(body.contenido ?? body);
  return NextResponse.json({ ok: true, contenido });
}
