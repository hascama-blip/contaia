import { NextRequest, NextResponse } from "next/server";
import { esSupremo, getCurrentUser, publicUser, hashPassword } from "@/lib/auth";
import { listSolicitudes, setEstadoUsuario, setModulosUsuario, setPasswordUsuario } from "@/lib/db";
import { MODULO_KEYS } from "@/lib/modulos";

export const runtime = "nodejs";

const ESTADOS = ["pendiente", "aprobado", "rechazado"] as const;
type Estado = (typeof ESTADOS)[number];

// Lista las solicitudes/estudios (solo el supremo). Filtro opcional ?estado=.
export async function GET(req: NextRequest) {
  if (!esSupremo(await getCurrentUser())) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }
  const e = req.nextUrl.searchParams.get("estado");
  const estado = ESTADOS.includes(e as Estado) ? (e as Estado) : undefined;
  const solicitudes = (await listSolicitudes(estado)).map(publicUser);
  return NextResponse.json({ solicitudes });
}

// Aprueba o rechaza el acceso de un estudio (solo el supremo).
export async function PATCH(req: NextRequest) {
  if (!esSupremo(await getCurrentUser())) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const userId = String(body?.userId ?? "");
  if (!userId) return NextResponse.json({ error: "Falta el usuario." }, { status: 400 });

  // Cambio de contraseña por el supremo (cuenta olvidada).
  if (typeof body?.password === "string") {
    if (body.password.length < 6) {
      return NextResponse.json({ error: "La contraseña debe tener al menos 6 caracteres." }, { status: 400 });
    }
    const u = await setPasswordUsuario(userId, hashPassword(body.password));
    if (!u) return NextResponse.json({ error: "Cuenta no encontrada." }, { status: 404 });
    return NextResponse.json({ ok: true, usuario: publicUser(u) });
  }

  // Desbloqueo de módulos de paga (m2/m3/m4).
  if (Array.isArray(body?.modulos)) {
    const mods = body.modulos.map((m: any) => String(m)).filter((m: string) => MODULO_KEYS.includes(m));
    const u = await setModulosUsuario(userId, mods);
    if (!u) return NextResponse.json({ error: "Cuenta no encontrada." }, { status: 404 });
    return NextResponse.json({ ok: true, usuario: publicUser(u) });
  }

  // Aprobar / rechazar acceso.
  const estado = body?.estado as Estado;
  if (!ESTADOS.includes(estado)) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  const u = await setEstadoUsuario(userId, estado);
  if (!u) return NextResponse.json({ error: "Solicitud no encontrada." }, { status: 404 });
  return NextResponse.json({ ok: true, usuario: publicUser(u) });
}
