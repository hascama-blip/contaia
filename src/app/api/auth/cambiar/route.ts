import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, hashPassword, verifyPassword, studioId } from "@/lib/auth";
import { setPasswordUsuario, registrarAccion } from "@/lib/db";

export const runtime = "nodejs";

// Cambio de contraseña del usuario LOGUEADO: exige la clave actual.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const actual = String(body?.actual ?? "");
  const nueva = String(body?.nueva ?? "");
  if (!actual || !nueva) return NextResponse.json({ error: "Completa la contraseña actual y la nueva." }, { status: 400 });
  if (nueva.length < 6) return NextResponse.json({ error: "La nueva contraseña debe tener al menos 6 caracteres." }, { status: 400 });
  if (!verifyPassword(actual, user.passHash)) return NextResponse.json({ error: "La contraseña actual no es correcta." }, { status: 400 });
  if (actual === nueva) return NextResponse.json({ error: "La nueva contraseña debe ser distinta a la actual." }, { status: 400 });

  await setPasswordUsuario(user.id, hashPassword(nueva));
  await registrarAccion({
    studioId: studioId(user),
    usuarioId: user.id,
    usuarioNombre: user.nombre,
    rol: user.rol === "operador" ? "operador" : "admin",
    area: "Seguridad",
    accion: "Cambió su contraseña desde su cuenta",
  }).catch(() => {});
  return NextResponse.json({ ok: true, mensaje: "Contraseña actualizada." });
}
