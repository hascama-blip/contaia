import { NextRequest, NextResponse } from "next/server";
import { getClienteAutorizado, getCurrentUser, esSupremo } from "@/lib/auth";
import { getBuzonAdjunto, setBuzonAdjunto } from "@/lib/db";
import { descargarAdjuntoBuzon } from "@/lib/buzon";
import { enviarAlerta, telegramConfigurado } from "@/lib/alertas";
import { correoConfigurado } from "@/lib/email";

export const runtime = "nodejs";
export const maxDuration = 180;

// SOLO SUPREMO: simula que el mensaje indicado "acaba de llegar" y envía la
// alerta tal cual la recibiría el dueño de la empresa, PERO a los canales del
// supremo (su Telegram / su correo), con el PDF adjunto: desde caché o, si se
// pasa la Clave SOL, descargándolo de SUNAT (y guardándolo).
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!esSupremo(user)) return NextResponse.json({ error: "Solo el supremo puede probar envíos." }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const cliente = await getClienteAutorizado(String(body?.clienteId ?? ""));
  if (!cliente) return NextResponse.json({ error: "Empresa no encontrada." }, { status: 404 });
  const codMensaje = String(body?.codMensaje ?? "");
  const todos = cliente.buzon?.mensajes?.length ? cliente.buzon.mensajes : [...(cliente.buzon?.peligrosos ?? []), ...(cliente.buzon?.urgentes ?? [])];
  const m = todos.find((x) => x.id === codMensaje);
  if (!m) return NextResponse.json({ error: "Ese mensaje no está en el historial guardado del buzón." }, { status: 404 });

  const pasos: string[] = [];
  if (!telegramConfigurado()) pasos.push("Telegram no configurado en la plataforma (falta TELEGRAM_BOT_TOKEN).");
  else if (!user!.alertas?.telegramChatId) pasos.push("Tu Telegram no está vinculado (Alertas → Vincular Telegram).");
  if (!correoConfigurado()) pasos.push("Correo no configurado (falta RESEND_API_KEY).");

  // 1) Adjunto: caché → o descarga en vivo si hay Clave SOL.
  let adjunto: { nombre: string; pdf: Buffer } | null = null;
  let origenAdjunto: "cache" | "sunat" | "ninguno" = "ninguno";
  let errorAdjunto: string | undefined;
  const cache = await getBuzonAdjunto(cliente.id, codMensaje);
  if (cache) { adjunto = cache; origenAdjunto = "cache"; }
  else {
    const solUser = (typeof body.solUser === "string" && body.solUser) || cliente.credSire?.solUser || "";
    const solPass = typeof body.solPass === "string" ? body.solPass : "";
    if (solUser && solPass) {
      const r = await descargarAdjuntoBuzon({ ruc: cliente.ruc, solUser, solPass, codMensaje, asunto: m.asunto, fecha: m.fecha, origen: m.origen, adjuntos: m.adjuntos });
      if (r.ok && r.pdfBase64) {
        const pdf = Buffer.from(r.pdfBase64, "base64");
        const nombre = r.filename ?? `mensaje-${codMensaje}.pdf`;
        await setBuzonAdjunto(cliente.id, codMensaje, pdf, nombre, { id: user!.id, nombre: user!.nombre }).catch(() => {});
        adjunto = { nombre, pdf }; origenAdjunto = "sunat";
      } else errorAdjunto = r.error ?? "SUNAT no entregó el PDF.";
    } else errorAdjunto = "El PDF no está guardado y no se recibió la Clave SOL para descargarlo.";
  }

  // 2) Envío (a los canales del supremo), exactamente como lo recibiría el dueño.
  const nivel = m.nivel === "peligroso" ? "⚠️ PELIGROSO · " : m.nivel === "urgente" ? "🔴 URGENTE · " : "";
  const env = await enviarAlerta(user!, {
    tipo: "buzon",
    titulo: `[PRUEBA] ${nivel}${cliente.razonSocial} (RUC ${cliente.ruc}) recibió una notificación SUNAT`,
    texto: `${m.fecha ? `El ${m.fecha}: ` : ""}${m.asunto}. Debe ser atendida.`,
    href: `/clientes/${cliente.id}`,
  }, adjunto);

  return NextResponse.json({
    ok: Boolean(env.telegram || env.email),
    telegram: env.telegram ?? null,
    email: env.email ?? null,
    adjunto: adjunto ? { nombre: adjunto.nombre, kb: Math.round(adjunto.pdf.length / 1024), origen: origenAdjunto, telegram: env.adjuntoTelegram ?? false, email: env.adjuntoEmail ?? false } : null,
    errorAdjunto,
    avisos: pasos,
    errores: env.errores,
  });
}
