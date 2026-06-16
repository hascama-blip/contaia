import { NextRequest, NextResponse } from "next/server";
import { getCliente, setSireResumen } from "@/lib/db";
import { consultarResumenSire } from "@/lib/sire";

export const runtime = "nodejs";
export const maxDuration = 60;

// Consulta el resumen SIRE (compras/ventas) de un periodo.
// Recibe la Clave SOL del cliente SOLO para esta llamada; NO se persiste.
// Se guardan únicamente los totales resultantes.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const cliente = await getCliente(params.id);
  if (!cliente) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body.periodo !== "string") {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }

  try {
    const resumen = await consultarResumenSire({
      ruc: cliente.ruc,
      periodo: body.periodo,
      solUser: typeof body.solUser === "string" ? body.solUser : "",
      solPass: typeof body.solPass === "string" ? body.solPass : "",
      clientId: typeof body.clientId === "string" ? body.clientId : undefined,
      clientSecret:
        typeof body.clientSecret === "string" ? body.clientSecret : undefined,
    });
    const actualizado = await setSireResumen(cliente.id, resumen);
    return NextResponse.json({ resumen, cliente: actualizado });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Error consultando SIRE" },
      { status: 400 }
    );
  }
}
