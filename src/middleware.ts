import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifySessionToken, SESSION_COOKIE } from "./lib/authToken";

// Protege toda la app: si no hay sesión válida, redirige a /login (o 401 en API).
// Excepciones: /login y /api/auth/* (para poder entrar/registrarse).
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // Exponer el pathname al layout (para decidir el "chrome" público sin sesión).
  const reqHeaders = new Headers(req.headers);
  reqHeaders.set("x-pathname", pathname);
  const pasar = () => NextResponse.next({ request: { headers: reqHeaders } });
  if (
    pathname === "/" ||           // la raíz decide sola (login si no hay sesión)
    pathname.startsWith("/conoce") || // portada pública (presentación)
    pathname.startsWith("/login") ||
    pathname.startsWith("/reset") ||
    pathname.startsWith("/api/auth") ||
    // Sitio público de la Asociación Mutualista (y su API); la edición tiene su
    // propia clave (cookie asoc_edit), no la sesión de Radar.
    pathname.startsWith("/asociacionmutualista") ||
    pathname.startsWith("/api/asociacion") ||
    // Webhooks entrantes (correo de SUNAT para el RTT): los llama el proveedor
    // de correo, sin sesión; se protegen con su propio secreto compartido.
    pathname.startsWith("/api/webhooks/") ||
    // Rutas con su PROPIA autenticación por token (no usan la cookie):
    //  · tarea nocturna: token interno del planificador o CRON_SECRET.
    //  · captura del Visor: token incrustado en la extensión del navegador.
    pathname === "/api/tareas/nocturna" ||
    pathname === "/api/visor/captura"
  ) {
    return pasar();
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const uid = token ? await verifySessionToken(token) : null;
  if (uid) return pasar();

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
