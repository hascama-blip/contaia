import { NextResponse } from "next/server";

export const runtime = "nodejs";

// Desactivado: la contraseña se cambia solo desde el portal de inicio de sesión
// ("Olvidé mi contraseña", con código de 6 dígitos al correo: /api/auth/forgot
// y /api/auth/reset), que además cierra las demás sesiones abiertas.
export async function POST() {
  return NextResponse.json(
    { error: "El cambio de contraseña se hace desde la pantalla de inicio de sesión, en «Olvidé mi contraseña»." },
    { status: 410 },
  );
}
