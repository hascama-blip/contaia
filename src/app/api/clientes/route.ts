import { NextRequest, NextResponse } from "next/server";
import { createCliente, getClienteByRuc, listClientes } from "@/lib/db";
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
  // Un solo cliente por RUC: si ya existe, no se crea otro (evita duplicados).
  const existente = await getClienteByRuc(body.ruc);
  if (existente) {
    return NextResponse.json(
      {
        error: `Ya existe un cliente con el RUC ${body.ruc.trim()} (${existente.razonSocial}).`,
        clienteId: existente.id,
      },
      { status: 409 }
    );
  }
  // Si el formulario adjunta la info SUNAT ya consultada, la guardamos
  // siempre que el RUC coincida (evita inyectar datos de otro contribuyente).
  const sunat =
    body.sunat && typeof body.sunat === "object" && body.sunat.ruc === body.ruc.trim()
      ? body.sunat
      : null;
  const cliente = await createCliente({
    razonSocial: body.razonSocial,
    ruc: body.ruc,
    email: body.email ?? "",
    telefono: body.telefono ?? "",
    sunat,
  });
  return NextResponse.json({ cliente }, { status: 201 });
}
