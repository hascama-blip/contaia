import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifySessionToken, SESSION_COOKIE } from "./lib/authToken";

// Protege toda la app: si no hay sesión válida, redirige a /login (o 401 en API).
// Excepciones: /login y /api/auth/* (para poder entrar/registrarse).
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (
    pathname === "/" ||           // landing pública (la raíz); el resto sí exige sesión
    pathname.startsWith("/login") ||
    pathname.startsWith("/reset") ||
    pathname.startsWith("/api/auth") ||
    // Webhooks entrantes (correo de SUNAT para el RTT): los llama el proveedor
    // de correo, sin sesión; se protegen con su propio secreto compartido.
    pathname.startsWith("/api/webhooks/")
  ) {
    return NextResponse.next();
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const uid = token ? await verifySessionToken(token) : null;
  if (uid) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  // Todo menos estáticos de Next e imágenes.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp)$).*)",
  ],
};
