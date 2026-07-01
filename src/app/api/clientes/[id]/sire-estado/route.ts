import { NextRequest, NextResponse } from "next/server";
import { getClienteAutorizado, getCurrentUser, esAdmin } from "@/lib/auth";
import { setSireEstado } from "@/lib/db";
import { consultarEstadoSire } from "@/lib/sire";
import { chequearUso, registrarUso } from "@/lib/usos";

export const runtime = "nodejs";
export const maxDuration = 120;

// Cooldown: el estado SIRE se actualiza 1 vez por semana (se muestra lo guardado
// mientras tanto). El admin puede forzar.
const UNA_SEMANA = 7 * 24 * 60 * 60 * 1000;

// GET: estado SIRE guardado (sin clave/API), para mostrarlo sin re-consultar.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const cliente = await getClienteAutorizado(params.id);
  if (!cliente) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  return NextResponse.json({
    estados: cliente.sireEstado?.estados ?? [],
    at: cliente.sireEstado?.at ?? null,
  });
}

// Estado SIRE (presentado / no presentado) de un rango de periodos, SIN bajar
// montos. Usa la API guardada del cliente + la Clave SOL (que NO se persiste).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const cliente = await getClienteAutorizado(params.id);
  if (!cliente) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  const body = await req.json().catch(() => ({}));

  // Cooldown semanal (salvo diagnóstico o admin que fuerza).
  const ultima = cliente.sireEstado?.at ? new Date(cliente.sireEstado.at).getTime() : 0;
  if (ultima && Date.now() - ultima < UNA_SEMANA && !body.diagnostico) {
    const puedeForzar = body.forzar === true && esAdmin(await getCurrentUser());
    if (!puedeForzar) {
      const dias = Math.ceil((UNA_SEMANA - (Date.now() - ultima)) / (24 * 60 * 60 * 1000));
      return NextResponse.json({
        estados: cliente.sireEstado?.estados ?? [],
        at: cliente.sireEstado?.at ?? null,
        limitado: true,
        mensaje: `El estado SIRE se actualiza 1 vez por semana. Mostrando lo guardado; podrás actualizar en ~${dias} día(s).`,
      });
    }
  }
  const periodos: string[] = Array.isArray(body.periodos)
    ? body.periodos.map((p: any) => String(p))
    : [];

  // Credenciales: la API guardada del cliente; el usuario/clave del cuerpo.
  const solUser =
    (typeof body.solUser === "string" && body.solUser) || cliente.credSire?.solUser || "";
  const solPass = typeof body.solPass === "string" ? body.solPass : "";
  const clientId =
    (typeof body.clientId === "string" && body.clientId) || cliente.credSire?.clientId || "";
  const clientSecret =
    (typeof body.clientSecret === "string" && body.clientSecret) ||
    cliente.credSire?.clientSecret ||
    "";

  // Cupo del módulo gratis (salvo diagnóstico).
  const uso = await chequearUso();
  if (!uso.ok && !body.diagnostico) {
    return NextResponse.json({ error: uso.mensaje, sinUsos: true, renuevaAt: uso.renuevaAt }, { status: 429 });
  }

  try {
    const r = await consultarEstadoSire({
      ruc: cliente.ruc,
      periodos,
      solUser,
      solPass,
      clientId,
      clientSecret,
      diagnostico: body.diagnostico === true,
    });
    if (r.diag && !r.estados) return NextResponse.json({ diag: r.diag });
    // Persistir el estado para no re-consultar hasta la próxima semana.
    if (r.estados && r.estados.length && !body.diagnostico) {
      await setSireEstado(cliente.id, r.estados).catch(() => {});
      if (uso.ok) await registrarUso(uso.adminId, uso.ilimitado);
    }
    return NextResponse.json({ estados: r.estados ?? [], at: new Date().toISOString() });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Error consultando el estado del SIRE" },
      { status: 400 }
    );
  }
}
