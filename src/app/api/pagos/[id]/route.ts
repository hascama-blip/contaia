import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getPago } from "@/lib/db";
import { mpConsultarPago, confirmarPago } from "@/lib/pagos";

export const runtime = "nodejs";

// GET → estado de un pago del usuario. Al volver de Mercado Pago llega con
// ?payment_id=: se CONSULTA ese pago a la API de Mercado Pago (no se confía en
// los parámetros de la URL) y, si está aprobado y es de este pago, se activa.
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const u = await getCurrentUser();
  if (!u) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  let pago = await getPago(params.id);
  if (!pago || pago.userId !== u.id) return NextResponse.json({ error: "Pago no encontrado." }, { status: 404 });

  const paymentId = req.nextUrl.searchParams.get("payment_id") ?? "";
  if (pago.estado === "pendiente" && pago.proveedor === "mercadopago" && paymentId) {
    const mp = await mpConsultarPago(paymentId);
    if (mp && mp.pagoId === pago.id && mp.aprobado) {
      const c = await confirmarPago(pago.id, { referencia: mp.referencia, montoCentimos: mp.montoCentimos });
      if (c.pago) pago = c.pago;
    } else if (mp && mp.pagoId === pago.id && ["rejected", "cancelled"].includes(mp.estado)) {
      return NextResponse.json({ estado: "rechazado", plan: pago.plan, detalle: `Mercado Pago: ${mp.estado}` });
    }
  }
  return NextResponse.json({ estado: pago.estado, plan: pago.plan, vigenteHasta: pago.vigenteHasta ?? null, montoCentimos: pago.montoCentimos });
}
