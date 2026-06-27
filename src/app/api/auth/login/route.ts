import { NextRequest, NextResponse } from "next/server";
import { getUserByEmail, getUserById } from "@/lib/db";
import { verifyPassword, ensureSupremo, puedeIngresar } from "@/lib/auth";
import { createSessionToken, SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/authToken";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  await ensureSupremo(); // garantiza que la cuenta supremo exista
  const body = await req.json().catch(() => null);
  const email = String(body?.email ?? "").trim().toLowerCase();
  const password = String(body?.password ?? "");

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

  const token = await createSessionToken(user.id);
  const res = NextResponse.json({ ok: true, user: { id: user.id, nombre: user.nombre, email: user.email } });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true, sameSite: "lax", path: "/", maxAge: SESSION_MAX_AGE,
    secure: process.env.NODE_ENV === "production",
  });
  return res;
}
