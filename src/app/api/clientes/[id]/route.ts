import { NextRequest, NextResponse } from "next/server";
import { deleteCliente, updateCliente, liberarRucGlobal } from "@/lib/db";
import { getClienteAutorizado, getCurrentUser, esAdmin } from "@/lib/auth";
import { logAccion } from "@/lib/auditoria";

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
  // Eliminar empresa es solo del admin del estudio (los operadores no pueden).
  if (!esAdmin(await getCurrentUser())) {
    return NextResponse.json({ error: "Solo el administrador del estudio puede eliminar empresas." }, { status: 403 });
  }
  const ok = await deleteCliente(params.id);
  if (!ok) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  await liberarRucGlobal(propio.ruc).catch(() => {}); // el RUC vuelve a estar libre
  await logAccion({
    area: "Cliente",
    accion: "Eliminó una empresa",
    clienteId: propio.id,
    clienteNombre: propio.razonSocial,
    detalle: `RUC ${propio.ruc}`,
  });
  return NextResponse.json({ ok: true });
}
