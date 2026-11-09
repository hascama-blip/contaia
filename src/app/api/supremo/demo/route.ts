import { NextRequest, NextResponse } from "next/server";
import { bloqueoSupremo } from "@/lib/acceso";
import { getCurrentUser, studioId } from "@/lib/auth";
import { guardarEmpresasDemo, borrarEmpresasDemo, listClientes, setDiagnostico, getCliente, upsertVisorMatriz } from "@/lib/db";
import { empresasDemo, PERFILES, DEMO_PREFIJO } from "@/lib/demo";
import { generarDiagnostico } from "@/lib/diagnostico";
import { hoyLima } from "@/lib/fechas";

export const runtime = "nodejs";

// Empresas de SIMULACIÓN para demos y videos (solo supremo).
//   GET                      → cuántas hay
//   POST { accion: "crear" } → crea (o regenera) las 4 empresas ficticias con datos en todos los módulos
//   POST { accion: "borrar" }→ las elimina (y su cuadro del Visor)
export async function GET() {
  const b = await bloqueoSupremo(); if (b) return b;
  const u = (await getCurrentUser())!;
  const n = (await listClientes(studioId(u))).filter((c) => c.id.startsWith(DEMO_PREFIJO)).length;
  return NextResponse.json({ empresas: n, total: PERFILES.length });
}

export async function POST(req: NextRequest) {
  const b = await bloqueoSupremo(); if (b) return b;
  const u = (await getCurrentUser())!;
  const body = await req.json().catch(() => ({}));
  if (body?.accion === "borrar") {
    const n = await borrarEmpresasDemo(PERFILES.map((p) => p.ruc));
    return NextResponse.json({ ok: true, borradas: n });
  }
  const hoy = hoyLima();
  const empresas = empresasDemo(studioId(u), hoy);
  await guardarEmpresasDemo(empresas);
  // Diagnóstico (score y hallazgos) con los datos ficticios.
  for (const e of empresas) {
    const c = await getCliente(e.id);
    if (c) await setDiagnostico(c.id, generarDiagnostico(c));
  }
  // Visor Tributario: cuadro de presentado / no presentado de cada empresa.
  for (const e of empresas) {
    if (e.negocio === "sin") continue;
    for (const libro of ["ventas", "compras"] as const) {
      const celdas: Record<string, "P" | "NP"> = {};
      for (const s of e.sire) celdas[`${s.periodo.slice(0, 4)}-${s.periodo.slice(4)}`] = (libro === "ventas" ? s.presentadoVentas : s.presentadoCompras) ? "P" : "NP";
      await upsertVisorMatriz(u.id, { empresa: e.razonSocial, ruc: e.ruc, tipo: `sire-${libro}`, celdas, anios: {} });
    }
  }
  return NextResponse.json({ ok: true, creadas: empresas.length, empresas: empresas.map((e) => ({ id: e.id, razonSocial: e.razonSocial, ruc: e.ruc })) });
}
