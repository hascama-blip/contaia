import { NextRequest, NextResponse } from "next/server";
import { getClienteAutorizado } from "@/lib/auth";
import { consultarEstadoSire } from "@/lib/sire";

export const runtime = "nodejs";
export const maxDuration = 120;

// Estado SIRE (presentado / no presentado) de un rango de periodos, SIN bajar
// montos. Usa la API guardada del cliente + la Clave SOL (que NO se persiste).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const cliente = await getClienteAutorizado(params.id);
  if (!cliente) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
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
    return NextResponse.json({ estados: r.estados ?? [] });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Error consultando el estado del SIRE" },
      { status: 400 }
    );
  }
}
