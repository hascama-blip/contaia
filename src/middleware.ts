import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { leerSessionToken, SESSION_COOKIE } from "./lib/authToken";
import { TERMINOS_VERSION } from "./lib/legal";

// El REGISTRO DE ACCESOS no se escribe aquí: el middleware corre en el
// runtime edge (el de Node, en Next 15.5, rompe a veces el cuerpo de las
// subidas de archivos). Se anota en el servidor, en getCurrentUser
// (lib/auth.ts → anotarPeticion), con los datos que este middleware le pasa en
// cabeceras: x-pathname, x-metodo, x-query y x-req-id (una vez por petición).

// Protege toda la app: si no hay sesión válida, redirige a /login (o 401 en API).
// Excepciones: /login y /api/auth/* (para poder entrar/registrarse).
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // Entrada SIN cifrar (p. ej. http://IP-pública): se manda al dominio con HTTPS antes de
  // que viajen contraseñas, Claves SOL o datos de las empresas en claro.
  const appUrl = process.env.APP_URL || "";
  // (Las rutas de máquina con su propio secreto —webhooks, tarea nocturna, Visor— no se redirigen.)
  const deMaquina = pathname.startsWith("/api/webhooks/") || pathname === "/api/tareas/nocturna" || pathname === "/api/visor/captura";
  // Tampoco las llamadas internas del propio servidor (chequeo de salud por 127.0.0.1).
  const host = (req.headers.get("host") || "").replace(/:\d+$/, "").toLowerCase();
  const interna = host === "127.0.0.1" || host === "localhost" || host === "[::1]" || host === "web";
  if (!deMaquina && !interna && appUrl.startsWith("https://") && req.headers.get("x-forwarded-proto") === "http") {
    try { return NextResponse.redirect(new URL(pathname + req.nextUrl.search, appUrl), 308); } catch { /* APP_URL mal formada: sigue */ }
  }
  // Exponer el pathname al layout (para decidir el "chrome" público sin sesión).
  const reqHeaders = new Headers(req.headers);
  reqHeaders.set("x-pathname", pathname);
  reqHeaders.set("x-metodo", req.method.toUpperCase());
  reqHeaders.set("x-query", req.nextUrl.search.slice(0, 300));
  reqHeaders.set("x-req-id", crypto.randomUUID());
  const pasar = () => NextResponse.next({ request: { headers: reqHeaders } });
  if (
    pathname.startsWith("/conoce") || // portada pública (presentación)
    pathname.startsWith("/login") ||
    pathname.startsWith("/reset") ||
    pathname.startsWith("/legal") ||  // políticas (públicas)
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
  const sesion = token ? await leerSessionToken(token) : null;
  if (sesion) {
    // Políticas: si la sesión no trae la versión vigente aceptada, solo puede
    // ver la pantalla de aceptación (o renovar la sesión si ya aceptó).
    const libre = pathname.startsWith("/aceptar") || pathname.startsWith("/api/legal/");
    if (sesion.t !== TERMINOS_VERSION && !libre) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "Debes aceptar las políticas de la plataforma para continuar. Recarga la página.", aceptarPoliticas: true }, { status: 403 });
      }
      const url = req.nextUrl.clone();
      url.pathname = "/aceptar";
      url.search = "";
      url.searchParams.set("next", pathname + req.nextUrl.search);
      return NextResponse.redirect(url);
    }
    return pasar();
  }
  // La raíz sin sesión decide sola (portada / login).
  if (pathname === "/") return pasar();

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
