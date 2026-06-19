import { NextRequest, NextResponse } from "next/server";
import { deleteCliente, updateCliente } from "@/lib/db";
import { getClienteAutorizado } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const cliente = await getClienteAutorizado(params.id);
  if (!cliente) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  return NextResponse.json({ cliente });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  // Verifica que la empresa sea del usuario antes de modificarla.
  const propio = await getClienteAutorizado(params.id);
  if (!propio) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const cliente = await updateCliente(params.id, body);
  if (!cliente) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  return NextResponse.json({ cliente });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const propio = await getClienteAutorizado(params.id);
  if (!propio) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  const ok = await deleteCliente(params.id);
  if (!ok) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
