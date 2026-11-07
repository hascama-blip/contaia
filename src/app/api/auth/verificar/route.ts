import { limitar, ipDe, MIN, HORA } from "@/lib/limite";
import { NextRequest, NextResponse } from "next/server";
import { getUserByEmail, marcarEmailVerificado } from "@/lib/db";
import { comprobarCodigo } from "@/lib/codigos";
import { ponerSesion } from "@/lib/auth";
import { registrarAcceso } from "@/lib/registroAccesos";

export const runtime = "nodejs";

// Verifica el código de 6 dígitos del registro. Si coincide, marca el correo
// como verificado e INICIA SESIÓN (cookie de sesión).
export async function POST(req: NextRequest) {
  const _lim = limitar([{ clave: `verificar:${ipDe(req)}`, max: 20, ventanaMs: 15 * MIN }]);
  if (_lim) return _lim;
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
  const res = NextResponse.json({ ok: true, user: { id: user.id, nombre: user.nombre, email: user.email } });
  await ponerSesion(res, user);
  void registrarAcceso({ ev: "verificacion", uid: user.id, email: user.email, ip: ipDe(req), ua: req.headers.get("user-agent") ?? undefined });
  return res;
}
