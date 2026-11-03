import { NextRequest, NextResponse } from "next/server";
import { getUserByEmail } from "@/lib/db";
import { enviarCodigo } from "@/lib/codigos";
import { correoConfigurado } from "@/lib/email";

export const runtime = "nodejs";

// Paso 1 del "olvidé mi contraseña": envía un CÓDIGO de 6 dígitos al correo.
// Respuesta genérica SIEMPRE (no revelamos si el correo existe).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const email = String(body?.email ?? "").trim().toLowerCase();
  const generica = NextResponse.json({
    ok: true,
    mensaje: "Si el correo está registrado, te enviamos un código de 6 dígitos. Revisa tu bandeja (y spam) e ingrésalo junto con tu nueva contraseña.",
  });
  if (!email) return generica;
  if (!correoConfigurado()) {
    return NextResponse.json({ ok: false, error: "El envío de correo aún no está configurado. Pide el cambio al administrador de la plataforma." }, { status: 503 });
  }
  const user = await getUserByEmail(email);
  if (!user) return generica;
  const r = await enviarCodigo(user, "reset");
  if (!r.ok && r.esperar) return NextResponse.json({ error: r.error, esperar: r.esperar }, { status: 429 });
  if (!r.ok) return NextResponse.json({ ok: false, error: "No se pudo enviar el correo. Intenta más tarde o pide el cambio al administrador." }, { status: 502 });
  return generica;
}
