import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { analizarIssosoma, issosomaConfig } from "@/lib/issosoma";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

// GET → análisis financiero de ISSOSOMA (ingresos/egresos/utilidad + viáticos)
// leído en vivo de la carpeta Drive por cuenta de servicio.
export async function GET() {
  if (!(await getCurrentUser())) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  try {
    const data = await analizarIssosoma();
    return NextResponse.json(data);
  } catch (err: any) {
    const cfg = issosomaConfig();
    return NextResponse.json(
      { configurado: cfg.configurado, faltan: cfg.faltan, error: err?.message ?? "Error leyendo ISSOSOMA", archivos: [], kpis: { ingresos: 0, egresos: 0, utilidad: 0, margen: 0, viaticos: 0, movimientos: 0 }, viaticos: [], porMes: [], porCategoria: [], porSede: [], porPersona: [], generadoAt: new Date().toISOString() },
      { status: 200 },
    );
  }
}
