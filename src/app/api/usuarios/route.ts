import { NextRequest, NextResponse } from "next/server";
import { requireUser, esAdmin, hashPassword, publicUser } from "@/lib/auth";
import { listSubUsuarios, createUser, deleteSubUsuario, getUserByEmail } from "@/lib/db";

export const runtime = "nodejs";

// Sub-usuarios (operadores) del estudio. Todo aquí es SOLO para el admin.

export async function GET() {
  const user = await requireUser();
  if (!esAdmin(user)) return NextResponse.json({ error: "Solo el administrador." }, { status: 403 });
  const subs = await listSubUsuarios(user.id);
  return NextResponse.json({ usuarios: subs.map(publicUser) });
}

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!esAdmin(user)) return NextResponse.json({ error: "Solo el administrador." }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const nombre = String(body?.nombre ?? "").trim();
  const email = String(body?.email ?? "").trim().toLowerCase();
  const password = String(body?.password ?? "");
  if (!nombre || !email || !password) {
    return NextResponse.json({ error: "Nombre, correo y contraseña son obligatorios." }, { status: 400 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Correo inválido." }, { status: 400 });
  }
  if (password.length < 6) {
    return NextResponse.json({ error: "La contraseña debe tener al menos 6 caracteres." }, { status: 400 });
  }
  if (await getUserByEmail(email)) {
    return NextResponse.json({ error: "Ya existe un usuario con ese correo." }, { status: 409 });
  }

  const nuevo = await createUser({
    nombre,
    email,
    passHash: hashPassword(password),
    rol: "operador",
    parentId: user.id,
  });
  return NextResponse.json({ usuario: publicUser(nuevo) }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const user = await requireUser();
  if (!esAdmin(user)) return NextResponse.json({ error: "Solo el administrador." }, { status: 403 });
  const id = req.nextUrl.searchParams.get("id") ?? "";
  const ok = await deleteSubUsuario(user.id, id);
  return NextResponse.json({ ok });
}
