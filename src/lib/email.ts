// Envío de correo transaccional vía Resend (HTTP, sin dependencias).
// Configurar en el entorno:
//   RESEND_API_KEY = re_xxx   (de https://resend.com)
//   EMAIL_FROM     = "Radar Tributar IA <no-reply@tudominio.com>"  (dominio verificado)

const RESEND_API_KEY = process.env.RESEND_API_KEY ?? "";
const EMAIL_FROM = process.env.EMAIL_FROM ?? "Radar Tributar IA <onboarding@resend.dev>";

export function correoConfigurado(): boolean {
  return Boolean(RESEND_API_KEY);
}

/** Envía un correo. Devuelve {ok} o {ok:false, error}. Nunca lanza. */
export async function enviarCorreo(
  to: string,
  subject: string,
  html: string
): Promise<{ ok: boolean; error?: string }> {
  if (!RESEND_API_KEY) return { ok: false, error: "Correo no configurado (falta RESEND_API_KEY)." };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: EMAIL_FROM, to, subject, html }),
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

/** Plantilla del correo de recuperación de contraseña. */
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
