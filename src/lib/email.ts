// Envío de correo transaccional vía Resend (HTTP, sin dependencias).
// Configurar en el entorno:
//   RESEND_API_KEY = re_xxx   (de https://resend.com)
//   EMAIL_FROM     = "Radar Tributar IA <no-reply@tudominio.com>"  (dominio verificado)

const RESEND_API_KEY = process.env.RESEND_API_KEY ?? "";
const EMAIL_FROM = process.env.EMAIL_FROM ?? "Radar Tributar IA <onboarding@resend.dev>";

export function correoConfigurado(): boolean {
  return Boolean(RESEND_API_KEY);
}

export interface AdjuntoCorreo { filename: string; content: Buffer | string }

/** Envía un correo (con adjuntos opcionales, p. ej. el PDF de SUNAT).
 *  Devuelve {ok} o {ok:false, error}. Nunca lanza. */
export async function enviarCorreo(
  to: string,
  subject: string,
  html: string,
  adjuntos?: AdjuntoCorreo[]
): Promise<{ ok: boolean; error?: string }> {
  if (!RESEND_API_KEY) return { ok: false, error: "Correo no configurado (falta RESEND_API_KEY)." };
  try {
    const attachments = (adjuntos ?? []).map((a) => ({
      filename: a.filename,
      content: Buffer.isBuffer(a.content) ? a.content.toString("base64") : a.content,
    }));
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: EMAIL_FROM, to, subject, html, ...(attachments.length ? { attachments } : {}) }),
    });
    if (!res.ok) {
      const detalle = await res.text().catch(() => "");
      return { ok: false, error: `Resend HTTP ${res.status} ${detalle.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error enviando correo." };
  }
}

/** Plantilla del correo con CÓDIGO de 6 dígitos (verificar correo / cambiar clave). */
export function htmlCodigo(nombre: string, codigo: string, proposito: "verificacion" | "reset"): string {
  const titulo = proposito === "verificacion" ? "Verifica tu correo" : "Cambia tu contraseña";
  const texto = proposito === "verificacion"
    ? "Gracias por registrarte. Ingresa este código en la pantalla de registro para activar tu cuenta:"
    : "Recibimos una solicitud para cambiar tu contraseña. Ingresa este código en la pantalla de recuperación:";
  return `
  <div style="font-family:system-ui,Arial,sans-serif;max-width:480px;margin:auto;color:#1e293b">
    <h2 style="color:#102b4d">Radar Tributar IA</h2>
    <p>Hola ${nombre || ""},</p>
    <p><b>${titulo}.</b> ${texto}</p>
    <p style="text-align:center;margin:24px 0">
      <span style="display:inline-block;font-size:32px;letter-spacing:10px;font-weight:800;background:#f1f5f9;color:#102b4d;padding:14px 22px;border-radius:10px">${codigo}</span>
    </p>
    <p style="font-size:13px;color:#64748b">El código vence en 10 minutos y solo sirve una vez. Si no fuiste tú, ignora este correo: nadie puede ${proposito === "verificacion" ? "activar la cuenta" : "cambiar tu contraseña"} sin este código.</p>
  </div>`;
}

/** Plantilla del correo de recuperación de contraseña por ENLACE (legacy). */
export function htmlReset(nombre: string, enlace: string): string {
  return `
  <div style="font-family:system-ui,Arial,sans-serif;max-width:480px;margin:auto;color:#1e293b">
    <h2 style="color:#102b4d">Radar Tributar IA</h2>
    <p>Hola ${nombre || ""},</p>
    <p>Recibimos una solicitud para restablecer tu contraseña. Pulsa el botón para crear una nueva:</p>
    <p style="text-align:center;margin:24px 0">
      <a href="${enlace}" style="background:#102b4d;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold">Cambiar contraseña</a>
    </p>
    <p style="font-size:13px;color:#64748b">Si no fuiste tú, ignora este correo. El enlace vence en 1 hora.</p>
    <p style="font-size:12px;color:#94a3b8">Si el botón no funciona, copia este enlace:<br>${enlace}</p>
  </div>`;
}
