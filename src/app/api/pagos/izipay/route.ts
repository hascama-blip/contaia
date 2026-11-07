import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getPago } from "@/lib/db";
import { izipayFirmaValida, izipayLeerRespuesta, confirmarPago } from "@/lib/pagos";

export const runtime = "nodejs";

// POST { krAnswer, krHash } → retorno del formulario de Izipay en el navegador.
// Se valida la FIRMA (HMAC-SHA256 con la clave HMAC) antes de activar el plan.
// El IPN (webhook) hace lo mismo por si el navegador se cierra antes.
export async function POST(req: NextRequest) {
  const u = await getCurrentUser();
  if (!u) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const krAnswer = typeof body.krAnswer === "string" ? body.krAnswer : "";
  const krHash = typeof body.krHash === "string" ? body.krHash : "";
  const krHashKey = typeof body.krHashKey === "string" ? body.krHashKey : undefined;
  if (!izipayFirmaValida(krAnswer, krHash, "navegador", krHashKey)) return NextResponse.json({ error: "Firma de Izipay inválida." }, { status: 400 });
  const a = izipayLeerRespuesta(krAnswer);
  if (!a) return NextResponse.json({ error: "Respuesta de Izipay ilegible." }, { status: 400 });
  const pago = await getPago(a.pagoId);
  if (!pago || pago.userId !== u.id) return NextResponse.json({ error: "Pago no encontrado." }, { status: 404 });
  if (!a.pagado) return NextResponse.json({ error: "El pago no fue aprobado." }, { status: 402 });
  const c = await confirmarPago(pago.id, { referencia: a.referencia, montoCentimos: a.montoCentimos });
  if (!c.ok) return NextResponse.json({ error: c.error ?? "No se pudo activar el plan." }, { status: 500 });
  return NextResponse.json({ ok: true, pago: c.pago });
}
