import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { leerSessionToken, SESSION_COOKIE } from "./lib/authToken";
import { TERMINOS_VERSION } from "./lib/legal";
import { registrarAcceso } from "./lib/registroAccesos";
import { ipDe } from "./lib/limite";

// Qué se anota en el registro de accesos (evidencia; ver lib/registroAccesos):
//  · toda página que se abre (no las precargas del navegador),
//  · toda operación que modifica (POST/PUT/PATCH/DELETE) en la API,
//  · las lecturas de la API sobre una empresa o que descargan información.
const LECTURA_SENSIBLE = /\/clientes\/|export|backup|descarg|excel|xml|pdf|zip|informe|accesos/i;
const NO_SON_EMPRESA = new Set(["export", "importar", "verificar", "nuevo"]);
function anotar(req: NextRequest, uid: string) {
  const { pathname, searchParams } = req.nextUrl;
  const esApi = pathname.startsWith("/api/");
  const metodo = req.method.toUpperCase();
  if (metodo === "HEAD" || metodo === "OPTIONS") return;
  if (req.headers.get("next-router-prefetch") || req.headers.get("purpose") === "prefetch") return;
  if (esApi && metodo === "GET" && !LECTURA_SENSIBLE.test(pathname)) return;
  const seg = pathname.match(/\/clientes\/([A-Za-z0-9_-]+)/)?.[1];
  const clienteId = seg && !NO_SON_EMPRESA.has(seg) ? seg : undefined;
  const ruc = (searchParams.get("ruc") || "").replace(/\D/g, "");
  void registrarAcceso({
    ev: esApi ? "api" : "pagina",
    uid,
    ip: ipDe(req),
    ua: req.headers.get("user-agent") ?? undefined,
    metodo,
    ruta: pathname,
    clienteId,
    ruc: ruc.length === 11 ? ruc : undefined,
  });
}

// Protege toda la app: si no hay sesión válida, redirige a /login (o 401 en API).
// Excepciones: /login y /api/auth/* (para poder entrar/registrarse).
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // Exponer el pathname al layout (para decidir el "chrome" público sin sesión).
  const reqHeaders = new Headers(req.headers);
  reqHeaders.set("x-pathname", pathname);
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
    anotar(req, sesion.uid);
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
  // Runtime de Node (estable desde Next 15.5): el middleware escribe el
  // registro de accesos en disco.
  runtime: "nodejs",
  // Todo menos estáticos de Next e imágenes.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp)$).*)",
  ],
};
