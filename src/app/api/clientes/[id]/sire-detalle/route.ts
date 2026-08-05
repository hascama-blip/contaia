import { NextRequest, NextResponse } from "next/server";
import { getClienteAutorizado } from "@/lib/auth";
import { consultarDetalleSire } from "@/lib/sire";

export const runtime = "nodejs";
export const maxDuration = 120;

// Extrae el DETALLE SIRE (propuesta comprobante por comprobante) de un periodo.
// Usa las credenciales de la app SIRE guardadas del cliente (credSire) y recibe
// la Clave SOL solo para esta llamada (NO se persiste).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const cliente = await getClienteAutorizado(params.id);
  if (!cliente) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body.periodo !== "string") {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }

  const cred = cliente.credSire;
  const solUser = (typeof body.solUser === "string" && body.solUser) || cred?.solUser || "";
  const clientId = (typeof body.clientId === "string" && body.clientId) || cred?.clientId || "";
  const clientSecret = (typeof body.clientSecret === "string" && body.clientSecret) || cred?.clientSecret || "";

  try {
    const r = await consultarDetalleSire({
      ruc: cliente.ruc,
      periodo: body.periodo,
      solUser,
      solPass: typeof body.solPass === "string" ? body.solPass : "",
      clientId,
      clientSecret,
      incluirVentas: body.incluirVentas !== false,
      incluirCompras: body.incluirCompras !== false,
      diagnostico: body.diagnostico === true,
    });
    if (body.diagnostico) return NextResponse.json({ diag: r.diag });
    return NextResponse.json({ periodo: r.periodo, ventas: r.ventas, compras: r.compras, diag: r.diag });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Error consultando el detalle SIRE" }, { status: 400 });
  }
}
