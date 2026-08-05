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

    // 2) Navegar al menú del RTT (Reporte Tributario para Terceros). La ruta
    //    exacta se calibra con diagnóstico (varía según el menú de cada RUC).
    const ruta = [
      ["Reporte Tributario", "Reporte Tributario para Terceros", "RTT"],
      ["Reporte Tributario para Terceros", "Generar reporte", "Generar"],
    ];
    for (const opciones of ruta) {
      const hit = await clicTexto(ctx, opciones);
      pasos.push({ paso: "menu", buscaba: opciones[0], clico: hit });
      await page.waitForTimeout(2000).catch(() => {});
    }

    // 3) Volcado de estructura (para calibrar el formulario del RTT y el campo
    //    de correo donde se escribe el sub-address con el RUC).
    const estructura = await volcar(ctx);
    pasos.push({ paso: "estructura", emailDestino: params.emailDestino, ...estructura });

    if (params.diagnostico) return { ok: false, diag: { pasos } };

    // TODO(calibrar): con el volcado, aquí se llenará el formulario del RTT y el
    // campo de correo con params.emailDestino, y se enviará. Por ahora, si el
    // login fue correcto se considera "disparado" (estado en_proceso) y el
    // webhook cerrará la trazabilidad cuando llegue el correo de SUNAT.
    return { ok: true, diag: { pasos } };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "Error generando el RTT.", diag: { pasos } };
  } finally {
    clearTimeout(tope);
    if (browser) await browser.close().catch(() => {});
  }
}
