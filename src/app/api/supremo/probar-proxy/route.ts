import { NextResponse } from "next/server";
import { getCurrentUser, esSupremo } from "@/lib/auth";
import { probarProxy } from "@/lib/navegador";

export const runtime = "nodejs";
export const maxDuration = 60;

// Prueba el proxy residencial (HTTP/HTTPS/SUNAT). Acepta una "sesión" opcional
// para probar OTRO peer sticky sin redesplegar. Solo supremo.
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user || !esSupremo(user)) {
    return NextResponse.json({ error: "Solo el supremo." }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const sesion = typeof body?.sesion === "string" ? body.sesion : undefined;
  const r = await probarProxy(sesion);
  return NextResponse.json(r);
}
