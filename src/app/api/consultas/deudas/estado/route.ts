import { NextRequest, NextResponse } from "next/server";
import { getClienteAutorizado } from "@/lib/auth";
import { verificarEstadoPedidoF36 } from "@/lib/fraccionamiento";
import { setDeudaEstadoF36 } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 180;

// Verifica el ESTADO del pedido de deuda (proceso asíncrono de SUNAT) sin
// extraer. Guarda la trazabilidad (en-proceso / listo / vencido).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const cliente = await getClienteAutorizado(String(body?.clienteId ?? ""));
  if (!cliente) return NextResponse.json({ error: "Empresa no encontrada." }, { status: 404 });

  const solUser = (typeof body.solUser === "string" && body.solUser) || cliente.credSire?.solUser || "";
  const solPass = typeof body.solPass === "string" ? body.solPass : "";
  if (!solUser || !solPass) return NextResponse.json({ error: "Ingresa el Usuario y la Clave SOL." }, { status: 400 });

  const r = await verificarEstadoPedidoF36({ ruc: cliente.ruc, solUser, solPass, diagnostico: body.diagnostico === true });
  if (r.ok && r.estado && !body.diagnostico) {
    await setDeudaEstadoF36(cliente.id, {
      estado: r.estado,
      numPedido: r.numPedido,
      fechaPedido: r.fechaPedido,
      estadoTexto: r.estadoTexto,
      accion: r.accion,
    }).catch(() => {});
  }
  return NextResponse.json(r, { status: r.ok || body.diagnostico ? 200 : 400 });
}

// GET: estado guardado (sin clave), para pintar la trazabilidad al cargar.
export async function GET(req: NextRequest) {
  const cliente = await getClienteAutorizado(req.nextUrl.searchParams.get("clienteId") ?? "");
  if (!cliente) return NextResponse.json({ error: "Empresa no encontrada." }, { status: 404 });
  const d = cliente.deudasF36;
  return NextResponse.json({
    estado: d?.estado ?? "sin-pedido",
    numPedido: d?.numPedido ?? null,
    fechaPedido: d?.fechaPedido ?? null,
    estadoTexto: d?.estadoTexto ?? null,
    accion: d?.accion ?? null,
    generadoAt: d?.generadoAt ?? null,
    verificadoAt: d?.verificadoAt ?? null,
    at: d?.at ?? null,
  });
}
