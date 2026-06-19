import { NextRequest, NextResponse } from "next/server";
import { setDiagnostico } from "@/lib/db";
import { getClienteAutorizado } from "@/lib/auth";
import { generarDiagnostico } from "@/lib/diagnostico";

export const runtime = "nodejs";

// Genera (o regenera) el diagnóstico tributario combinando SUNAT + documentos.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const cliente = await getClienteAutorizado(params.id);
  if (!cliente) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  const diagnostico = generarDiagnostico(cliente);
  const actualizado = await setDiagnostico(cliente.id, diagnostico);
  return NextResponse.json({ cliente: actualizado, diagnostico });
}
