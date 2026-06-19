import { NextRequest, NextResponse } from "next/server";
import { getCliente, setBuzon } from "@/lib/db";
import { consultarBuzon } from "@/lib/buzon";

export const runtime = "nodejs";
export const maxDuration = 120;

// Consulta el buzón electrónico SUNAT. La Clave SOL se usa solo para esta
// llamada y NO se persiste.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const cliente = await getCliente(params.id);
  if (!cliente) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  try {
    const resultado = await consultarBuzon({
      ruc: cliente.ruc,
      solUser: typeof body.solUser === "string" ? body.solUser : "",
      solPass: typeof body.solPass === "string" ? body.solPass : "",
      clientId: typeof body.clientId === "string" ? body.clientId : undefined,
      clientSecret: typeof body.clientSecret === "string" ? body.clientSecret : undefined,
      dias: typeof body.dias === "number" ? body.dias : 15,
      diagnostico: body.diagnostico === true,
    });
    // Persistir los urgentes para el informe (no en modo diagnóstico).
    if (!resultado.diag) {
      await setBuzon(cliente.id, {
        peligrosos: resultado.peligrosos,
        urgentes: resultado.urgentes,
        mensajes: resultado.mensajes,
        totalMensajes: resultado.mensajes.length,
        consultadoAt: new Date().toISOString(),
      });
    }
    return NextResponse.json(resultado);
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Error consultando buzón" },
      { status: 400 }
    );
  }
}
