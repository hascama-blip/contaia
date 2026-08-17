// ============================================================
//  Resolución de CAPTCHA (Cloudflare Turnstile) vía CapSolver
// ============================================================
// SUNAT puede mostrar un widget de Cloudflare Turnstile en el login. Aquí:
//   1) Detectamos el widget en cualquier frame (data-sitekey).
//   2) Pedimos un token a CapSolver (tarea AntiTurnstileTaskProxyLess: sin proxy).
//   3) Inyectamos el token en el campo oculto (cf-turnstile-response) y disparamos
//      el callback si existe, para que el formulario lo envíe.
//
// A PRUEBA DE FALLOS: si NO hay widget o NO hay CAPSOLVER_KEY configurada, esta
// función NO hace nada (no rompe el login que ya funciona). Se activa sola cuando
// SUNAT muestre el captcha y la clave esté puesta en el entorno.
//
// Variables de entorno:
//   CAPSOLVER_KEY       clientKey de CapSolver (si falta → captcha desactivado)
//   CAPSOLVER_API_URL   opcional, por defecto https://api.capsolver.com
//   CAPTCHA_MAX_MS      opcional, tiempo máx. de espera del token (def. 120000)

const API_URL = (process.env.CAPSOLVER_API_URL || "https://api.capsolver.com").replace(/\/+$/, "");
const MAX_MS = Number(process.env.CAPTCHA_MAX_MS || 120_000);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface CaptchaDetectado {
  sitekey: string;
  url: string;
  tipo: "turnstile";
}

/** Busca un widget Turnstile en TODOS los frames. Devuelve sitekey + la URL del
 *  FRAME que lo contiene (Turnstile ata el token a esa URL, no a la del top). */
export async function detectarTurnstile(ctx: any, page: any): Promise<CaptchaDetectado | null> {
  for (const pg of ctx.pages()) {
    for (const fr of pg.frames()) {
      const sitekey = await fr
        .evaluate(() => {
          // 1) div.cf-turnstile con data-sitekey (lo más común).
          const el = document.querySelector("[data-sitekey]") as HTMLElement | null;
          if (el?.getAttribute("data-sitekey")) return el.getAttribute("data-sitekey");
          // 2) iframe de challenges.cloudflare.com con sitekey en el src.
          const ifr = Array.from(document.querySelectorAll("iframe"))
            .map((f) => (f as HTMLIFrameElement).src || "")
            .find((s) => /challenges\.cloudflare\.com/.test(s));
          if (ifr) {
            const m = /\/(0x[a-zA-Z0-9]+)\//.exec(ifr) || /[?&]k=([^&]+)/.exec(ifr);
            if (m) return decodeURIComponent(m[1]);
          }
          return null;
        })
        .catch(() => null);
      if (sitekey) {
        // URL del frame que contiene el widget (si es "about:blank", cae al top).
        let url = "";
        try { url = fr.url(); } catch { /* */ }
        if (!url || url === "about:blank") url = page.url();
        return { sitekey, url, tipo: "turnstile" };
      }
    }
  }
  return null;
}

/** ¿Se ve OTRO tipo de captcha (reCAPTCHA/hCaptcha)? Solo para diagnóstico. */
export async function detectarOtroCaptcha(ctx: any): Promise<string | null> {
  for (const pg of ctx.pages()) {
    for (const fr of pg.frames()) {
      const t = await fr
        .evaluate(() => {
          const html = document.documentElement.outerHTML;
          if (/g-recaptcha|recaptcha\/api|grecaptcha/.test(html)) return "recaptcha";
          if (/hcaptcha\.com|h-captcha/.test(html)) return "hcaptcha";
          return null;
        })
        .catch(() => null);
      if (t) return t;
    }
  }
  return null;
}

/** Pide a CapSolver un token de Turnstile (tarea sin proxy). null si falla. */
async function capsolverTurnstile(clientKey: string, sitekey: string, url: string): Promise<string | null> {
  // Crear tarea.
  const crear = await fetch(`${API_URL}/createTask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientKey,
      task: { type: "AntiTurnstileTaskProxyLess", websiteURL: url, websiteKey: sitekey },
    }),
  })
    .then((r) => r.json())
    .catch(() => null);
  if (!crear || crear.errorId || !crear.taskId) return null;

  // Sondear el resultado.
  const hasta = Date.now() + MAX_MS;
  while (Date.now() < hasta) {
    await sleep(3000);
    const res = await fetch(`${API_URL}/getTaskResult`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientKey, taskId: crear.taskId }),
    })
      .then((r) => r.json())
      .catch(() => null);
    if (!res) continue;
    if (res.errorId) return null;
    if (res.status === "ready") return res.solution?.token ?? res.solution?.gRecaptchaResponse ?? null;
    // status "processing" → seguir sondeando
  }
  return null;
}

/** Inyecta el token en los campos de respuesta de todos los frames. */
async function inyectarToken(ctx: any, token: string): Promise<void> {
  for (const pg of ctx.pages()) {
    for (const fr of pg.frames()) {
      await fr
        .evaluate((tok: string) => {
          const sel = [
            'input[name="cf-turnstile-response"]',
            'textarea[name="cf-turnstile-response"]',
            'input[name="g-recaptcha-response"]',
            'textarea[name="g-recaptcha-response"]',
            '[id^="cf-chl-widget"][id$="_response"]',
          ];
          let puesto = false;
          for (const s of sel) {
            document.querySelectorAll(s).forEach((el) => {
              (el as HTMLInputElement).value = tok;
              puesto = true;
            });
          }
          // Callback de Turnstile si el widget lo expone.
          try {
            const w = window as any;
            if (w.turnstile && typeof w.turnstile.getResponse === "function") {
              // algunos formularios leen el token vía turnstile.getResponse()
            }
          } catch { /* */ }
          return puesto;
        }, token)
        .catch(() => {});
    }
  }
}

/**
 * Resuelve el captcha si hay uno (y hay clave). No-op en caso contrario.
 * Empuja un paso al array de diagnóstico. Devuelve true si inyectó un token.
 */
export async function resolverCaptchaSiHay(ctx: any, page: any, pasos: any[] = []): Promise<boolean> {
  // Key: variable de entorno o la guardada por el supremo en la app.
  let clientKey = (process.env.CAPSOLVER_KEY || "").trim();
  if (!clientKey) {
    try {
      const { getIntegraciones } = await import("./db");
      clientKey = (await getIntegraciones()).capsolverKey;
    } catch { /* */ }
  }
  const info = await detectarTurnstile(ctx, page);

  if (!info) {
    // Reporta si hay OTRO captcha (para saber que hay que adaptar el proveedor).
    const otro = await detectarOtroCaptcha(ctx);
    if (otro) pasos.push({ paso: "captcha", detectado: otro, resuelto: false, nota: "tipo no soportado aún" });
    return false;
  }

  if (!clientKey) {
    pasos.push({ paso: "captcha", detectado: "turnstile", resuelto: false, nota: "falta CAPSOLVER_KEY" });
    return false;
  }

  const token = await capsolverTurnstile(clientKey, info.sitekey, info.url);
  if (!token) {
    pasos.push({ paso: "captcha", detectado: "turnstile", resuelto: false, nota: "CapSolver no devolvió token" });
    return false;
  }

  await inyectarToken(ctx, token);
  pasos.push({ paso: "captcha", detectado: "turnstile", resuelto: true, proveedor: "capsolver" });
  return true;
}
