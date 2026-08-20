import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { clearVisorCapturas, getVisorMatriz, clearVisorMatriz } from "@/lib/db";

export const runtime = "nodejs";

// GET: matriz (cuadro año×mes) del usuario, por empresa y fuente.
export async function GET() {
  const user = await requireUser();
  const matriz = await getVisorMatriz(user.id);
  return NextResponse.json({ matriz });
}

// DELETE: limpia matriz + capturas del usuario.
export async function DELETE() {
  const user = await requireUser();
  await clearVisorMatriz(user.id);
  await clearVisorCapturas(user.id);
  return NextResponse.json({ ok: true });
}
