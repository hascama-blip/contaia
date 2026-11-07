import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, constanciaAceptacion, ponerSesion } from "@/lib/auth";
import { registrarAceptacion } from "@/lib/db";
import { ipDe, limitar, MIN } from "@/lib/limite";
import { registrarAcceso } from "@/lib/registroAccesos";
import { TERMINOS_VERSION } from "@/lib/legal";

export const runtime = "nodejs";

// Acepta la Política de seguridad y la Declaración de responsabilidad (usuarios
// que ya tenían cuenta o con una versión anterior). Guarda la constancia y
// renueva la cookie de sesión con la versión aceptada.
export async function POST(req: NextRequest) {
  const ip = ipDe(req);
  const _lim = limitar([{ clave: `aceptar:${ip}`, max: 20, ventanaMs: 15 * MIN }]);
  if (_lim) return _lim;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (body?.aceptaSeguridad !== true || body?.aceptaResponsabilidad !== true) {
    return NextResponse.json({ error: "Debes marcar ambas casillas para continuar." }, { status: 400 });
  }
  const actualizado = await registrarAceptacion(user.id, constanciaAceptacion(req, ip, "ingreso"));
  if (!actualizado) return NextResponse.json({ error: "No se encontró la cuenta." }, { status: 404 });
  void registrarAcceso({ ev: "aceptacion", uid: user.id, email: user.email, ip, ua: req.headers.get("user-agent") ?? undefined, detalle: `políticas versión ${TERMINOS_VERSION}` });
  const res = NextResponse.json({ ok: true });
  await ponerSesion(res, actualizado);
  return res;
}
