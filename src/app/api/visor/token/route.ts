import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getVisorToken, rotarVisorToken } from "@/lib/db";

export const runtime = "nodejs";

// GET: token del Visor del usuario (lo crea si no existe).
export async function GET() {
  const user = await requireUser();
  const token = await getVisorToken(user.id);
  return NextResponse.json({ token });
}

// POST: rota el token (invalida el anterior).
export async function POST() {
  const user = await requireUser();
  const token = await rotarVisorToken(user.id);
  return NextResponse.json({ token });
}
