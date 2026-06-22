import { NextRequest, NextResponse } from "next/server";
import { getClienteAutorizado } from "@/lib/auth";
import { generarPedidoDeuda } from "@/lib/fraccionamiento";

export const runtime = "nodejs";
export const maxDuration = 300;

// FASE 1: genera el pedido de deuda (Art. 36, Tesoro). La Clave SOL no se guarda.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const cliente = await getClienteAutorizado(String(body?.clienteId ?? ""));
  if (!cliente) return NextResponse.json({ error: "Empresa no encontrada." }, { status: 404 });
  const solUser = (typeof body.solUser === "string" && body.solUser) || cliente.credSire?.solUser || "";
  const solPass = typeof body.solPass === "string" ? body.solPass : "";
  if (!solUser || !solPass) return NextResponse.json({ error: "Ingresa el Usuario y la Clave SOL." }, { status: 400 });

  const r = await generarPedidoDeuda({ ruc: cliente.ruc, solUser, solPass, diagnostico: body.diagnostico === true });
  return NextResponse.json(r, { status: r.ok || body.diagnostico ? 200 : 400 });
}
