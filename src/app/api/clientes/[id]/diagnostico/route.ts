import { NextRequest, NextResponse } from "next/server";
import { getCliente, setDiagnostico } from "@/lib/db";
import { generarDiagnostico } from "@/lib/diagnostico";

export const runtime = "nodejs";

// Genera (o regenera) el diagnóstico tributario combinando SUNAT + documentos.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const cliente = await getCliente(params.id);
  if (!cliente) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  const diagnostico = generarDiagnostico(cliente);
  const actualizado = await setDiagnostico(cliente.id, diagnostico);
  return NextResponse.json({ cliente: actualizado, diagnostico });
}
