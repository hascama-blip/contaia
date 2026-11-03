import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { getUserById, getUserByEmail, setPasswordUsuario, registrarAccion } from "@/lib/db";
import { hashPassword, studioId } from "@/lib/auth";
import { comprobarCodigo } from "@/lib/codigos";
import type { Usuario } from "@/lib/types";

export const runtime = "nodejs";

// Paso 2 del "olvidé mi contraseña": fija la nueva clave con el CÓDIGO de 6
// dígitos ({ email, codigo, password }). Sigue aceptando el enlace legacy
// ({ uid, token, password }) por si alguien tiene uno vigente.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const password = String(body?.password ?? "");
  if (password.length < 6) return NextResponse.json({ error: "La contraseña debe tener al menos 6 caracteres." }, { status: 400 });

  let user: Usuario | null = null;
  if (body?.codigo) {
    const email = String(body?.email ?? "").trim().toLowerCase();
    user = email ? await getUserByEmail(email) : null;
    if (!user) return NextResponse.json({ error: "Código incorrecto." }, { status: 400 });
    const r = await comprobarCodigo(user, String(body.codigo), "reset");
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  } else {
    const uid = String(body?.uid ?? "");
    const token = String(body?.token ?? "");
    if (!uid || !token) return NextResponse.json({ error: "Enlace inválido." }, { status: 400 });
    user = await getUserById(uid);
    if (!user || !user.resetTokenHash || !user.resetTokenExp) return NextResponse.json({ error: "El enlace ya no es válido. Solicita uno nuevo." }, { status: 400 });
    if (new Date(user.resetTokenExp).getTime() < Date.now()) return NextResponse.json({ error: "El enlace venció. Solicita uno nuevo." }, { status: 400 });
    if (createHash("sha256").update(token).digest("hex") !== user.resetTokenHash) return NextResponse.json({ error: "Enlace inválido. Solicita uno nuevo." }, { status: 400 });
  }

  await setPasswordUsuario(user.id, hashPassword(password)); // limpia token y código
  await registrarAccion({
    studioId: studioId(user),
    usuarioId: user.id,
    usuarioNombre: user.nombre,
    rol: user.rol === "operador" ? "operador" : "admin",
    area: "Seguridad",
    accion: "Restableció su contraseña con código enviado a su correo",
  }).catch(() => {});
  return NextResponse.json({ ok: true, mensaje: "Contraseña actualizada. Ya puedes iniciar sesión." });
}
