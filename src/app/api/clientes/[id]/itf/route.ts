import { NextRequest, NextResponse } from "next/server";
import { getClienteAutorizado, requireUser } from "@/lib/auth";
import { consultarItf } from "@/lib/itf";

export const runtime = "nodejs";
export const maxDuration = 200;

// POST → dispara el bot de ITF: login → módulo de ITF → lee el reporte en
// pantalla. La Clave SOL NO se persiste. Modo diagnóstico vuelca menú/estructura.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  await requireUser();
  const cliente = await getClienteAutorizado(params.id);
  if (!cliente) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const solUser = (typeof body.solUser === "string" && body.solUser) || cliente.credSire?.solUser || "";
  const solPass = typeof body.solPass === "string" ? body.solPass : "";
  const ejercicio = typeof body.ejercicio === "string" ? body.ejercicio : undefined;
  if (!solUser || !solPass) return NextResponse.json({ error: "Ingresa el Usuario SOL y la Clave SOL." }, { status: 400 });

  const r = await consultarItf({ ruc: cliente.ruc, solUser, solPass, ejercicio, diagnostico: body.diagnostico === true });
  if (body.diagnostico === true) return NextResponse.json({ diag: r.diag });
  if (!r.ok) return NextResponse.json({ error: r.error ?? "No se pudo consultar el ITF.", diag: r.diag }, { status: r.loginError ? 401 : 502 });
  return NextResponse.json({ itf: r.itf, diag: r.diag });
}
