import { NextRequest, NextResponse } from "next/server";
import { createHash, randomBytes } from "crypto";
import { getUserByEmail, setResetTokenUsuario } from "@/lib/db";
import { enviarCorreo, htmlReset, correoConfigurado } from "@/lib/email";

export const runtime = "nodejs";

// Paso 1 del "olvidé mi contraseña": el usuario pone su correo y, si existe,
// le enviamos un enlace con un token de un solo uso (vence en 1 hora).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const email = String(body?.email ?? "").trim().toLowerCase();
  // Respuesta genérica SIEMPRE (no revelamos si el correo existe).
  const generica = NextResponse.json({
    ok: true,
    mensaje: "Si el correo está registrado, te enviamos un enlace para cambiar la contraseña. Revisa tu bandeja (y spam).",
  });

  if (!email) return generica;
  const user = await getUserByEmail(email);
  if (!user) return generica;

  if (!correoConfigurado()) {
    return NextResponse.json(
      { ok: false, error: "El envío de correo aún no está configurado. Pide el cambio al administrador de la plataforma." },
      { status: 503 }
    );
  }

  const token = randomBytes(32).toString("hex");
  const hash = createHash("sha256").update(token).digest("hex");
  const exp = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hora
  await setResetTokenUsuario(user.id, hash, exp);

  const base = process.env.APP_URL || req.nextUrl.origin;
  const enlace = `${base}/reset?uid=${user.id}&token=${token}`;
  const r = await enviarCorreo(user.email, "Cambiar tu contraseña — Radar Tributar IA", htmlReset(user.nombre, enlace));
  if (!r.ok) {
    return NextResponse.json({ ok: false, error: "No se pudo enviar el correo. Intenta más tarde o pide el cambio al administrador." }, { status: 502 });
  }
  return generica;
}
