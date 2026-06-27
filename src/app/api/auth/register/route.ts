import { NextRequest, NextResponse } from "next/server";
import { createUser, getUserByEmail } from "@/lib/db";
import { hashPassword, ensureSupremo } from "@/lib/auth";

export const runtime = "nodejs";

// Registro = SOLICITUD DE ACCESO. Crea la cuenta en estado "pendiente" y NO
// inicia sesión: el usuario supremo debe aprobarla antes de poder ingresar.
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

  await createUser({ nombre, email, passHash: hashPassword(password), estado: "pendiente" });
  return NextResponse.json({
    ok: true,
    pendiente: true,
    mensaje: "Tu solicitud de acceso fue enviada. Un administrador la revisará y te habilitará el ingreso.",
  });
}
