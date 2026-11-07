import { NextRequest, NextResponse } from "next/server";
import { getPago } from "@/lib/db";
import { izipayFirmaValida, izipayLeerRespuesta, confirmarPago } from "@/lib/pagos";
import { leerCuerpoLimitado, limitar, ipDe, MIN } from "@/lib/limite";

export const runtime = "nodejs";

// IPN de Izipay (público, sin sesión): llega como formulario con kr-answer y
// kr-hash. La firma se valida con la CONTRASEÑA REST (HMAC-SHA256) y solo si el
// pedido está PAID se activa el plan. Responde 200 para que Izipay no reintente.
export async function POST(req: NextRequest) {
  // Ruta pública: límite de envíos por IP y cuerpo de 64 KB como máximo.
  const _lim = limitar([{ clave: `ipn-izipay:${ipDe(req)}`, max: 120, ventanaMs: MIN }]);
  if (_lim) return _lim;
  const crudo = await leerCuerpoLimitado(req, 64 * 1024);
  if (crudo === null) return new NextResponse("demasiado grande", { status: 413 });
  const form = new URLSearchParams(crudo);
  const krAnswer = String(form.get("kr-answer") ?? "");
  const krHash = String(form.get("kr-hash") ?? "");
  const krHashKey = String(form.get("kr-hash-key") ?? "");
  if (!izipayFirmaValida(krAnswer, krHash, "ipn", krHashKey)) return new NextResponse("firma invalida", { status: 400 });
  const a = izipayLeerRespuesta(krAnswer);
  if (!a?.pagoId) return new NextResponse("OK", { status: 200 });
  const pago = await getPago(a.pagoId);
  if (pago && pago.proveedor === "izipay" && a.pagado) {
    await confirmarPago(pago.id, { referencia: a.referencia, montoCentimos: a.montoCentimos });
  }
  return new NextResponse("OK", { status: 200 });
}
