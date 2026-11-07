import { puedeVerIssosoma } from "@/lib/acceso";
import { getCurrentUser as _usuarioIsso } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { analizarIssosoma, recalcularIssosoma, leerCache, issosomaConfig } from "@/lib/issosoma";

export const runtime = "nodejs";
export const maxDuration = 800;
export const dynamic = "force-dynamic";

// GET  → análisis cacheado (rápido). Si no hay caché, intenta calcular.
// POST → recalcula TODO desde Drive (lento: recorre bitácoras + facturas) y cachea.
export async function GET() {
  if (!puedeVerIssosoma(await _usuarioIsso())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  if (!(await getCurrentUser())) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  try {
    const data = await analizarIssosoma();
    return NextResponse.json(data);
  } catch (err: any) {
    const cache = await leerCache();
    if (cache) return NextResponse.json({ ...cache, error: `No se pudo refrescar: ${err?.message ?? err}` });
    const cfg = issosomaConfig();
    return NextResponse.json({ configurado: cfg.configurado, faltan: cfg.faltan, error: err?.message ?? "Error leyendo ISSOSOMA", proyectos: [], facturas: [], egresosGenerales: [], gastos: [], avisos: [], kpis: { venta: 0, costo: 0, utilidad: 0, margen: 0, egresosGenerales: 0, resultado: 0, proyectos: 0, proyectosConVenta: 0 }, generadoAt: new Date().toISOString() });
  }
}

export async function POST(req: NextRequest) {
  if (!puedeVerIssosoma(await _usuarioIsso())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  if (!(await getCurrentUser())) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  try {
    const data = await recalcularIssosoma({ completo: body?.completo === true });
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Error recalculando ISSOSOMA" }, { status: 400 });
  }
}
