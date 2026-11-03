import { NextRequest, NextResponse } from "next/server";
import { getUserByEmail, marcarEmailVerificado } from "@/lib/db";
import { comprobarCodigo } from "@/lib/codigos";
import { createSessionToken, SESSION_COOKIE, SESSION_COOKIE_OPTS } from "@/lib/authToken";

export const runtime = "nodejs";

// Verifica el código de 6 dígitos del registro. Si coincide, marca el correo
// como verificado e INICIA SESIÓN (cookie de sesión).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const email = String(body?.email ?? "").trim().toLowerCase();
  const codigo = String(body?.codigo ?? "");
  if (!email || !codigo) return NextResponse.json({ error: "Ingresa el código." }, { status: 400 });

  const user = await getUserByEmail(email);
  if (!user) return NextResponse.json({ error: "Código incorrecto." }, { status: 400 });

  if (user.emailVerificado !== false) {
    // Ya estaba verificado: no hace falta código, pero tampoco abrimos sesión sin clave.
    return NextResponse.json({ ok: true, yaVerificado: true, mensaje: "Tu correo ya estaba verificado. Inicia sesión." });
  }
  const r = await comprobarCodigo(user, codigo, "verificacion");
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });

  await marcarEmailVerificado(user.id);
  const token = await createSessionToken(user.id);
  const res = NextResponse.json({ ok: true, user: { id: user.id, nombre: user.nombre, email: user.email } });
  res.cookies.set(SESSION_COOKIE, token, SESSION_COOKIE_OPTS);
  return res;
}
