import { NextRequest, NextResponse } from "next/server";
import { getClienteAutorizado, getCurrentUser } from "@/lib/auth";
import { setSeguimientoBuzon, atenderSeguimientoBuzon } from "@/lib/db";
import { logAccion } from "@/lib/auditoria";

export const runtime = "nodejs";

const DIAS_VALIDOS = [5, 10, 15];

// Guardar (o actualizar) el seguimiento de un mensaje: plazo + comentario.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const cliente = await getClienteAutorizado(String(body?.clienteId ?? ""));
  if (!cliente) return NextResponse.json({ error: "Empresa no encontrada." }, { status: 404 });

  const codMensaje = String(body?.codMensaje ?? "");
  if (!codMensaje) return NextResponse.json({ error: "Falta el mensaje." }, { status: 400 });
  const diasAtencion = Number(body?.diasAtencion);
  if (!DIAS_VALIDOS.includes(diasAtencion)) {
    return NextResponse.json({ error: "El plazo debe ser 5, 10 o 15 días." }, { status: 400 });
  }

  const autor = await getCurrentUser();
  const seg = await setSeguimientoBuzon(cliente.id, {
    codMensaje,
    asunto: String(body?.asunto ?? ""),
    fecha: String(body?.fecha ?? ""),
    origen: body?.origen === "mensajes" ? "mensajes" : body?.origen === "notificaciones" ? "notificaciones" : undefined,
    diasAtencion,
    comentario: String(body?.comentario ?? ""),
    creadoPorId: autor?.id,
    creadoPorNombre: autor?.nombre,
  });
  await logAccion({
    area: "Buzón",
    accion: "Guardó un seguimiento (plazo / comentario)",
    clienteId: cliente.id,
    clienteNombre: cliente.razonSocial,
    detalle: `Plazo ${diasAtencion} día(s)${body?.comentario ? ` · "${String(body.comentario).slice(0, 60)}"` : ""}`,
  });
  return NextResponse.json({ seguimiento: seg });
}

// Listar los seguimientos guardados de una empresa (para prellenar la tabla).
export async function GET(req: NextRequest) {
  const cliente = await getClienteAutorizado(req.nextUrl.searchParams.get("clienteId") ?? "");
  if (!cliente) return NextResponse.json({ error: "Empresa no encontrada." }, { status: 404 });
  return NextResponse.json({ seguimientos: cliente.seguimientosBuzon ?? [] });
}

// Marcar atendido / no atendido (quita o repone el recordatorio).
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const cliente = await getClienteAutorizado(String(body?.clienteId ?? ""));
  if (!cliente) return NextResponse.json({ error: "Empresa no encontrada." }, { status: 404 });
  const atendido = body?.atendido !== false;
  const ok = await atenderSeguimientoBuzon(cliente.id, String(body?.codMensaje ?? ""), atendido);
  if (ok) {
    await logAccion({
      area: "Buzón",
      accion: atendido ? "Marcó un seguimiento como atendido" : "Reabrió un seguimiento",
      clienteId: cliente.id,
      clienteNombre: cliente.razonSocial,
    });
  }
  return NextResponse.json({ ok });
}
