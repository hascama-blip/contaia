import { limitar, ipDe, MIN, HORA } from "@/lib/limite";
import { NextRequest, NextResponse } from "next/server";
import { getUserByEmail, setPasswordUsuario, registrarAccion } from "@/lib/db";
import { hashPassword, studioId } from "@/lib/auth";
import { comprobarCodigo } from "@/lib/codigos";
import type { Usuario } from "@/lib/types";

export const runtime = "nodejs";

// Paso 2 del "olvidé mi contraseña": fija la nueva clave con el CÓDIGO de 6
// dígitos ({ email, codigo, password }).
export async function POST(req: NextRequest) {
  const _lim = limitar([{ clave: `reset:${ipDe(req)}`, max: 20, ventanaMs: 15 * MIN }]);
  if (_lim) return _lim;
  const body = await req.json().catch(() => ({}));
  const password = String(body?.password ?? "");
  if (password.length < 8) return NextResponse.json({ error: "La contraseña debe tener al menos 8 caracteres." }, { status: 400 });

  let user: Usuario | null = null;
  if (body?.codigo) {
    const email = String(body?.email ?? "").trim().toLowerCase();
    user = email ? await getUserByEmail(email) : null;
    if (!user) return NextResponse.json({ error: "Código incorrecto." }, { status: 400 });
    const r = await comprobarCodigo(user, String(body.codigo), "reset");
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  } else {
    // El enlace antiguo (uid + token) ya no se acepta: solo el código por correo.
    return NextResponse.json({ error: "Este enlace ya no es válido. Pide un código nuevo en «Olvidé mi contraseña»." }, { status: 400 });
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
