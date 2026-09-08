import { NextRequest, NextResponse } from "next/server";
import { getSugerencias, addSugerencia } from "@/lib/db";
import { ASOC_COOKIE, cookieValida } from "@/lib/asociacion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET → lista de sugerencias (solo el editor).
export async function GET(req: NextRequest) {
  if (!cookieValida(req.cookies.get(ASOC_COOKIE)?.value)) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }
  return NextResponse.json({ sugerencias: await getSugerencias() });
}

// POST → enviar una sugerencia de próximo curso (público).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const tema = String(body?.tema ?? "").trim().slice(0, 300);
  const nombre = String(body?.nombre ?? "").trim().slice(0, 120);
  const email = String(body?.email ?? "").trim().slice(0, 160);
  if (tema.length < 3) return NextResponse.json({ error: "Escribe el tema o curso que sugieres." }, { status: 400 });
  await addSugerencia({ nombre, tema, email, at: new Date().toISOString() });
  return NextResponse.json({ ok: true });
}
