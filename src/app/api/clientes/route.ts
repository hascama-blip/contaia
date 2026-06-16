import { NextRequest, NextResponse } from "next/server";
import { createCliente, listClientes } from "@/lib/db";
import { rucValido } from "@/lib/sunat";

export const runtime = "nodejs";

export async function GET() {
  const clientes = await listClientes();
  return NextResponse.json({ clientes });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.razonSocial !== "string" || typeof body.ruc !== "string") {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  if (!rucValido(body.ruc)) {
    return NextResponse.json(
      { error: "El RUC debe tener 11 dígitos numéricos." },
      { status: 400 }
    );
  }
  if (!body.razonSocial.trim()) {
    return NextResponse.json({ error: "La razón social es obligatoria." }, { status: 400 });
  }
  const cliente = await createCliente({
    razonSocial: body.razonSocial,
    ruc: body.ruc,
    email: body.email ?? "",
    telefono: body.telefono ?? "",
  });
  return NextResponse.json({ cliente }, { status: 201 });
}
