import { limitar, reiniciar, ipDe, MIN } from "@/lib/limite";
import { NextRequest, NextResponse } from "next/server";
import { getUserByEmail, getUserById } from "@/lib/db";
import { verifyPassword, ensureSupremo, puedeIngresar, esSupremo, ponerSesion } from "@/lib/auth";
import { registrarAcceso } from "@/lib/registroAccesos";
import { enviarCodigo, comprobarCodigo } from "@/lib/codigos";
import { correoConfigurado } from "@/lib/email";
import { telegramConfigurado } from "@/lib/alertas";
import { limpiarCodigoUsuario } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  await ensureSupremo(); // garantiza que la cuenta supremo exista
  const body = await req.json().catch(() => null);
  const email = String(body?.email ?? "").trim().toLowerCase();
  const password = String(body?.password ?? "");

  // Anti fuerza bruta: 30 intentos/15 min por IP y 8 por correo.
  // Anti fuerza bruta: por IP, por correo+IP (otra persona no puede bloquearte
  // desde su conexión) y un tope alto por correo contra ataques distribuidos.
  const ip = ipDe(req);
  const _lim = limitar([
    { clave: `login-ip:${ip}`, max: 30, ventanaMs: 15 * MIN },
    { clave: `login-mail-ip:${email}:${ip}`, max: 8, ventanaMs: 15 * MIN },
    { clave: `login-mail:${email}`, max: 60, ventanaMs: 15 * MIN },
  ], "Demasiados intentos de inicio de sesión.");
  if (_lim) return _lim;
  if (!email || !password) {
    return NextResponse.json({ error: "Ingresa correo y contraseña." }, { status: 400 });
  }
  const user = await getUserByEmail(email);
  if (!user || !verifyPassword(password, user.passHash)) {
    void registrarAcceso({ ev: "login-fallido", email, uid: user?.id, ip, ua: req.headers.get("user-agent") ?? undefined, detalle: user ? "contraseña incorrecta" : "correo no registrado" });
    return NextResponse.json({ error: "Correo o contraseña incorrectos." }, { status: 401 });
  }

  // Control de acceso: la cuenta debe estar aprobada por el supremo.
  const parent = user.parentId ? await getUserById(user.parentId) : null;
  if (!puedeIngresar(user, parent)) {
    const rechazado = (user.parentId ? parent?.estado : user.estado) === "rechazado";
    return NextResponse.json(
      {
        error: rechazado
          ? "Tu solicitud de acceso fue rechazada. Contacta al administrador de la plataforma."
          : "Tu solicitud de acceso está pendiente de aprobación. Te avisaremos cuando se habilite.",
      },
      { status: 403 }
    );
  }

  // Cuenta registrada pero con el correo SIN verificar: no entra; el front
  // ofrece ingresar/reenviar el código.
  if (user.emailVerificado === false) {
    return NextResponse.json(
      { error: "Tu correo aún no está verificado. Ingresa el código que te enviamos (o pide uno nuevo).", noVerificado: true, email: user.email },
      { status: 403 }
    );
  }

  // Segundo paso para la cuenta supremo (SUPREMO_2FA=1): además de la
  // contraseña, un código de 6 dígitos que llega a su correo.
  //   El código va a SUPREMO_2FA_CORREO (un correo real; el del supremo suele
  //   ser genérico) y, si la cuenta supremo tiene Telegram vinculado, también ahí.
  const destino2fa = (process.env.SUPREMO_2FA_CORREO || "").trim();
  const tieneTelegram = Boolean(user.alertas?.telegramChatId && telegramConfigurado());
  if (esSupremo(user) && /^(1|true|si|sí)$/i.test(process.env.SUPREMO_2FA || "") && ((correoConfigurado() && destino2fa) || tieneTelegram)) {
    const codigo = String(body?.codigo ?? "").replace(/\D/g, "");
    if (!codigo) {
      const r = await enviarCodigo(user, "acceso", { destino: destino2fa || undefined, telegram: true });
      if (!r.ok && !r.esperar) return NextResponse.json({ error: r.error ?? "No se pudo enviar el código." }, { status: 502 });
      const oculto = (c: string) => c.replace(/^(.{2}).*(@.*)$/, "$1•••$2");
      const donde = [r.canales?.includes("correo") && destino2fa ? oculto(destino2fa) : null, r.canales?.includes("Telegram") ? "tu Telegram" : null].filter(Boolean).join(" y ");
      return NextResponse.json(
        { requiereCodigo: true, mensaje: r.esperar ? r.error : `Te enviamos un código de acceso a ${donde || "tu canal de seguridad"}.` },
        { status: 401 },
      );
    }
    const ok = await comprobarCodigo(user, codigo, "acceso");
    if (!ok.ok) return NextResponse.json({ error: ok.error, requiereCodigo: true }, { status: 401 });
    await limpiarCodigoUsuario(user.id);
  }

  reiniciar(`login-mail-ip:${email}:${ip}`);
  const res = NextResponse.json({ ok: true, user: { id: user.id, nombre: user.nombre, email: user.email } });
  // Cookie de SESIÓN (sin maxAge/expires): se borra al cerrar el navegador.
  await ponerSesion(res, user);
  void registrarAcceso({ ev: "login", uid: user.id, email: user.email, ip, ua: req.headers.get("user-agent") ?? undefined });
  return res;
}
