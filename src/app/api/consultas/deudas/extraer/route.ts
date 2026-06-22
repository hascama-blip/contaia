import { NextRequest, NextResponse } from "next/server";
import { getClienteAutorizado } from "@/lib/auth";
import { extraerDeudasF36 } from "@/lib/fraccionamiento";
import { setDeudasF36 } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 300;

// FASE 2: consulta el estado del pedido y extrae las deudas (4 pestañas).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const cliente = await getClienteAutorizado(String(body?.clienteId ?? ""));
  if (!cliente) return NextResponse.json({ error: "Empresa no encontrada." }, { status: 404 });
  const solUser = (typeof body.solUser === "string" && body.solUser) || cliente.credSire?.solUser || "";
  const solPass = typeof body.solPass === "string" ? body.solPass : "";
  if (!solUser || !solPass) return NextResponse.json({ error: "Ingresa el Usuario y la Clave SOL." }, { status: 400 });

  const r = await extraerDeudasF36({ ruc: cliente.ruc, solUser, solPass, diagnostico: body.diagnostico === true });
  if (r.ok && r.tablas && !body.diagnostico) {
    await setDeudasF36(cliente.id, r.tablas).catch(() => {});
  }
  return NextResponse.json(r, { status: r.ok || body.diagnostico ? 200 : 400 });
}

// GET: devuelve las deudas F36 guardadas (sin clave).
export async function GET(req: NextRequest) {
  const cliente = await getClienteAutorizado(req.nextUrl.searchParams.get("clienteId") ?? "");
  if (!cliente) return NextResponse.json({ error: "Empresa no encontrada." }, { status: 404 });
  return NextResponse.json({ tablas: cliente.deudasF36?.tablas ?? [], at: cliente.deudasF36?.at ?? null });
}
