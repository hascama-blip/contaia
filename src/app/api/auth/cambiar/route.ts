import { limitar, ipDe, MIN, HORA } from "@/lib/limite";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, hashPassword, verifyPassword, studioId } from "@/lib/auth";
import { setPasswordUsuario, registrarAccion } from "@/lib/db";
import { createSessionToken, SESSION_COOKIE, SESSION_COOKIE_OPTS } from "@/lib/authToken";

export const runtime = "nodejs";

// Cambio de contraseña del usuario LOGUEADO: exige la clave actual.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const _lim = limitar([{ clave: `cambiar:${user?.id ?? ipDe(req)}`, max: 10, ventanaMs: 15 * MIN }]);
  if (_lim) return _lim;
  const body = await req.json().catch(() => ({}));
  const actual = String(body?.actual ?? "");
  const nueva = String(body?.nueva ?? "");
  if (!actual || !nueva) return NextResponse.json({ error: "Completa la contraseña actual y la nueva." }, { status: 400 });
  if (nueva.length < 8) return NextResponse.json({ error: "La nueva contraseña debe tener al menos 8 caracteres." }, { status: 400 });
  if (!verifyPassword(actual, user.passHash)) return NextResponse.json({ error: "La contraseña actual no es correcta." }, { status: 400 });
  if (actual === nueva) return NextResponse.json({ error: "La nueva contraseña debe ser distinta a la actual." }, { status: 400 });

  const actualizado = await setPasswordUsuario(user.id, hashPassword(nueva));
  await registrarAccion({
    studioId: studioId(user),
    usuarioId: user.id,
    usuarioNombre: user.nombre,
    rol: user.rol === "operador" ? "operador" : "admin",
    area: "Seguridad",
    accion: "Cambió su contraseña desde su cuenta",
  }).catch(() => {});
  // Las sesiones de otros equipos quedan cerradas; esta sigue con una cookie nueva.
  const res = NextResponse.json({ ok: true, mensaje: "Contraseña actualizada. Se cerró la sesión en tus otros equipos." });
  res.cookies.set(SESSION_COOKIE, await createSessionToken(user.id, actualizado?.sesionVersion ?? 0), SESSION_COOKIE_OPTS);
  return res;
}
