import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { setAlertasUsuario, getUserById } from "@/lib/db";
import { correoConfigurado } from "@/lib/email";
import {
  telegramConfigurado, telegramBotUsername, enlaceVincular, nuevoCodigoTelegram,
  telegramProcesarVinculaciones, enviarAlerta,
} from "@/lib/alertas";

export const runtime = "nodejs";

async function estado(userId: string) {
  const u = await getUserById(userId);
  const a = u?.alertas ?? {};
  const codigoVigente = a.telegramCodigo && a.telegramCodigoAt && Date.now() - new Date(a.telegramCodigoAt).getTime() < 15 * 60 * 1000;
  return {
    telegramDisponible: telegramConfigurado(),
    bot: telegramBotUsername(),
    telegramVinculado: Boolean(a.telegramChatId),
    telegramNombre: a.telegramNombre ?? "",
    codigo: codigoVigente ? a.telegramCodigo : null,
    enlace: codigoVigente && a.telegramCodigo ? enlaceVincular(a.telegramCodigo) : null,
    email: a.email !== false,
    emailDisponible: correoConfigurado(),
    correo: u?.email ?? "",
    cronograma: a.cronograma !== false,
  };
}

// GET → configuración de alertas del usuario.
export async function GET() {
  const user = await requireUser();
  return NextResponse.json(await estado(user.id));
}

// POST { accion } → codigo | verificar | desvincular | email | cronograma | prueba
export async function POST(req: NextRequest) {
  const user = await requireUser();
  const body = await req.json().catch(() => ({}));
  const accion = String(body?.accion ?? "");

  if (accion === "codigo") {
    if (!telegramConfigurado()) return NextResponse.json({ error: "Telegram no está configurado en la plataforma." }, { status: 400 });
    await setAlertasUsuario(user.id, { telegramCodigo: nuevoCodigoTelegram(), telegramCodigoAt: new Date().toISOString() });
    return NextResponse.json(await estado(user.id));
  }
  if (accion === "verificar") {
    const r = await telegramProcesarVinculaciones(user.id);
    const e = await estado(user.id);
    return NextResponse.json({ ...e, mensaje: e.telegramVinculado ? "✅ Telegram vinculado." : (r.error ?? "Aún no llega tu mensaje al bot. Envía el código y vuelve a verificar.") });
  }
  if (accion === "desvincular") {
    await setAlertasUsuario(user.id, { telegramChatId: undefined, telegramNombre: undefined, telegramCodigo: undefined, telegramCodigoAt: undefined });
    return NextResponse.json(await estado(user.id));
  }
  if (accion === "email" || accion === "cronograma") {
    await setAlertasUsuario(user.id, { [accion]: body?.valor !== false } as any);
    return NextResponse.json(await estado(user.id));
  }
  if (accion === "prueba") {
    const u = (await getUserById(user.id))!;
    const r = await enviarAlerta(u, { tipo: "prueba", titulo: "Prueba de alertas de Radar", texto: "Si lees esto, tus alertas están funcionando. Así te avisaremos de notificaciones SUNAT, vencimientos de declaración y de tu plan.", href: "/" });
    const canales = [r.telegram ? "Telegram" : null, r.email ? "correo" : null].filter(Boolean);
    return NextResponse.json({ ok: canales.length > 0, mensaje: canales.length ? `Enviado por ${canales.join(" y ")}.` : `No se pudo enviar: ${r.errores.join(" · ") || "no hay canal activo"}.` });
  }
  return NextResponse.json({ error: "Acción inválida." }, { status: 400 });
}
