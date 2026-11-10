import { bloqueoSupremo } from "@/lib/acceso";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { registrarWebhookRTT } from "@/lib/db";

export const runtime = "nodejs";

// Inserta un evento de PRUEBA en la bitácora del webhook. Sirve para confirmar
// que la app + la bitácora + la vista funcionan (aísla el problema de entrega
// del correo real por SendGrid). SOLO SUPREMO.
export async function POST() {
  const _bloqueo = await bloqueoSupremo(); if (_bloqueo) return _bloqueo; // prueba interna: solo supremo
  await requireUser();
  await registrarWebhookRTT({
    ruc: "",
    resultado: "PRUEBA (botón): la app y la bitácora del webhook funcionan. Falta que el correo real entre por SendGrid.",
    from: "prueba-interna",
  });
  return NextResponse.json({ ok: true });
}
