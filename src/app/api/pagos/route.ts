import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, esAdmin, esSupremo, planEfectivo } from "@/lib/auth";
import { listPagos } from "@/lib/db";
import { pasarelaActiva, precioPara, estadoLanzamiento, iniciarPago, PRECIOS, type PlanPago } from "@/lib/pagos";

export const runtime = "nodejs";

// GET → lo que necesita la pantalla de pago: pasarela activa, precios que le
// tocan a este estudio, cupos de lanzamiento que quedan y su plan actual.
export async function GET() {
  const u = await getCurrentUser();
  if (!u) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const cfg = pasarelaActiva();
  const lanz = await estadoLanzamiento();
  const puedePagar = esAdmin(u) && !esSupremo(u);
  const precios = {
    regular: await precioPara(u, "regular"),
    premium: await precioPara(u, "premium"),
  };
  const pagos = puedePagar ? (await listPagos(u.id)).filter((p) => p.estado === "pagado").slice(0, 5) : [];
  return NextResponse.json({
    pasarela: cfg.pasarela,
    configurada: !!cfg.pasarela,
    puedePagar,
    plan: planEfectivo(u),
    planVence: u.planVence ?? null,
    precios,
    lanzamiento: lanz,
    pagos: pagos.map((p) => ({ plan: p.plan, montoCentimos: p.montoCentimos, pagadoAt: p.pagadoAt, vigenteHasta: p.vigenteHasta })),
  });
}

// POST { plan } → crea el pago pendiente y devuelve lo necesario para abrir la
// pasarela (Culqi: llave pública y monto; Mercado Pago: URL; Izipay: formToken).
export async function POST(req: NextRequest) {
  const u = await getCurrentUser();
  if (!u) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!esAdmin(u) || esSupremo(u)) {
    return NextResponse.json({ error: "Solo el líder del estudio puede pagar el plan (los operadores heredan su plan)." }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const plan = String(body.plan ?? "") as PlanPago;
  if (!PRECIOS[plan]) return NextResponse.json({ error: "Plan inválido." }, { status: 400 });
  try {
    return NextResponse.json(await iniciarPago(u, plan));
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "No se pudo iniciar el pago." }, { status: 502 });
  }
}
