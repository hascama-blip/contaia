// ============================================================
//  RTT — bot que dispara la generación del Reporte Tributario para Terceros
// ============================================================
// Paso 3 de la trazabilidad: inicia sesión en SOL con Clave SOL y genera el RTT,
// escribiendo como correo de destino el sub-address con el RUC embebido
// (reportes+RUC{ruc}@dominio). SUNAT envía el PDF/XML por correo (asíncrono);
// el webhook lo captura después. La navegación EXACTA del menú RTT se calibra
// con Modo diagnóstico (devuelve el volcado de estructura), igual que el resto.

import { lanzarNavegador, bloquearRecursos } from "./navegador";

const LOGIN_URL =
  "https://e-menu.sunat.gob.pe/cl-ti-itmenu/MenuInternet.htm?exe=01.04.00.00.000000";
// URL directa del formulario del RTT (descubierta por inspección): pide el
// correo de destino y con "Enviar" genera y manda el reporte.
const RTT_URL =
  "https://ww1.sunat.gob.pe/ol-ti-itreportetri/reportetri.htm?action=cargarFormulario";

export interface RttParams {
  ruc: string;
  solUser: string;
  solPass: string;
  /** Correo de destino con el RUC embebido: reportes+RUC{ruc}@dominio */
  emailDestino: string;
  diagnostico?: boolean;
}

export interface RttResultado {
  ok: boolean;
  loginError?: boolean;
  error?: string;
  diag?: { pasos: any[] };
}

async function rellenar(page: any, sels: string[], val: string) {
  for (const s of sels) {
    const el = page.locator(s).first();
    if (await el.count().catch(() => 0)) { await el.fill(val).catch(() => {}); return true; }
  }
  return false;
}
async function clickAny(scope: any, sels: string[]) {
  for (const s of sels) {
    const el = scope.locator(s).first();
    if (await el.count().catch(() => 0)) { await el.click({ timeout: 4000 }).catch(() => {}); return true; }
  }
  return false;
}
async function clicTexto(ctx: any, textos: string[]): Promise<boolean> {
  for (const pg of ctx.pages()) {
    for (const fr of pg.frames()) {
      for (const t of textos) {
        const link = fr.locator(`a:has-text("${t}")`).first();
        if (await link.count().catch(() => 0)) { await link.click({ timeout: 3000 }).catch(() => {}); return true; }
        const loc = fr.getByText(t, { exact: false }).first();
        if (await loc.count().catch(() => 0)) { await loc.click({ timeout: 3000 }).catch(() => {}); return true; }
      }
    }
  }
  return false;
}

/** Todos los frames de todas las páginas del contexto. */
function todosLosFrames(ctx: any): any[] {
  const out: any[] = [];
  for (const pg of ctx.pages()) for (const fr of pg.frames()) out.push(fr);
  return out;
}
/** Rellena el primer input que exista (buscando en TODOS los frames). */
async function fillEnFrames(ctx: any, selectores: string[], valor: string): Promise<{ ok: boolean; sel?: string; frameUrl?: string }> {
  for (const fr of todosLosFrames(ctx)) {
    for (const sel of selectores) {
      const el = fr.locator(sel).first();
      if (await el.count().catch(() => 0)) {
        await el.fill(valor).catch(() => {});
        const v = await el.inputValue().catch(() => "");
        if (v) return { ok: true, sel, frameUrl: fr.url().slice(0, 100) };
      }
    }
  }
  return { ok: false };
}
/** Clic en el primer elemento que exista (buscando en TODOS los frames). */
async function clickEnFrames(ctx: any, selectores: string[]): Promise<boolean> {
  for (const fr of todosLosFrames(ctx)) {
    for (const sel of selectores) {
      const el = fr.locator(sel).first();
      if (await el.count().catch(() => 0)) { await el.click({ timeout: 4000 }).catch(() => {}); return true; }
    }
  }
  return false;
}

/** Vuelca la estructura visible (para calibrar la navegación del RTT). */
async function volcar(ctx: any): Promise<any> {
  const frames: any[] = [];
  for (const pg of ctx.pages()) {
    for (const fr of pg.frames()) {
      const info = await fr.evaluate(() => {
        const norm = (s: any) => String(s || "").replace(/\s+/g, " ").trim();
        const inputs = (Array.from(document.querySelectorAll("input,select,textarea")) as HTMLElement[])
          .map((e) => ({ t: e.tagName.toLowerCase(), tipo: (e as HTMLInputElement).type || "", id: (e as any).id || "", name: (e as any).name || "", ph: e.getAttribute("placeholder") || "" }))
          .slice(0, 40);
        const links = (Array.from(document.querySelectorAll("a,button")) as HTMLElement[])
          .map((e) => norm(e.textContent)).filter((t) => t && t.length < 60).slice(0, 60);
        return { titulo: norm(document.title), textoTop: norm((document.body?.innerText || "").slice(0, 250)), inputs, links };
      }).catch(() => null);
      if (info && (info.inputs?.length || info.links?.length)) frames.push({ url: fr.url().slice(0, 120), ...info });
    }
  }
  return { frames };
}

/**
 * Dispara la generación del RTT en SOL. Devuelve ok=true si el login fue
 * correcto y se llegó al formulario (la calibración fina se hace con
 * diagnóstico). El correo de destino lleva el RUC embebido.
 */
export async function generarRTT(params: RttParams): Promise<RttResultado> {
  const pasos: any[] = [];
  let browser: any = null;
  const tope = setTimeout(() => { if (browser) browser.close().catch(() => {}); }, 180000);
  try {
    browser = await lanzarNavegador();
    const ctx = await browser.newContext({
      acceptDownloads: true,
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    });
    await bloquearRecursos(ctx);
    const page = await ctx.newPage();

    // 1) Login SOL (mismo flujo probado del buzón/F36).
    await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(2500).catch(() => {});
    await rellenar(page, ["#txtRuc", 'input[name="ruc"]'], params.ruc);
    await rellenar(page, ["#txtUsuario", 'input[name="usuario"]'], params.solUser);
    await rellenar(page, ["#txtContrasena", 'input[type="password"]'], params.solPass);
    await clickAny(page, ["#btnAceptar", 'button[type="submit"]']);
    await page.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(2500).catch(() => {});
    // Cerrar campaña "valida tus datos".
    for (let i = 0; i < 4; i++) {
      const camp = page.frames().find((f: any) => /itadminforuc-modifdatos|campanha/i.test(f.url()));
      if (!camp) break;
      await clicTexto(ctx, ["Finalizar"]); await page.waitForTimeout(1000).catch(() => {});
      await clicTexto(ctx, ["Continuar sin confirmar", "Continuar"]); await page.waitForTimeout(1500).catch(() => {});
    }
    const url = page.url();
    const texto = (await page.evaluate(() => (document.body?.innerText || "").slice(0, 300)).catch(() => "")) as string;
    const loginError = /oauth2\/error|autenticamenuinternet|problema en la aplicaci|no podemos atenderlo/i.test(url + " " + texto);
    pasos.push({ paso: "login", url, loginError });
    if (loginError) {
      return { ok: false, loginError: true, error: "SUNAT rechazó el inicio de sesión (Usuario/Clave SOL).", diag: { pasos } };
    }

    // 2) Ir DIRECTO al formulario del RTT (URL descubierta por inspección).
    await page.goto(RTT_URL, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(3000).catch(() => {});
    const urlActual = page.url();
    const formTexto = (await page.evaluate(() => (document.body?.innerText || "").slice(0, 250)).catch(() => "")) as string;
    // ¿Nos redirigió al login? (la sesión no se compartió con ww1).
    const enLogin = /txtRuc|iniciar sesi|clave sol/i.test(formTexto) || /login|autentica/i.test(urlActual);
    pasos.push({ paso: "form-rtt", url: urlActual, enLogin, tieneCorreo: /reporte tributario|correo/i.test(formTexto) });

    // Volcado de estructura (para calibrar si el formulario no aparece).
    const estructura = await volcar(ctx);
    pasos.push({ paso: "estructura", emailDestino: params.emailDestino, ...estructura });

    if (params.diagnostico) return { ok: false, diag: { pasos } };

    if (enLogin) {
      return { ok: false, error: "SUNAT no mantuvo la sesión al abrir el RTT directo (redirigió a login). Hay que llegar por el menú.", diag: { pasos } };
    }

    // 3) Escribir el correo de destino (en cualquier frame) y Enviar.
    const emailSels = ["#txtCorreo", 'input[name="txtCorreo"]', 'input[type="email"]', 'input[placeholder*="Correo" i]', 'input[type="text"]'];
    const fill = await fillEnFrames(ctx, emailSels, params.emailDestino);
    pasos.push({ paso: "correo", escrito: fill.ok, frame: fill.frameUrl, sel: fill.sel, emailDestino: params.emailDestino });
    if (!fill.ok) {
      return { ok: false, error: "No se encontró el campo de correo en el formulario del RTT.", diag: { pasos } };
    }

    // Clic "Enviar" (#btnCorreo), en cualquier frame.
    const enviado =
      (await clickEnFrames(ctx, ["#btnCorreo", 'button[name="btnCorreo"]', 'button:has-text("Enviar")', 'input[value*="Enviar" i]'])) ||
      (await clicTexto(ctx, ["Enviar"]));
    await page.waitForTimeout(1500).catch(() => {});
    // Confirmación (SUNAT suele mostrar un aviso "Aceptar"/"Sí").
    await clicTexto(ctx, ["Aceptar", "Sí", "Confirmar", "OK"]);
    await page.waitForTimeout(2000).catch(() => {});
    const trasEnviar = (await page.evaluate(() => (document.body?.innerText || "").slice(0, 300)).catch(() => "")) as string;
    pasos.push({ paso: "enviar", clico: enviado, respuesta: trasEnviar.slice(0, 200) });

    return { ok: enviado, error: enviado ? undefined : "No se pudo pulsar Enviar en el formulario del RTT.", diag: { pasos } };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "Error generando el RTT.", diag: { pasos } };
  } finally {
    clearTimeout(tope);
    if (browser) await browser.close().catch(() => {});
  }
}
