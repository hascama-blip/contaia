import { NextRequest, NextResponse } from "next/server";
import { createCliente, getClienteByRuc, listClientes, setCredSire } from "@/lib/db";
import { requireUser, studioId, esAdmin } from "@/lib/auth";
import { rucValido } from "@/lib/sunat";

export const runtime = "nodejs";

export async function GET() {
  const user = await requireUser();
  const clientes = await listClientes(studioId(user));
  return NextResponse.json({ clientes });
}

export async function POST(req: NextRequest) {
  const user = await requireUser();
  // Crear empresa: solo el admin del estudio (los operadores no pueden).
  if (!esAdmin(user)) {
    return NextResponse.json({ error: "Solo el administrador del estudio puede crear empresas." }, { status: 403 });
  }
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
  // Un solo cliente por RUC EN EL ESPACIO DEL USUARIO (evita duplicados).
  const existente = await getClienteByRuc(body.ruc, studioId(user));
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
    ownerId: user.id,
  });
  // Credenciales SOL del alta: se guardan Usuario SOL + API (la Clave SOL NO).
  const cred = body.cred;
  if (cred && typeof cred === "object" && typeof cred.solUser === "string" && cred.solUser.trim()) {
    const actualizado = await setCredSire(cliente.id, {
      solUser: cred.solUser.trim(),
      clientId: typeof cred.clientId === "string" ? cred.clientId.trim() : "",
      clientSecret: typeof cred.clientSecret === "string" ? cred.clientSecret.trim() : "",
      guardadoAt: new Date().toISOString(),
    });
    if (actualizado) cliente.credSire = actualizado.credSire;
  }
  return NextResponse.json({ cliente }, { status: 201 });
}
