// ============================================================
//  Descarga de XML de comprobantes RECIBIDOS (compras) desde SUNAT SOL
// ============================================================
// Módulo NUEVO e independiente. Hace login SOL (scraping, como el buzón/F36),
// va a "Consulta de comprobantes" (SEE-SOL), y descarga los XML de un periodo.
// Como la navegación exacta de esa pantalla se calibra con Modo diagnóstico,
// la extracción devuelve SIEMPRE un volcado (pasos) para afinar sin adivinar.
// Los XML descargados se leen con facturaXml.ts y se arman en un Excel.

import { lanzarNavegador, bloquearRecursos } from "./navegador";
import { parseFacturaXml, type FacturaXml } from "./facturaXml";

const LOGIN_URL =
  "https://e-menu.sunat.gob.pe/cl-ti-itmenu/MenuInternet.htm?exe=01.04.00.00.000000";

export interface ComprobantesParams {
  ruc: string;
  solUser: string;
  solPass: string;
  periodo: string; // "YYYYMM"
  diagnostico?: boolean;
}

export interface ComprobantesResultado {
  facturas?: FacturaXml[];
  descargados?: number;
  loginError?: boolean;
  error?: string;
  diag?: { pasos: any[] };
}

// --- helpers de scraping (autocontenidos) -----------------------------------
async function rellenar(page: any, sels: string[], val: string) {
  for (const s of sels) {
    const el = page.locator(s).first();
    if (await el.count().catch(() => 0)) {
      await el.fill(val).catch(() => {});
      return true;
    }
  }
  return false;
}
async function clickAny(scope: any, sels: string[]) {
  for (const s of sels) {
    const el = scope.locator(s).first();
    if (await el.count().catch(() => 0)) {
      await el.click({ timeout: 4000 }).catch(() => {});
      return true;
    }
  }
  return false;
}
/** Clic por texto visible dentro de cualquier frame. */
async function clicTexto(ctx: any, textos: string[]): Promise<boolean> {
  for (const pg of ctx.pages()) {
    for (const fr of pg.frames()) {
      for (const t of textos) {
        const loc = fr.getByText(t, { exact: false }).first();
        if (await loc.count().catch(() => 0)) {
          await loc.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => {});
          await loc.click({ timeout: 3000 }).catch(() => {});
          return true;
        }
      }
    }
  }
  return false;
}
function autoAceptarDialogos(ctx: any) {
  ctx.on("page", (pg: any) => pg.on("dialog", (d: any) => d.accept().catch(() => {})));
}

// --- login SOL (mismo flujo probado del F36/buzón) --------------------------
async function loginSol(params: ComprobantesParams, pasos: any[]) {
  const browser = await lanzarNavegador();
  const ctx = await browser.newContext({
    acceptDownloads: true,
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  });
  await bloquearRecursos(ctx);
  autoAceptarDialogos(ctx);
  const page = await ctx.newPage();
  let navOk = false;
  for (let i = 0; i < 3 && !navOk; i++) {
    try {
      await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
      navOk = true;
    } catch (e) {
      pasos.push({ paso: "nav-reintento", intento: i + 1, motivo: e instanceof Error ? e.message.slice(0, 80) : "" });
      await page.waitForTimeout(2000);
    }
  }
  if (!navOk) await page.goto(LOGIN_URL, { waitUntil: "commit", timeout: 45000 });
  await page.waitForTimeout(2500);
  await rellenar(page, ["#txtRuc", 'input[name="ruc"]', "#ruc"], params.ruc);
  await rellenar(page, ["#txtUsuario", 'input[name="usuario"]', "#usuario"], params.solUser);
  await rellenar(page, ["#txtContrasena", 'input[type="password"]', "#password"], params.solPass);
  await clickAny(page, ["#btnAceptar", 'button[type="submit"]', 'input[type="submit"]']);
  await page.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(3000);
  // Cerrar campaña "valida tus datos".
  for (let i = 0; i < 5; i++) {
    const camp = page.frames().find((f: any) => /itadminforuc-modifdatos|campanha/i.test(f.url()));
    if (!camp) break;
    await clicTexto(ctx, ["Finalizar"]);
    await page.waitForTimeout(1200);
    await clicTexto(ctx, ["Continuar sin confirmar", "Continuar"]);
    await page.waitForTimeout(1800);
  }
  const url = page.url();
  const texto = (await page.evaluate(() => (document.body?.innerText || "").slice(0, 300)).catch(() => "")) as string;
  const loginError = /oauth2\/error|autenticamenuinternet|problema en la aplicaci|no podemos atenderlo/i.test(url + " " + texto);
  pasos.push({ paso: "login", url, loginError });
  return { browser, ctx, page, loginError };
}

/** Vuelca la estructura visible (menú, frames, formularios, tablas, enlaces de
 *  descarga) para CALIBRAR la ruta a "Consulta de comprobantes recibidos". */
async function volcarEstructura(ctx: any): Promise<any> {
  const out: any = { frames: [] };
  for (const pg of ctx.pages()) {
    for (const fr of pg.frames()) {
      const info = await fr
        .evaluate(() => {
          const norm = (s: any) => String(s || "").replace(/\s+/g, " ").trim();
          const enlaces = (Array.from(document.querySelectorAll("a,[onclick],button,input[type=button],input[type=submit]")) as HTMLElement[])
            .map((e) => norm(e.textContent) || norm((e as HTMLInputElement).value))
            .filter((t) => t && t.length < 60)
            .slice(0, 80);
          const inputs = (Array.from(document.querySelectorAll("input,select")) as HTMLElement[])
            .map((e) => `${e.tagName.toLowerCase()}#${(e as any).id || ""}[name=${(e as any).name || ""}]`)
            .slice(0, 40);
          const conXml = (Array.from(document.querySelectorAll("a,[href],[onclick]")) as HTMLElement[])
            .map((e) => norm(e.getAttribute?.("href") || "") + " " + norm(e.getAttribute?.("onclick") || ""))
            .filter((s) => /xml|descarga|archivo|comprobante/i.test(s))
            .slice(0, 40);
          return { titulo: norm(document.title), enlaces, inputs, conXml };
        })
        .catch(() => null);
      if (info && (info.enlaces?.length || info.inputs?.length)) {
        out.frames.push({ url: fr.url().slice(0, 120), ...info });
      }
    }
  }
  return out;
}

/**
 * Descarga los XML de comprobantes RECIBIDOS del periodo. Primera versión:
 * hace login, intenta llegar a "Consulta de comprobantes" (SEE-SOL) y SIEMPRE
 * devuelve el volcado de estructura para calibrar la navegación exacta.
 */
export async function extraerComprobantesXml(params: ComprobantesParams): Promise<ComprobantesResultado> {
  const pasos: any[] = [];
  let browser: any = null;
  let cerradoPorTiempo = false;
  const tope = setTimeout(() => { cerradoPorTiempo = true; if (browser) browser.close().catch(() => {}); }, 220000);
  try {
    const s = await loginSol(params, pasos);
    browser = s.browser;
    if (s.loginError) {
      return {
        loginError: true,
        error: "SUNAT rechazó el inicio de sesión (Usuario/Clave SOL incorrectos o bloqueo temporal). Espera ~10 min y reintenta.",
        diag: { pasos },
      };
    }

    // Intenta abrir "Consulta de comprobantes" (SEE-SOL) por texto del menú.
    const rutas = [
      "Consulta de Comprobantes",
      "Comprobantes de pago",
      "Consulta Comprobantes",
      "SEE - SOL",
      "Consulta de comprobantes recibidos",
    ];
    for (const t of rutas) {
      const ok = await clicTexto(s.ctx, [t]);
      pasos.push({ paso: "menu", intento: t, clic: ok });
      if (ok) { await s.page.waitForTimeout(2500); break; }
    }

    // Volcado de estructura (SIEMPRE): con esto calibramos la descarga real.
    const estructura = await volcarEstructura(s.ctx);
    pasos.push({ paso: "estructura", ...estructura });

    // TODO (siguiente iteración, tras calibrar): filtrar por periodo, listar
    // los comprobantes recibidos y descargar cada XML → parseFacturaXml.
    const facturas: FacturaXml[] = [];

    return {
      facturas,
      descargados: facturas.length,
      error: facturas.length ? undefined : "Aún no se descargan XML: falta calibrar la navegación de esta pantalla. Revisa el diagnóstico (estructura del menú) y pásamelo.",
      diag: { pasos },
    };
  } catch (err: any) {
    if (cerradoPorTiempo) return { error: "La consulta tardó demasiado y se canceló. Reintenta.", diag: { pasos } };
    return { error: err?.message ?? "Error extrayendo los comprobantes.", diag: { pasos } };
  } finally {
    clearTimeout(tope);
    if (browser) await browser.close().catch(() => {});
  }
}
