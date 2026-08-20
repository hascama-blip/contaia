import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { listVisorCapturas, clearVisorCapturas } from "@/lib/db";

export const runtime = "nodejs";

// GET: capturas del usuario (sin el texto crudo completo, para aligerar).
export async function GET() {
  const user = await requireUser();
  const capturas = (await listVisorCapturas(user.id)).map((c) => ({
    id: c.id, at: c.at, url: c.url, titulo: c.titulo, tipo: c.tipo, resumen: c.resumen,
    tieneDatos: Boolean(c.datos),
  }));
  return NextResponse.json({ capturas });
}

// DELETE: limpia las capturas del usuario.
export async function DELETE() {
  const user = await requireUser();
  await clearVisorCapturas(user.id);
  return NextResponse.json({ ok: true });
}
