import { NextRequest, NextResponse } from "next/server";
import { setSunatInfo } from "@/lib/db";
import { getClienteAutorizado } from "@/lib/auth";
import { consultarSunat } from "@/lib/sunat";

export const runtime = "nodejs";

// Consulta el estado tributario del cliente en SUNAT y lo persiste.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const cliente = await getClienteAutorizado(params.id);
  if (!cliente) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  try {
    const info = await consultarSunat(cliente.ruc);
    const actualizado = await setSunatInfo(cliente.id, info);
    return NextResponse.json({ cliente: actualizado, sunat: info });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Error consultando SUNAT" },
      { status: 400 }
    );
  }
}
