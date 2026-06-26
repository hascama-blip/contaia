import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getRecordatorios } from "@/lib/db";

export const runtime = "nodejs";

// Recordatorios del usuario: seguimientos de buzón no atendidos (vencidos y por
// vencer), con su empresa. Se usa en la Home para avisar cuando pasa el plazo.
export async function GET() {
  const user = await requireUser();
  const recordatorios = await getRecordatorios(user.id);
  const vencidos = recordatorios.filter((r) => r.vencido).length;
  return NextResponse.json({ recordatorios, vencidos, total: recordatorios.length });
}
