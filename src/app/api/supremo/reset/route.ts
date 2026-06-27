import { NextRequest, NextResponse } from "next/server";
import { esSupremo, getCurrentUser, resetUsuarios, SESSION_COOKIE } from "@/lib/auth";

export const runtime = "nodejs";

// Borra TODAS las cuentas y recrea el usuario supremo. Solo el supremo.
// Requiere confirmacion: { confirmar: "ELIMINAR" }.
export async function POST(req: NextRequest) {
  if (!esSupremo(await getCurrentUser())) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  if (body?.confirmar !== "ELIMINAR") {
    return NextResponse.json({ error: "Confirmación requerida." }, { status: 400 });
  }
  const eliminadas = await resetUsuarios();
  // La sesión actual apuntaba al supremo anterior (ya recreado con otro id):
  // cerramos sesión para que vuelva a entrar con las credenciales del supremo.
  const res = NextResponse.json({
    ok: true,
    eliminadas,
    mensaje: `Se eliminaron ${eliminadas} cuenta(s). El usuario supremo fue recreado. Inicia sesión de nuevo.`,
  });
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
