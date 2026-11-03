import type { Usuario } from "./types";
import { enviarCorreo, correoConfigurado } from "./email";
import { getEstadoAlertas, setEstadoAlertas, getUserPorCodigoTelegram, setAlertasUsuario } from "./db";

// ============================================================
//  Canal de alertas: Telegram (bot) + correo (Resend)
// ============================================================
// Telegram no exige verificación de Meta: se crea el bot con @BotFather y se
// pone su token en TELEGRAM_BOT_TOKEN (y el usuario del bot en
// TELEGRAM_BOT_USERNAME para armar el enlace t.me/...?start=CODIGO). La
// vinculación NO usa webhook: cuando el usuario pulsa "Verificar", leemos los
// mensajes pendientes del bot (getUpdates) y buscamos su código.

const TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";
const BOT = (process.env.TELEGRAM_BOT_USERNAME ?? "").replace(/^@/, "");
const APP_URL = (process.env.APP_URL ?? "https://www.radartributaria.com").replace(/\/$/, "");

export function telegramConfigurado(): boolean { return Boolean(TOKEN); }
export function telegramBotUsername(): string { return BOT; }
export function enlaceVincular(codigo: string): string { return BOT ? `https://t.me/${BOT}?start=${codigo}` : ""; }

async function tg(metodo: string, body: Record<string, unknown>): Promise<any> {
  if (!TOKEN) throw new Error("Telegram no configurado (falta TELEGRAM_BOT_TOKEN).");
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/${metodo}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.description || `Telegram HTTP ${res.status}`);
  return data.result;
}

/** Envía un mensaje de Telegram (HTML básico). Nunca lanza. */
export async function telegramEnviar(chatId: string, html: string): Promise<{ ok: boolean; error?: string }> {
  try { await tg("sendMessage", { chat_id: chatId, text: html, parse_mode: "HTML", disable_web_page_preview: true }); return { ok: true }; }
  catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Error Telegram" }; }
}

/** Envía un DOCUMENTO (p. ej. el PDF de SUNAT) por Telegram, con pie opcional. Nunca lanza. */
export async function telegramEnviarDocumento(chatId: string, archivo: Buffer, nombre: string, captionHtml?: string): Promise<{ ok: boolean; error?: string }> {
  if (!TOKEN) return { ok: false, error: "Telegram no configurado (falta TELEGRAM_BOT_TOKEN)." };
  try {
    const fd = new FormData();
    fd.append("chat_id", chatId);
    if (captionHtml) { fd.append("caption", captionHtml.slice(0, 1000)); fd.append("parse_mode", "HTML"); }
    fd.append("document", new Blob([new Uint8Array(archivo)], { type: "application/pdf" }), nombre || "documento.pdf");
    const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendDocument`, { method: "POST", body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) return { ok: false, error: data.description || `Telegram HTTP ${res.status}` };
    return { ok: true };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Error Telegram" }; }
}

/** Lee los mensajes pendientes del bot y vincula los códigos "/start CODIGO" que
 *  coincidan con algún usuario. Devuelve cuántos vinculó y, si se pasa `userId`,
 *  si ese usuario quedó vinculado. */
export async function telegramProcesarVinculaciones(userId?: string): Promise<{ vinculados: number; esteVinculado: boolean; error?: string }> {
  if (!TOKEN) return { vinculados: 0, esteVinculado: false, error: "Telegram no configurado." };
  try {
    const estado = await getEstadoAlertas();
    const updates: any[] = await tg("getUpdates", { offset: estado.telegramOffset ?? 0, timeout: 0, allowed_updates: ["message"] });
    let vinculados = 0, esteVinculado = false, maxId = estado.telegramOffset ? estado.telegramOffset - 1 : 0;
    for (const u of updates) {
      maxId = Math.max(maxId, Number(u.update_id) || 0);
      const m = u.message;
      const texto = String(m?.text ?? "").trim();
      const chatId = String(m?.chat?.id ?? "");
      if (!texto || !chatId) continue;
      const cod = (texto.match(/^\/start\s+([A-Z0-9]{6,10})$/i) || texto.match(/^([A-Z0-9]{6,10})$/i))?.[1]?.toUpperCase();
      if (!cod) {
        if (/^\/start$/i.test(texto)) await telegramEnviar(chatId, "Hola 👋 Soy el bot de <b>Radar Tributar IA</b>. Para vincular tu cuenta, entra a la web → Alertas → “Vincular Telegram” y envíame el código que te muestra.");
        continue;
      }
      const usuario = await getUserPorCodigoTelegram(cod);
      if (!usuario) { await telegramEnviar(chatId, "Ese código no es válido o ya venció. Genera uno nuevo en la web (Alertas → Vincular Telegram)."); continue; }
      const nombre = [m.chat?.first_name, m.chat?.last_name].filter(Boolean).join(" ") || m.chat?.username || "";
      await setAlertasUsuario(usuario.id, { telegramChatId: chatId, telegramNombre: nombre, telegramCodigo: undefined, telegramCodigoAt: undefined });
      await telegramEnviar(chatId, `✅ Listo, <b>${escapar(usuario.nombre)}</b>. Desde ahora recibirás aquí las alertas de Radar: notificaciones SUNAT de tus empresas, vencimientos de declaración y avisos de tu plan.`);
      vinculados++;
      if (userId && usuario.id === userId) esteVinculado = true;
    }
    if (updates.length) await setEstadoAlertas({ telegramOffset: maxId + 1 });
    return { vinculados, esteVinculado };
  } catch (e) {
    return { vinculados: 0, esteVinculado: false, error: e instanceof Error ? e.message : "Error Telegram" };
  }
}

export function escapar(s: string): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export interface Alerta {
  titulo: string;
  texto: string;
  /** Ruta dentro de la web (se completa con APP_URL). */
  href?: string;
  /** "buzon" | "cronograma" | "plan" | "sistema" | "prueba" */
  tipo: string;
}

function htmlCorreo(a: Alerta): string {
  const url = a.href ? `${APP_URL}${a.href}` : APP_URL;
  return `
  <div style="font-family:system-ui,Arial,sans-serif;max-width:520px;margin:auto;color:#1e293b">
    <h2 style="color:#102b4d;margin:0 0 8px">Radar Tributar IA</h2>
    <p style="font-size:16px;font-weight:700;margin:0 0 6px">${escapar(a.titulo)}</p>
    <p style="font-size:14px;line-height:1.5;margin:0 0 14px">${escapar(a.texto)}</p>
    <a href="${url}" style="display:inline-block;background:#edb91e;color:#081a33;font-weight:700;padding:10px 16px;border-radius:10px;text-decoration:none">Ver en Radar</a>
    <p style="font-size:11px;color:#94a3b8;margin-top:18px">Recibes este aviso porque activaste las alertas en Radar. Puedes desactivarlas en la web (Alertas).</p>
  </div>`;
}

export interface AdjuntoAlerta { nombre: string; pdf: Buffer }
export interface ResultadoEnvio { telegram?: boolean; email?: boolean; adjuntoTelegram?: boolean; adjuntoEmail?: boolean; errores: string[] }

/** Envía una alerta a un usuario por los canales que tenga activos, con el PDF
 *  adjunto si se pasa (Telegram: como documento; correo: como adjunto). Nunca lanza. */
export async function enviarAlerta(u: Usuario, a: Alerta, adjunto?: AdjuntoAlerta | null): Promise<ResultadoEnvio> {
  const errores: string[] = [];
  const out: ResultadoEnvio = { errores };
  const url = a.href ? `${APP_URL}${a.href}` : APP_URL;
  if (u.alertas?.telegramChatId && TOKEN) {
    const texto = `<b>${escapar(a.titulo)}</b>\n${escapar(a.texto)}\n<a href="${url}">Ver en Radar</a>`;
    if (adjunto?.pdf?.length) {
      // Con PDF: el documento va con el texto como pie (un solo mensaje).
      const r = await telegramEnviarDocumento(u.alertas.telegramChatId, adjunto.pdf, adjunto.nombre, texto);
      out.telegram = r.ok; out.adjuntoTelegram = r.ok;
      if (!r.ok) {
        // Si el documento falla (tamaño, formato), al menos va el texto.
        const r2 = await telegramEnviar(u.alertas.telegramChatId, texto);
        out.telegram = r2.ok; errores.push(`Telegram adjunto: ${r.error}`);
        if (!r2.ok && r2.error) errores.push(`Telegram: ${r2.error}`);
      }
    } else {
      const r = await telegramEnviar(u.alertas.telegramChatId, texto);
      out.telegram = r.ok; if (!r.ok && r.error) errores.push(`Telegram: ${r.error}`);
    }
  }
  if (u.alertas?.email !== false && correoConfigurado() && u.email) {
    const adj = adjunto?.pdf?.length ? [{ filename: adjunto.nombre || "documento.pdf", content: adjunto.pdf }] : undefined;
    const r = await enviarCorreo(u.email, `Radar · ${a.titulo}`, htmlCorreo(a), adj);
    out.email = r.ok; out.adjuntoEmail = r.ok && Boolean(adj);
    if (!r.ok && r.error) errores.push(`Correo: ${r.error}`);
  }
  return out;
}

/** Código corto para vincular Telegram (sin caracteres confusos). */
export function nuevoCodigoTelegram(): string {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += abc[Math.floor(Math.random() * abc.length)];
  return s;
}
