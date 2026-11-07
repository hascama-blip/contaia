import { resolverSecreto } from "@/lib/secretos";
import { limpiarDiagnostico } from "@/lib/acceso";
import { NextRequest, NextResponse } from "next/server";
import { getClienteAutorizado, getCurrentUser, esAdmin } from "@/lib/auth";
import { setSireEstado } from "@/lib/db";
import { consultarEstadoSire } from "@/lib/sire";
import { verificarCupo, consumirCupo, cupoAgotado } from "@/lib/cupos";

export const runtime = "nodejs";
export const maxDuration = 120;

// Pausa mínima entre actualizaciones exitosas del estado SIRE (se muestra lo
// guardado mientras tanto). El límite real es el cupo del plan. El admin puede forzar.
const PAUSA = Math.max(0, Number(process.env.SIRE_ESTADO_PAUSA_MIN ?? "60") || 0) * 60 * 1000;

// GET: estado SIRE guardado (sin clave/API), para mostrarlo sin re-consultar.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const cliente = await getClienteAutorizado(params.id);
  if (!cliente) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  return NextResponse.json({
    estados: cliente.sireEstado?.estados ?? [],
    noObligado: cliente.sireEstado?.noObligado ?? false,
    at: cliente.sireEstado?.at ?? null,
  });
}

// Estado SIRE (presentado / no presentado) de un rango de periodos, SIN bajar
// montos. Usa la API guardada del cliente + la Clave SOL (que NO se persiste).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const cliente = await getClienteAutorizado(params.id);
  if (!cliente) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  const body = await req.json().catch(() => ({}));

  await limpiarDiagnostico(body);

  // Pausa mínima (salvo diagnóstico o admin que fuerza).
  const ultima = cliente.sireEstado?.at ? new Date(cliente.sireEstado.at).getTime() : 0;
  if (ultima && Date.now() - ultima < PAUSA && !body.diagnostico) {
    const puedeForzar = body.forzar === true && esAdmin(await getCurrentUser());
    if (!puedeForzar) {
      const min = Math.ceil((PAUSA - (Date.now() - ultima)) / 60000);
      return NextResponse.json({
        estados: cliente.sireEstado?.estados ?? [],
        noObligado: cliente.sireEstado?.noObligado ?? false,
        at: cliente.sireEstado?.at ?? null,
        limitado: true,
        mensaje: `El estado SIRE se acaba de actualizar. Mostrando lo guardado; podrás actualizar en ~${min} min.`,
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
    resolverSecreto(body.clientSecret, cliente.credSire?.clientSecret) ||
    "";

  // Cupo del plan: generaciones de este paso por empresa al mes (salvo diagnóstico).
  const cupo = await verificarCupo(cliente.ruc, "sire-estado");
  if (!cupo.ok && !body.diagnostico) return NextResponse.json(cupoAgotado(cupo), { status: 429 });

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
      await setSireEstado(cliente.id, r.estados, r.noObligado).catch(() => {});
      if (cupo.ok) await consumirCupo(cupo.ticket);
    }
    return NextResponse.json({
      estados: r.estados ?? [],
      noObligado: r.noObligado ?? false,
      at: new Date().toISOString(),
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Error consultando el estado del SIRE" },
      { status: 400 }
    );
  }
}
