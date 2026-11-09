import { limpiarDiagnostico } from "@/lib/acceso";
import { esClienteDemo, demoNoDisponible, demoSunat, demoSire, demoSireEstado, demoSireDetalle, demoBuzon, demoItf } from "@/lib/demoRutas";
import { NextRequest, NextResponse } from "next/server";
import { getClienteAutorizado, requireUser } from "@/lib/auth";
import { setItfReporte } from "@/lib/db";
import { consultarItf } from "@/lib/itf";
import { verificarCupo, consumirCupo, cupoAgotado } from "@/lib/cupos";

export const runtime = "nodejs";
export const maxDuration = 200;

// POST → dispara el bot de ITF: login → módulo de ITF → lee el reporte en
// pantalla. La Clave SOL NO se persiste. Modo diagnóstico vuelca menú/estructura.
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  await requireUser();
  const cliente = await getClienteAutorizado(params.id);
  if (!cliente) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  if (esClienteDemo(cliente)) return demoItf(cliente);

  const body = await req.json().catch(() => ({}));

  await limpiarDiagnostico(body);
  const solUser = (typeof body.solUser === "string" && body.solUser) || cliente.credSire?.solUser || "";
  const solPass = typeof body.solPass === "string" ? body.solPass : "";
  const ejercicio = typeof body.ejercicio === "string" ? body.ejercicio : undefined;
  if (!solUser || !solPass) return NextResponse.json({ error: "Ingresa el Usuario SOL y la Clave SOL." }, { status: 400 });

  const cupo = await verificarCupo(cliente.ruc, "itf");
  if (!cupo.ok && body.diagnostico !== true) return NextResponse.json(cupoAgotado(cupo), { status: 429 });

  const r = await consultarItf({ ruc: cliente.ruc, solUser, solPass, ejercicio, diagnostico: body.diagnostico === true });
  if (body.diagnostico === true) return NextResponse.json({ diag: r.diag });
  if (!r.ok) return NextResponse.json({ error: r.error ?? "No se pudo consultar el ITF.", diag: r.diag }, { status: r.loginError ? 401 : 502 });
  if (cupo.ok) await consumirCupo(cupo.ticket);
  // Persistimos el reporte (aunque venga vacío) para el informe.
  if (r.itf) await setItfReporte(params.id, r.itf).catch(() => {});
  return NextResponse.json({ itf: r.itf, diag: r.diag });
}
