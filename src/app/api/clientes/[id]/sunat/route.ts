import { NextRequest, NextResponse } from "next/server";
import { setSunatInfo, setFechasSunat } from "@/lib/db";
import { getClienteAutorizado } from "@/lib/auth";
import { consultarSunat } from "@/lib/sunat";
import { logAccion } from "@/lib/auditoria";

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

// PATCH: guarda a mano las fechas que decolecta NO entrega (inscripción /
// inicio de actividades), sin re-consultar SUNAT.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const cliente = await getClienteAutorizado(params.id);
  if (!cliente) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  if (!cliente.sunat) return NextResponse.json({ error: "Primero consulta el RUC en SUNAT." }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const fechas: { fechaInscripcion?: string; fechaInicioActividades?: string } = {};
  if (typeof body.fechaInscripcion === "string") fechas.fechaInscripcion = body.fechaInscripcion.trim();
  if (typeof body.fechaInicioActividades === "string") fechas.fechaInicioActividades = body.fechaInicioActividades.trim();

  const actualizado = await setFechasSunat(cliente.id, fechas);
  if (!actualizado) return NextResponse.json({ error: "No se pudo guardar." }, { status: 400 });
  await logAccion({
    area: "Cliente",
    accion: "Actualizó fechas SUNAT (inscripción / inicio de actividades)",
    clienteId: cliente.id,
    clienteNombre: cliente.razonSocial,
  });
  return NextResponse.json({ cliente: actualizado, sunat: actualizado.sunat });
}
