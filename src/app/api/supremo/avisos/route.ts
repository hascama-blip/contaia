import { NextRequest, NextResponse } from "next/server";
import { esSupremo, getCurrentUser } from "@/lib/auth";
import { listAvisos, addAviso, deleteAviso } from "@/lib/db";

export const runtime = "nodejs";

// Avisos informativos (solo el supremo los administra; todas las cuentas los
// ven en el panel Notificaciones del Inicio).
export async function GET() {
  if (!esSupremo(await getCurrentUser())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  return NextResponse.json({ avisos: await listAvisos(false) });
}

export async function POST(req: NextRequest) {
  if (!esSupremo(await getCurrentUser())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const titulo = String(body?.titulo ?? "").trim().slice(0, 120);
  const texto = String(body?.texto ?? "").trim().slice(0, 600);
  const hasta = typeof body?.hasta === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.hasta) ? body.hasta : undefined;
  if (!titulo) return NextResponse.json({ error: "Falta el título." }, { status: 400 });
  const aviso = await addAviso(titulo, texto, hasta);
  return NextResponse.json({ ok: true, aviso });
}

export async function DELETE(req: NextRequest) {
  if (!esSupremo(await getCurrentUser())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ error: "Falta el id." }, { status: 400 });
  await deleteAviso(id);
  return NextResponse.json({ ok: true });
}
