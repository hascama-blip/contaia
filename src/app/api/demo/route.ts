import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, studioId, esSupremo, esAdmin } from "@/lib/auth";
import { guardarEmpresasDemo, borrarEmpresasDemo, listClientes, setDiagnostico, getCliente, upsertVisorMatriz, setModoGrabacion } from "@/lib/db";
import { empresasDemo, PERFILES, DEMO_PREFIJO } from "@/lib/demo";
import { generarDiagnostico } from "@/lib/diagnostico";
import { hoyLima } from "@/lib/fechas";

export const runtime = "nodejs";

// Empresas de SIMULACIÓN para demos y videos: el supremo y las cuentas a las que
// el supremo les habilitó el permiso (Usuario.permisoDemo).
//   GET                      → cuántas hay + estado del modo grabación
//   POST { accion: "crear" } → crea (o regenera) las 4 empresas ficticias del estudio
//   POST { accion: "borrar" }→ las elimina (solo las de este estudio)
//   POST { accion: "grabacion", activar: bool } → MODO GRABACIÓN 12 h: oculta las
//        empresas reales en todas las listas (solo se ven las de simulación).
async function permitido() {
  const u = await getCurrentUser();
  if (!u) return { error: NextResponse.json({ error: "No autenticado" }, { status: 401 }) };
  if (!esSupremo(u) && !(u.permisoDemo && esAdmin(u))) {
    return { error: NextResponse.json({ error: "El modo simulación no está habilitado para tu cuenta." }, { status: 403 }) };
  }
  return { u };
}

export async function GET() {
  const p = await permitido(); if (p.error) return p.error;
  const u = p.u!;
  const todas = await listClientes(studioId(u), { todos: true });
  const n = todas.filter((c) => c.id.startsWith(DEMO_PREFIJO)).length;
  const grab = u.modoGrabacionHasta && u.modoGrabacionHasta > new Date().toISOString() ? u.modoGrabacionHasta : null;
  return NextResponse.json({ empresas: n, total: PERFILES.length, grabacionHasta: grab, ocultas: todas.length - n });
}

export async function POST(req: NextRequest) {
  const p = await permitido(); if (p.error) return p.error;
  const u = p.u!;
  const body = await req.json().catch(() => ({}));
  if (body?.accion === "grabacion") {
    const hasta = await setModoGrabacion(u.id, body.activar === true ? 12 : null);
    return NextResponse.json({ ok: true, grabacionHasta: hasta });
  }
  if (body?.accion === "borrar") {
    const n = await borrarEmpresasDemo(studioId(u), u.id, PERFILES.map((x) => x.ruc));
    return NextResponse.json({ ok: true, borradas: n });
  }
  const hoy = hoyLima();
  // El supremo usa ids "demo-<clave>"; las demás cuentas, con un sufijo propio.
  const sufijo = esSupremo(u) ? "" : studioId(u).replace(/[^A-Za-z0-9]/g, "").slice(0, 10);
  const empresas = empresasDemo(studioId(u), hoy, sufijo);
  await guardarEmpresasDemo(empresas);
  for (const e of empresas) {
    const c = await getCliente(e.id);
    if (c) await setDiagnostico(c.id, generarDiagnostico(c));
  }
  // Visor Tributario: cuadro presentado / no presentado de cada empresa.
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
