import { NextRequest, NextResponse } from "next/server";
import { getUserByEmail } from "@/lib/db";
import { enviarCodigo } from "@/lib/codigos";

export const runtime = "nodejs";

// Reenvía el código de verificación (solo a cuentas aún no verificadas).
// Respuesta genérica: no revela si el correo existe.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const email = String(body?.email ?? "").trim().toLowerCase();
  const generica = NextResponse.json({ ok: true, mensaje: "Si el correo está registrado y pendiente de verificación, te enviamos un nuevo código." });
  if (!email) return generica;
  const user = await getUserByEmail(email);
  if (!user || user.emailVerificado !== false) return generica;
  const r = await enviarCodigo(user, "verificacion");
  if (!r.ok && r.esperar) return NextResponse.json({ error: r.error, esperar: r.esperar }, { status: 429 });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 });
  return generica;
}
