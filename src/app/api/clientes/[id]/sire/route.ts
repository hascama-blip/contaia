import { NextRequest, NextResponse } from "next/server";
import { clearSire, getCliente, setSireResumen } from "@/lib/db";
import { consultarResumenSire } from "@/lib/sire";

export const runtime = "nodejs";
export const maxDuration = 120;

// Limpia (borra) todos los resúmenes SIRE guardados del cliente, para volver a
// descargar otro rango/periodo desde cero.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const cliente = await getCliente(params.id);
  if (!cliente) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  const actualizado = await clearSire(cliente.id);
  return NextResponse.json({ cliente: actualizado });
}

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
    const resultado = await consultarResumenSire({
      ruc: cliente.ruc,
      periodo: body.periodo,
      solUser: typeof body.solUser === "string" ? body.solUser : "",
      solPass: typeof body.solPass === "string" ? body.solPass : "",
      clientId: typeof body.clientId === "string" ? body.clientId : undefined,
      clientSecret:
        typeof body.clientSecret === "string" ? body.clientSecret : undefined,
      real: body.real === true,
      diagnostico: body.diagnostico === true,
    });
    // Modo diagnóstico: devuelve la traza cruda, sin persistir.
    if (!resultado.resumen) {
      return NextResponse.json({ diag: resultado.diag });
    }
    const actualizado = await setSireResumen(cliente.id, resultado.resumen);
    return NextResponse.json({
      resumen: resultado.resumen,
      cliente: actualizado,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Error consultando SIRE" },
      { status: 400 }
    );
  }
}
