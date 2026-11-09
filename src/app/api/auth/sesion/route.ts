import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ¿Quién es la sesión ACTUAL de este navegador? Las pestañas abiertas lo
// consultan al volver a ellas: si otra pestaña cambió de cuenta, la pestaña vieja
// se bloquea y avisa (todas las pestañas comparten una sola sesión).
export async function GET() {
  const u = await getCurrentUser();
  return NextResponse.json({ uid: u?.id ?? null, nombre: u?.nombre ?? null }, { headers: { "Cache-Control": "no-store" } });
}
