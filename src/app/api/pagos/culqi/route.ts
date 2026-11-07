import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getPago, marcarPago } from "@/lib/db";
import { culqiCargo, confirmarPago } from "@/lib/pagos";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST { pagoId, token, email } → crea el cargo en Culqi con la llave SECRETA
// (el token viene del checkout de Culqi: tarjeta o Yape) y, si se aprueba,
// activa el plan. El navegador nunca decide si el pago fue exitoso.
export async function POST(req: NextRequest) {
  const u = await getCurrentUser();
  if (!u) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const pago = await getPago(String(body.pagoId ?? ""));
  if (!pago || pago.userId !== u.id) return NextResponse.json({ error: "Pago no encontrado." }, { status: 404 });
  if (pago.proveedor !== "culqi") return NextResponse.json({ error: "Este pago no es de Culqi." }, { status: 400 });
  if (pago.estado === "pagado") return NextResponse.json({ ok: true, pago });
  const token = String(body.token ?? "");
  if (!/^(tkn|ype|tok)_[\w-]+$/i.test(token)) return NextResponse.json({ error: "Token de pago inválido." }, { status: 400 });

  const r = await culqiCargo(pago, token, String(body.email ?? ""));
  if (!r.ok) {
    await marcarPago(pago.id, { estado: "rechazado", detalle: r.error });
    return NextResponse.json({ error: r.error ?? "Pago rechazado." }, { status: 402 });
  }
  const c = await confirmarPago(pago.id, { referencia: r.referencia, montoCentimos: pago.montoCentimos });
  if (!c.ok) return NextResponse.json({ error: c.error ?? "No se pudo activar el plan." }, { status: 500 });
  return NextResponse.json({ ok: true, pago: c.pago });
}
