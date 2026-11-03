import { NextResponse } from "next/server";
import { SESSION_COOKIE, SESSION_COOKIE_CLEAR } from "@/lib/authToken";

export const runtime = "nodejs";

// Cierra la sesión: borra la cookie con LOS MISMOS atributos con que se creó
// (path/sameSite/secure); si no coinciden, el navegador no la elimina.
export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", SESSION_COOKIE_CLEAR);
  return res;
}
