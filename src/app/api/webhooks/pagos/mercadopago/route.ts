import { NextRequest, NextResponse } from "next/server";
import { getPago } from "@/lib/db";
import { mpConsultarPago, confirmarPago } from "@/lib/pagos";
import { leerCuerpoLimitado, limitar, ipDe, MIN } from "@/lib/limite";

export const runtime = "nodejs";

// Webhook de Mercado Pago (público, sin sesión). Mercado Pago avisa con el id del
// pago (?type=payment&data.id=… o en el cuerpo). NO se confía en el aviso: se
// consulta el pago a su API con nuestro token y solo si está "approved" y su
// external_reference es uno de nuestros pagos, se activa el plan.
async function procesar(req: NextRequest) {
  // Ruta pública: límite por IP (cada aviso dispara una consulta a Mercado Pago)
  // y cuerpo de 64 KB como máximo.
  const _lim = limitar([{ clave: `ipn-mp:${ipDe(req)}`, max: 120, ventanaMs: MIN }]);
  if (_lim) return _lim;
  const q = req.nextUrl.searchParams;
  let body: any = {};
  if (req.method === "POST") {
    const crudo = await leerCuerpoLimitado(req, 64 * 1024);
    if (crudo === null) return NextResponse.json({ error: "demasiado grande" }, { status: 413 });
    try { body = crudo ? JSON.parse(crudo) : {}; } catch { body = {}; }
  }
  const tipo = String(body?.type ?? body?.topic ?? q.get("type") ?? q.get("topic") ?? "");
  const id = String(body?.data?.id ?? q.get("data.id") ?? q.get("id") ?? "");
  if (tipo && tipo !== "payment") return NextResponse.json({ ok: true, ignorado: tipo });
  if (!id) return NextResponse.json({ ok: true });
  const mp = await mpConsultarPago(id);
  if (!mp) return NextResponse.json({ ok: false }, { status: 200 });
  const pago = mp.pagoId ? await getPago(mp.pagoId) : null;
  if (!pago || pago.proveedor !== "mercadopago") return NextResponse.json({ ok: true, desconocido: true });
  if (mp.aprobado) await confirmarPago(pago.id, { referencia: mp.referencia, montoCentimos: mp.montoCentimos });
  return NextResponse.json({ ok: true });
}

export const POST = procesar;
export const GET = procesar;
