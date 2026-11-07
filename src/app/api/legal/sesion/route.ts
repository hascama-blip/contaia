import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, ponerSesion, versionTerminos } from "@/lib/auth";
import { TERMINOS_VERSION } from "@/lib/legal";

export const runtime = "nodejs";

// Renueva la cookie de sesión cuando el usuario YA aceptó la versión vigente
// (p. ej. la aceptó en otro equipo) o está exento; luego vuelve a `next`.
export async function GET(req: NextRequest) {
  const nextCrudo = req.nextUrl.searchParams.get("next") || "/";
  const next = /^\/(?![\/\\])/.test(nextCrudo) ? nextCrudo : "/";
  const user = await getCurrentUser();
  const url = req.nextUrl.clone();
  url.search = "";
  if (!user) { url.pathname = "/login"; return NextResponse.redirect(url); }
  if (versionTerminos(user) !== TERMINOS_VERSION) {
    url.pathname = "/aceptar";
    url.searchParams.set("next", next);
    return NextResponse.redirect(url);
  }
  const destino = new URL(next, "http://interno");
  url.pathname = destino.pathname;
  url.search = destino.search;
  const res = NextResponse.redirect(url);
  await ponerSesion(res, user);
  return res;
}
