import { NextResponse } from "next/server";
import { getCurrentUser, esSupremo } from "@/lib/auth";
import { probarProxy } from "@/lib/navegador";

export const runtime = "nodejs";
export const maxDuration = 60;

// Prueba el proxy residencial (IP de salida) sin tocar SUNAT. Solo supremo.
export async function POST() {
  const user = await getCurrentUser();
  if (!user || !esSupremo(user)) {
    return NextResponse.json({ error: "Solo el supremo." }, { status: 403 });
  }
  const r = await probarProxy();
  return NextResponse.json(r);
}
