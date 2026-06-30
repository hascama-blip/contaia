import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { getUserById, setPasswordUsuario, registrarAccion } from "@/lib/db";
import { hashPassword, studioId } from "@/lib/auth";

export const runtime = "nodejs";

// Paso 2: con el token del correo, el usuario fija una nueva contraseña.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const uid = String(body?.uid ?? "");
  const token = String(body?.token ?? "");
  const password = String(body?.password ?? "");

  if (!uid || !token) return NextResponse.json({ error: "Enlace inválido." }, { status: 400 });
  if (password.length < 6) return NextResponse.json({ error: "La contraseña debe tener al menos 6 caracteres." }, { status: 400 });

  const user = await getUserById(uid);
  if (!user || !user.resetTokenHash || !user.resetTokenExp) {
    return NextResponse.json({ error: "El enlace ya no es válido. Solicita uno nuevo." }, { status: 400 });
  }
  if (new Date(user.resetTokenExp).getTime() < Date.now()) {
    return NextResponse.json({ error: "El enlace venció. Solicita uno nuevo." }, { status: 400 });
  }
  const hash = createHash("sha256").update(token).digest("hex");
  if (hash !== user.resetTokenHash) {
    return NextResponse.json({ error: "Enlace inválido. Solicita uno nuevo." }, { status: 400 });
  }

  await setPasswordUsuario(user.id, hashPassword(password)); // también limpia el token
  // Trazabilidad: queda registrado el cambio (atribuido al propio usuario).
  await registrarAccion({
    studioId: studioId(user),
    usuarioId: user.id,
    usuarioNombre: user.nombre,
    rol: user.rol === "operador" ? "operador" : "admin",
    area: "Seguridad",
    accion: "Restableció su contraseña por correo",
  }).catch(() => {});
  return NextResponse.json({ ok: true, mensaje: "Contraseña actualizada. Ya puedes iniciar sesión." });
}
