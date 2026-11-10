import { NextRequest, NextResponse } from "next/server";
import { bloqueoModulo } from "@/lib/acceso";
import { getClienteAutorizado } from "@/lib/auth";
import { setPlaneamiento } from "@/lib/db";
import { hoyLima } from "@/lib/fechas";
import { armarProyeccion, limpiarEntradas, periodosConSire } from "@/lib/proyeccion";

export const runtime = "nodejs";

const PERIODO = /^\d{4}(0[1-9]|1[0-2])$/;

// Utilitario "Proyección tributaria": NO consulta SUNAT. Lee el SIRE del mes
// (Reporte analítico) y el Detalle SIRE ya generados para la empresa.
// GET ?cliente=&periodo=AAAAMM → fuentes disponibles + proyección.
export async function GET(req: NextRequest) {
  const _b = await bloqueoModulo("proyeccion"); if (_b) return _b;
  const sp = req.nextUrl.searchParams;
  const cliente = await getClienteAutorizado(sp.get("cliente") ?? "");
  if (!cliente) return NextResponse.json({ error: "Empresa no encontrada." }, { status: 404 });
  const periodo = sp.get("periodo") ?? "";
  if (!PERIODO.test(periodo)) return NextResponse.json({ error: "Periodo inválido (AAAAMM)." }, { status: 400 });
  return NextResponse.json({ proyeccion: armarProyeccion(cliente, periodo, hoyLima()), periodos: periodosConSire(cliente) });
}

// POST { cliente, periodo, regimen, coeficiente, saldoFavorIgv, percepciones, retenciones, saldoFavorRenta }
// → guarda los datos MANUALES del periodo (crédito a favor de la DJ anterior, etc.).
export async function POST(req: NextRequest) {
  const _b = await bloqueoModulo("proyeccion"); if (_b) return _b;
  const body = await req.json().catch(() => ({}));
  const cliente = await getClienteAutorizado(String(body?.cliente ?? ""));
  if (!cliente) return NextResponse.json({ error: "Empresa no encontrada." }, { status: 404 });
  const periodo = String(body?.periodo ?? "");
  if (!PERIODO.test(periodo)) return NextResponse.json({ error: "Periodo inválido (AAAAMM)." }, { status: 400 });
  const act = await setPlaneamiento(cliente.id, periodo, { ...limpiarEntradas(body), at: new Date().toISOString() });
  if (!act) return NextResponse.json({ error: "No se pudo guardar." }, { status: 500 });
  return NextResponse.json({ ok: true, proyeccion: armarProyeccion(act, periodo, hoyLima()) });
}
