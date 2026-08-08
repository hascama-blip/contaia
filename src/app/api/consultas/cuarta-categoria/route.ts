import { NextRequest, NextResponse } from "next/server";
import { getClienteAutorizado } from "@/lib/auth";
import { esPersonaNatural } from "@/lib/types";
import { consultarCuartaCategoria } from "@/lib/cuartaCategoria";

export const runtime = "nodejs";
export const maxDuration = 200;

// Consulta MENSUAL de Ingresos de Cuarta Categoría (persona natural RUC 10/15).
// SUNAT lo muestra en pantalla; el bot entra a SOL, elige Mes/Año y lee el
// reporte. La Clave SOL NO se persiste.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const cliente = await getClienteAutorizado(String(body?.clienteId ?? ""));
  if (!cliente) return NextResponse.json({ error: "Empresa no encontrada." }, { status: 404 });
  if (!esPersonaNatural(cliente.ruc)) {
    return NextResponse.json({ error: "La consulta de 4ta categoría solo aplica a persona natural (RUC 10/15)." }, { status: 400 });
  }

  const solUser = (typeof body.solUser === "string" && body.solUser) || cliente.credSire?.solUser || "";
  const solPass = typeof body.solPass === "string" ? body.solPass : "";
  const mes = String(body.mes ?? "").replace(/\D/g, "").slice(0, 2);
  const anio = String(body.anio ?? "").replace(/\D/g, "").slice(0, 4);
  if (!solUser || !solPass) return NextResponse.json({ error: "Ingresa el Usuario SOL y la Clave SOL." }, { status: 400 });
  if (!/^(0[1-9]|1[0-2])$/.test(mes) || !/^\d{4}$/.test(anio)) {
    return NextResponse.json({ error: "Elige un Mes (01-12) y un Año válidos." }, { status: 400 });
  }

  const r = await consultarCuartaCategoria({ ruc: cliente.ruc, solUser, solPass, mes, anio, diagnostico: body.diagnostico === true });
  if (body.diagnostico === true) return NextResponse.json({ diag: r.diag });
  if (!r.ok) return NextResponse.json({ error: r.error ?? "No se pudo consultar la 4ta categoría.", diag: r.diag }, { status: r.loginError ? 401 : 502 });
  return NextResponse.json({ cuarta: r.cuarta, diag: r.diag });
}
