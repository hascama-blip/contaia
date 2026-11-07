import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, esSupremo } from "@/lib/auth";
import { listPagos, listAdmins, setLimitesCotizados } from "@/lib/db";
import { estadoLanzamiento, pasarelaActiva, modoPrueba } from "@/lib/pagos";

export const runtime = "nodejs";

async function soloSupremo() {
  const u = await getCurrentUser();
  return u && esSupremo(u) ? u : null;
}

// GET → pagos recibidos, cupos de lanzamiento, estado de la pasarela y las
// cuentas del Plan Empresas con sus límites pactados.
export async function GET() {
  if (!(await soloSupremo())) return NextResponse.json({ error: "Solo el supremo." }, { status: 403 });
  const cfg = pasarelaActiva();
  const pagos = (await listPagos()).slice(0, 100);
  const empresas = (await listAdmins())
    .filter((u) => u.plan === "equipo")
    .map((u) => ({ id: u.id, nombre: u.nombre, email: u.email, planVence: u.planVence ?? null, limites: u.limitesCotizados ?? null }));
  const pagado = pagos.filter((p) => p.estado === "pagado" && !p.prueba);
  return NextResponse.json({
    pasarela: cfg.pasarela,
    falta: cfg.falta,
    modoPrueba: modoPrueba(cfg.pasarela),
    lanzamiento: await estadoLanzamiento(),
    totalCentimos: pagado.reduce((a, p) => a + p.montoCentimos, 0),
    pagos,
    empresas,
  });
}

// POST { userId, generaciones, comprobantes } → límites del Plan Empresas
// (0 = sin límite; vacío = el valor por defecto del plan).
export async function POST(req: NextRequest) {
  if (!(await soloSupremo())) return NextResponse.json({ error: "Solo el supremo." }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const num = (v: any) => (v === "" || v == null ? undefined : Math.max(0, Math.floor(Number(v)) || 0));
  const lim = { generaciones: num(b.generaciones), comprobantes: num(b.comprobantes) };
  const vacio = lim.generaciones === undefined && lim.comprobantes === undefined;
  const u = await setLimitesCotizados(String(b.userId ?? ""), vacio ? null : lim);
  if (!u) return NextResponse.json({ error: "Cuenta no encontrada." }, { status: 404 });
  return NextResponse.json({ ok: true, limites: u.limitesCotizados ?? null });
}
