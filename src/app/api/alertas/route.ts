import { NextRequest, NextResponse } from "next/server";
import { requireUser, esSupremo, esAdmin, studioId } from "@/lib/auth";
import { setAlertasUsuario, getUserById, conBloqueoStore, listClientes, setAvisoVencimiento } from "@/lib/db";
import { proximosVencimientos } from "@/lib/cronogramaSunat";
import { correoConfigurado } from "@/lib/email";
import {
  telegramConfigurado, telegramBotUsername, enlaceVincular, nuevoCodigoTelegram,
  telegramProcesarVinculaciones, enviarAlerta,
} from "@/lib/alertas";

export const runtime = "nodejs";

const hoyLima = () => new Date(new Date().toLocaleString("en-US", { timeZone: "America/Lima" }));

/** Empresas del estudio con su próximo vencimiento y si tienen el aviso marcado. */
async function empresasVencimiento(u: NonNullable<Awaited<ReturnType<typeof getUserById>>>) {
  const clientes = (await listClientes(studioId(u), { todos: true })).filter((c) => !c.demo);
  const prox = new Map(proximosVencimientos(clientes.map((c) => ({ id: c.id, ruc: c.ruc, razonSocial: c.razonSocial })), 400, hoyLima()).map((p) => [p.clienteId, p]));
  return clientes
    .map((c) => ({ id: c.id, ruc: c.ruc, razonSocial: c.razonSocial, aviso: c.avisoVencimiento === true, vence: prox.get(c.id)?.fecha ?? null, dias: prox.get(c.id)?.dias ?? null }))
    .sort((x, y) => x.razonSocial.localeCompare(y.razonSocial));
}

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
    // Vencimientos: solo de las empresas marcadas (ninguna por defecto). Lo edita el admin del estudio.
    empresas: u ? await empresasVencimiento(u) : [],
    puedeElegirEmpresas: esAdmin(u) || esSupremo(u),
    // Una sola alerta de prueba por cuenta (cada envío consume Telegram/correo).
    // El supremo puede probar sin límite.
    pruebaDisponible: esSupremo(u) || !a.pruebaEnviadaAt,
    pruebaEnviadaAt: a.pruebaEnviadaAt ?? null,
  };
}

// GET → configuración de alertas del usuario.
export async function GET() {
  const user = await requireUser();
  return NextResponse.json(await estado(user.id));
}

// POST { accion } → codigo | verificar | desvincular | email | cronograma | vencimientoEmpresa | vencimientoTodas | prueba
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
  if (accion === "vencimientoEmpresa" || accion === "vencimientoTodas") {
    if (!esAdmin(user) && !esSupremo(user)) return NextResponse.json({ error: "Solo el administrador del estudio elige de qué empresas se avisa el vencimiento." }, { status: 403 });
    const ids = accion === "vencimientoTodas" ? "todas" : [String(body?.clienteId ?? "")];
    const n = await setAvisoVencimiento(studioId(user), ids, body?.valor !== false);
    if (!n) return NextResponse.json({ error: "Empresa no encontrada." }, { status: 404 });
    return NextResponse.json(await estado(user.id));
  }
  if (accion === "prueba") {
    const supremo = esSupremo(user);
    // Reserva la prueba ANTES de enviar (dentro del candado del store): dos
    // clics seguidos no pueden mandar dos pruebas.
    const reservada = supremo || (await conBloqueoStore(async () => {
      const actual = await getUserById(user.id);
      if (actual?.alertas?.pruebaEnviadaAt) return false;
      await setAlertasUsuario(user.id, { pruebaEnviadaAt: new Date().toISOString() });
      return true;
    }));
    if (!reservada) {
      return NextResponse.json({ error: "Ya usaste tu alerta de prueba. Desde ahora te llegarán solo las alertas reales." }, { status: 429 });
    }
    const u = (await getUserById(user.id))!;
    const r = await enviarAlerta(u, { tipo: "prueba", titulo: "Prueba de alertas de Radar", texto: "Si lees esto, tus alertas están funcionando. Así te avisaremos de notificaciones SUNAT, vencimientos de declaración y de tu plan.", href: "/" });
    const canales = [r.telegram ? "Telegram" : null, r.email ? "correo" : null].filter(Boolean);
    if (!canales.length) {
      // No salió por ningún canal: no se descuenta, puede volver a intentarlo.
      if (!supremo) await setAlertasUsuario(user.id, { pruebaEnviadaAt: undefined });
      return NextResponse.json({ error: `No se pudo enviar: ${r.errores.join(" · ") || "no hay canal activo"}. No se descontó tu prueba.` }, { status: 502 });
    }
    return NextResponse.json({ ok: true, mensaje: `Prueba enviada por ${canales.join(" y ")}.` });
  }
  return NextResponse.json({ error: "Acción inválida." }, { status: 400 });
}
