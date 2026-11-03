// ============================================================
//  Códigos de 6 dígitos: verificación de correo y cambio de contraseña
// ============================================================
// Un código se genera al azar, se envía por correo y SOLO se guarda su hash
// (con el id del usuario y un secreto como "pepper"). Vence a los 10 minutos,
// admite 5 intentos y se puede reenviar cada 60 s. Lo usan registro,
// verificación, reenvío y "olvidé mi contraseña".

import { createHash, randomInt, timingSafeEqual } from "crypto";
import type { Usuario } from "./types";
import { setCodigoUsuario, incIntentosCodigo, limpiarCodigoUsuario } from "./db";
import { enviarCorreo, htmlCodigo, correoConfigurado } from "./email";

export const CODIGO_VIGENCIA_MIN = 10;
export const CODIGO_MAX_INTENTOS = 5;
export const CODIGO_REENVIO_SEG = 60;
const PEPPER = process.env.AUTH_SECRET || "radar-tributario-dev-secret-cambiar-en-produccion";

export type TipoCodigo = "verificacion" | "reset";

function hashCodigo(uid: string, codigo: string): string {
  return createHash("sha256").update(`${uid}:${codigo}:${PEPPER}`).digest("hex");
}
function generarCodigo(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/** Genera, guarda y envía un código al correo del usuario (respeta el throttle). */
export async function enviarCodigo(u: Usuario, tipo: TipoCodigo): Promise<{ ok: boolean; error?: string; esperar?: number }> {
  if (!correoConfigurado()) {
    return { ok: false, error: "El envío de correo no está configurado en el servidor (falta RESEND_API_KEY)." };
  }
  if (u.codigoEnviadoAt && u.codigoTipo === tipo) {
    const transcurrido = (Date.now() - new Date(u.codigoEnviadoAt).getTime()) / 1000;
    if (transcurrido < CODIGO_REENVIO_SEG) {
      const esperar = Math.ceil(CODIGO_REENVIO_SEG - transcurrido);
      return { ok: false, esperar, error: `Ya te enviamos un código. Espera ${esperar} s para pedir otro.` };
    }
  }
  const codigo = generarCodigo();
  const exp = new Date(Date.now() + CODIGO_VIGENCIA_MIN * 60 * 1000).toISOString();
  await setCodigoUsuario(u.id, { hash: hashCodigo(u.id, codigo), exp, tipo });
  const asunto = tipo === "verificacion"
    ? `${codigo} es tu código de verificación — Radar Tributar IA`
    : `${codigo} es tu código para cambiar la contraseña — Radar Tributar IA`;
  const r = await enviarCorreo(u.email, asunto, htmlCodigo(u.nombre, codigo, tipo));
  if (!r.ok) {
    await limpiarCodigoUsuario(u.id);
    return { ok: false, error: "No se pudo enviar el correo. Intenta de nuevo en unos minutos." };
  }
  return { ok: true };
}

/** Comprueba un código: vencimiento, intentos y coincidencia (tiempo constante). */
export async function comprobarCodigo(u: Usuario, codigo: string, tipo: TipoCodigo): Promise<{ ok: boolean; error?: string }> {
  if (!u.codigoHash || !u.codigoExp || u.codigoTipo !== tipo) {
    return { ok: false, error: "No hay un código vigente. Solicita uno nuevo." };
  }
  if (new Date(u.codigoExp).getTime() < Date.now()) {
    await limpiarCodigoUsuario(u.id);
    return { ok: false, error: "El código venció. Solicita uno nuevo." };
  }
  if ((u.codigoIntentos ?? 0) >= CODIGO_MAX_INTENTOS) {
    await limpiarCodigoUsuario(u.id);
    return { ok: false, error: "Demasiados intentos. Solicita un código nuevo." };
  }
  const limpio = String(codigo || "").replace(/\D/g, "");
  const esperado = Buffer.from(u.codigoHash, "hex");
  const recibido = Buffer.from(hashCodigo(u.id, limpio.padStart(6, "0")), "hex");
  const coincide = limpio.length === 6 && esperado.length === recibido.length && timingSafeEqual(esperado, recibido);
  if (!coincide) {
    const n = await incIntentosCodigo(u.id);
    const restan = Math.max(0, CODIGO_MAX_INTENTOS - n);
    return { ok: false, error: restan ? `Código incorrecto. Te quedan ${restan} intento(s).` : "Demasiados intentos. Solicita un código nuevo." };
  }
  return { ok: true };
}
