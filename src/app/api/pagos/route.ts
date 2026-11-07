import { limitar, ipDe, MIN, HORA } from "@/lib/limite";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, esAdmin, esSupremo, planEfectivo } from "@/lib/auth";
import { listPagos } from "@/lib/db";
import { pasarelaActiva, precioPara, estadoLanzamiento, iniciarPago, modoPrueba, PRECIOS, type PlanPago } from "@/lib/pagos";

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
    modoPrueba: modoPrueba(cfg.pasarela),
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
  const _lim = limitar([{ clave: `pagos:${u.id}`, max: 10, ventanaMs: 10 * MIN }], "Demasiados intentos de pago.");
  if (_lim) return _lim;
  const body = await req.json().catch(() => ({}));
  const plan = String(body.plan ?? "") as PlanPago;
  if (!PRECIOS[plan]) return NextResponse.json({ error: "Plan inválido." }, { status: 400 });
  // El Plan Empresas es cotizado: pagar Regular/Premium lo rebajaría.
  if (planEfectivo(u) === "equipo") {
    return NextResponse.json({ error: "Tu cuenta tiene el Plan Empresas, que ya incluye todo. Para renovarlo o cambiarlo, escríbenos." }, { status: 409 });
  }
  try {
    return NextResponse.json(await iniciarPago(u, plan));
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "No se pudo iniciar el pago." }, { status: 502 });
  }
}
