import { limitar, ipDe, MIN, HORA } from "@/lib/limite";
import { NextRequest, NextResponse } from "next/server";
import { createUser, getUserByEmail } from "@/lib/db";
import { hashPassword, ensureSupremo, constanciaAceptacion } from "@/lib/auth";
import { registrarAceptacion } from "@/lib/db";
import { registrarAcceso } from "@/lib/registroAccesos";
import { enviarCodigo } from "@/lib/codigos";

export const runtime = "nodejs";

// Registro con VERIFICACIÓN DE CORREO: crea la cuenta (aprobada) pero SIN
// iniciar sesión; envía un código de 6 dígitos al correo. La sesión se abre
// recién cuando el usuario verifica el código (POST /api/auth/verificar).
export async function POST(req: NextRequest) {
  await ensureSupremo();
  const _lim = limitar([{ clave: `registro:${ipDe(req)}`, max: 6, ventanaMs: HORA }], "Demasiados registros desde esta conexión.");
  if (_lim) return _lim;
  const body = await req.json().catch(() => null);
  const nombre = String(body?.nombre ?? "").trim();
  const email = String(body?.email ?? "").trim().toLowerCase();
  const password = String(body?.password ?? "");
  // Ambas casillas son obligatorias: Política de seguridad + Declaración de
  // responsabilidad y registro de accesos (queda constancia con IP y fecha).
  const acepta = body?.aceptaSeguridad === true && body?.aceptaResponsabilidad === true;

  if (!nombre || !email || !password) {
    return NextResponse.json({ error: "Completa nombre, correo y contraseña." }, { status: 400 });
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: "Correo inválido." }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "La contraseña debe tener al menos 8 caracteres." }, { status: 400 });
  }
  if (!acepta) {
    return NextResponse.json({ error: "Para crear la cuenta debes aceptar la Política de seguridad y la Declaración de responsabilidad." }, { status: 400 });
  }
  const ip = ipDe(req);
  const ua = req.headers.get("user-agent") ?? undefined;
  const existente = await getUserByEmail(email);
  if (existente) {
    // Si ya existe pero nunca verificó, le reenviamos el código en vez de bloquearlo.
    if (existente.emailVerificado === false) {
      await registrarAceptacion(existente.id, constanciaAceptacion(req, ip, "registro"));
      const r = await enviarCodigo(existente, "verificacion");
      return NextResponse.json({ ok: true, verificar: true, email, mensaje: r.ok ? "Esa cuenta ya existe pero no estaba verificada: te reenviamos el código." : r.error });
    }
    return NextResponse.json({ error: "Ya existe una cuenta con ese correo." }, { status: 409 });
  }

  const user = await createUser({ nombre, email, passHash: hashPassword(password), estado: "aprobado", emailVerificado: false, aceptacion: constanciaAceptacion(req, ip, "registro") });
  void registrarAcceso({ ev: "registro", uid: user.id, email, ip, ua, detalle: "aceptó Política de seguridad y Declaración de responsabilidad" });
  const r = await enviarCodigo(user, "verificacion");
  if (!r.ok) {
    return NextResponse.json({ error: r.error ?? "No se pudo enviar el código de verificación." }, { status: 502 });
  }
  return NextResponse.json({ ok: true, verificar: true, email, mensaje: "Te enviamos un código de 6 dígitos a tu correo. Ingrésalo para activar tu cuenta." });
}
