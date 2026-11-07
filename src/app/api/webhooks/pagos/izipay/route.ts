import { NextRequest, NextResponse } from "next/server";
import { getPago } from "@/lib/db";
import { izipayFirmaValida, izipayLeerRespuesta, confirmarPago } from "@/lib/pagos";

export const runtime = "nodejs";

// IPN de Izipay (público, sin sesión): llega como formulario con kr-answer y
// kr-hash. La firma se valida con la CONTRASEÑA REST (HMAC-SHA256) y solo si el
// pedido está PAID se activa el plan. Responde 200 para que Izipay no reintente.
export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const krAnswer = String(form?.get("kr-answer") ?? "");
  const krHash = String(form?.get("kr-hash") ?? "");
  if (!izipayFirmaValida(krAnswer, krHash, "ipn")) return new NextResponse("firma invalida", { status: 400 });
  const a = izipayLeerRespuesta(krAnswer);
  if (!a?.pagoId) return new NextResponse("OK", { status: 200 });
  const pago = await getPago(a.pagoId);
  if (pago && pago.proveedor === "izipay" && a.pagado) {
    await confirmarPago(pago.id, { referencia: a.referencia, montoCentimos: a.montoCentimos });
  }
  return new NextResponse("OK", { status: 200 });
}
