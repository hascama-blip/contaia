import { NextRequest, NextResponse } from "next/server";
import { ASOC_COOKIE, credencialesOk, edicionHabilitada, tokenEsperado } from "@/lib/asociacion";

export const runtime = "nodejs";

// POST → inicia edición (usuario/clave aparte). Setea la cookie asoc_edit.
export async function POST(req: NextRequest) {
  if (!edicionHabilitada()) {
    return NextResponse.json({ error: "La edición no está configurada (falta la clave en el servidor)." }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const user = String(body?.usuario ?? body?.user ?? "");
  const pass = String(body?.clave ?? body?.password ?? "");
  if (!credencialesOk(user, pass)) {
    return NextResponse.json({ error: "Usuario o clave incorrectos." }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ASOC_COOKIE, tokenEsperado(), {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
    path: "/", maxAge: 60 * 60 * 12, // 12 h
  });
  return res;
}

// DELETE → cierra la edición.
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ASOC_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
