import { NextRequest, NextResponse } from "next/server";
import { createUser, getUserByEmail } from "@/lib/db";
import { hashPassword, ensureSupremo } from "@/lib/auth";
import { createSessionToken, SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/authToken";

export const runtime = "nodejs";

// Registro LIBRE: crea la cuenta ya aprobada e INICIA SESIÓN de inmediato
// (sin aprobación del supremo). El usuario entra directo tras registrarse.
export async function POST(req: NextRequest) {
  await ensureSupremo();
  const body = await req.json().catch(() => null);
  const nombre = String(body?.nombre ?? "").trim();
  const email = String(body?.email ?? "").trim().toLowerCase();
  const password = String(body?.password ?? "");

  if (!nombre || !email || !password) {
    return NextResponse.json({ error: "Completa nombre, correo y contraseña." }, { status: 400 });
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: "Correo inválido." }, { status: 400 });
  }
  if (password.length < 6) {
    return NextResponse.json({ error: "La contraseña debe tener al menos 6 caracteres." }, { status: 400 });
  }
  if (await getUserByEmail(email)) {
    return NextResponse.json({ error: "Ya existe una cuenta con ese correo." }, { status: 409 });
  }

  const user = await createUser({ nombre, email, passHash: hashPassword(password), estado: "aprobado" });
  const token = await createSessionToken(user.id);
  const res = NextResponse.json({ ok: true, user: { id: user.id, nombre: user.nombre, email: user.email } });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true, sameSite: "lax", path: "/", maxAge: SESSION_MAX_AGE,
    secure: process.env.NODE_ENV === "production",
  });
  return res;
}
