import { limitar, reiniciar, ipDe, MIN } from "@/lib/limite";
import { NextRequest, NextResponse } from "next/server";
import { getUserByEmail, getUserById } from "@/lib/db";
import { verifyPassword, ensureSupremo, puedeIngresar } from "@/lib/auth";
import { createSessionToken, SESSION_COOKIE, SESSION_COOKIE_OPTS } from "@/lib/authToken";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  await ensureSupremo(); // garantiza que la cuenta supremo exista
  const body = await req.json().catch(() => null);
  const email = String(body?.email ?? "").trim().toLowerCase();
  const password = String(body?.password ?? "");

  // Anti fuerza bruta: 30 intentos/15 min por IP y 8 por correo.
  const _lim = limitar([
    { clave: `login-ip:${ipDe(req)}`, max: 30, ventanaMs: 15 * MIN },
    { clave: `login-mail:${email}`, max: 8, ventanaMs: 15 * MIN },
  ], "Demasiados intentos de inicio de sesión.");
  if (_lim) return _lim;
  if (!email || !password) {
    return NextResponse.json({ error: "Ingresa correo y contraseña." }, { status: 400 });
  }
  const user = await getUserByEmail(email);
  if (!user || !verifyPassword(password, user.passHash)) {
    return NextResponse.json({ error: "Correo o contraseña incorrectos." }, { status: 401 });
  }

  // Control de acceso: la cuenta debe estar aprobada por el supremo.
  const parent = user.parentId ? await getUserById(user.parentId) : null;
  if (!puedeIngresar(user, parent)) {
    const rechazado = (user.parentId ? parent?.estado : user.estado) === "rechazado";
    return NextResponse.json(
      {
        error: rechazado
          ? "Tu solicitud de acceso fue rechazada. Contacta al administrador de la plataforma."
          : "Tu solicitud de acceso está pendiente de aprobación. Te avisaremos cuando se habilite.",
      },
      { status: 403 }
    );
  }

  // Cuenta registrada pero con el correo SIN verificar: no entra; el front
  // ofrece ingresar/reenviar el código.
  if (user.emailVerificado === false) {
    return NextResponse.json(
      { error: "Tu correo aún no está verificado. Ingresa el código que te enviamos (o pide uno nuevo).", noVerificado: true, email: user.email },
      { status: 403 }
    );
  }

  reiniciar(`login-mail:${email}`);
  const token = await createSessionToken(user.id, user.sesionVersion ?? 0);
  const res = NextResponse.json({ ok: true, user: { id: user.id, nombre: user.nombre, email: user.email } });
  // Cookie de SESIÓN (sin maxAge/expires): se borra al cerrar el navegador.
  res.cookies.set(SESSION_COOKIE, token, SESSION_COOKIE_OPTS);
  return res;
}
