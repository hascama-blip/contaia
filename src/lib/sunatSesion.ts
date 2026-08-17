// ============================================================
//  Sesión SUNAT compartida + caché de cookies (menos logins = menos captcha/bloqueo)
// ============================================================
// SUNAT vigila el LOGIN (captcha/seguridad). Cada módulo abría su propia sesión
// → varios logins seguidos → bloqueo. Aquí:
//   - `abrirSesionSunat` hace UN login y guarda las cookies (storageState) en
//     MEMORIA con TTL corto (no en disco: son tokens de sesión sensibles).
//   - Si otro módulo pide sesión para el MISMO RUC+usuario dentro de la ventana,
//     restaura las cookies y entra SIN volver a loguearse (verifica que siga viva).
// La Clave SOL NUNCA se guarda; solo cookies de sesión efímeras en RAM.

import { lanzarNavegador, bloquearRecursos } from "./navegador";
import { resolverCaptchaSiHay } from "./captcha";

const LOGIN_URL =
  process.env.BUZON_LOGIN_URL ??
  "https://e-menu.sunat.gob.pe/cl-ti-itmenu/MenuInternet.htm?exe=01.04.00.00.000000";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export const MSG_LOGIN_ERROR = "SUNAT rechazó el inicio de sesión (Usuario/Clave SOL, o bloqueo temporal).";

export interface CredsSol { ruc: string; solUser: string; solPass: string }
export interface SesionSunat {
  browser: any;
  ctx: any;
  page: any;
  loginError: boolean;
  reutilizada: boolean;
}

// ---- Caché de cookies en memoria (por RUC+usuario), TTL corto -----------------
const SESION_TTL_MS = Number(process.env.SUNAT_SESION_TTL_MS || 8 * 60 * 1000);
const cache = new Map<string, { state: any; at: number }>();
const claveCache = (c: CredsSol) => `${c.ruc}|${(c.solUser || "").toLowerCase()}`;

function leerCache(c: CredsSol): any | null {
  const e = cache.get(claveCache(c));
  if (!e) return null;
  if (Date.now() - e.at > SESION_TTL_MS) { cache.delete(claveCache(c)); return null; }
  return e.state;
}
function guardarCache(c: CredsSol, state: any) {
  cache.set(claveCache(c), { state, at: Date.now() });
}
/** Invalida la sesión guardada (p. ej. si SUNAT la venció a mitad de camino). */
export function olvidarSesion(c: CredsSol) { cache.delete(claveCache(c)); }

// ---- Helpers (idénticos a los de los bots) -----------------------------------
async function rellenar(page: any, sels: string[], val: string) {
  for (const s of sels) { try { const el = await page.$(s); if (el) { await el.fill(val); return true; } } catch { /* */ } }
  return false;
}
async function clickAny(page: any, sels: string[]) {
  for (const s of sels) { try { const el = await page.$(s); if (el) { await el.click(); return true; } } catch { /* */ } }
  return false;
}
function autoAceptarDialogos(ctx: any) {
  const enganchar = (pg: any) => pg.on("dialog", (d: any) => d.accept().catch(() => {}));
  ctx.pages().forEach(enganchar);
  ctx.on("page", enganchar);
}
async function clickEnFrame(frame: any, textos: string[]): Promise<string | null> {
  return frame.evaluate((textos: string[]) => {
    const norm = (s: any) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
    const els = Array.from(document.querySelectorAll('a, button, input[type="button"], input[type="submit"], [role="button"]')) as HTMLElement[];
    for (const t of textos) {
      const el = els.find((e) => norm((e.textContent || "") + " " + ((e as HTMLInputElement).value || "")).includes(norm(t)));
      if (el) { el.click(); return t; }
    }
    return null;
  }, textos).catch(() => null);
}
async function cerrarPantallas(ctx: any, page: any) {
  for (let i = 0; i < 6; i++) {
    const camp = ctx.pages().flatMap((p: any) => p.frames()).find((f: any) => /itadminforuc-modifdatos|campanha/i.test(f.url()));
    if (!camp) break;
    await clickEnFrame(camp, ["Continuar sin confirmar"]); await page.waitForTimeout(1000);
    await clickEnFrame(camp, ["Finalizar"]); await page.waitForTimeout(1200);
  }
}

async function nuevaContexto(browser: any, state?: any) {
  const ctx = await browser.newContext(state
    ? { acceptDownloads: true, userAgent: UA, storageState: state }
    : { acceptDownloads: true, userAgent: UA });
  await bloquearRecursos(ctx);
  autoAceptarDialogos(ctx);
  return ctx;
}

/** ¿La página actual es el formulario de login SOL (sesión NO iniciada)? */
async function enPaginaLogin(page: any): Promise<boolean> {
  const tiene = await page.locator("#txtRuc").count().catch(() => 0);
  return tiene > 0;
}

/** Login SOL completo (con reintento). Empuja pasos al array de diagnóstico. */
async function loginCompleto(ctx: any, page: any, c: CredsSol, pasos: any[]): Promise<boolean> {
  let loginError = true;
  for (let intento = 0; intento < 2 && loginError; intento++) {
    let navOk = false;
    for (let i = 0; i < 3 && !navOk; i++) {
      try { await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 45000 }); navOk = true; } catch { await page.waitForTimeout(2000).catch(() => {}); }
    }
    if (!navOk) await page.goto(LOGIN_URL, { waitUntil: "commit", timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(2500).catch(() => {});
    await rellenar(page, ["#txtRuc", 'input[name="ruc"]', "#ruc"], c.ruc);
    await rellenar(page, ["#txtUsuario", 'input[name="usuario"]', "#usuario"], c.solUser);
    await rellenar(page, ["#txtContrasena", 'input[type="password"]', "#password"], c.solPass);
    // Si SUNAT muestra un captcha (Cloudflare Turnstile), resolverlo ANTES de enviar.
    // No-op si no hay widget o no hay CAPSOLVER_KEY (no rompe el login normal).
    await resolverCaptchaSiHay(ctx, page, pasos).catch(() => false);
    await clickAny(page, ["#btnAceptar", 'button[type="submit"]', 'input[type="submit"]']);
    await page.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(3000).catch(() => {});
    await cerrarPantallas(ctx, page);
    // Si tras enviar apareció un desafío Cloudflare (interstitial), resolverlo y esperar.
    if (await resolverCaptchaSiHay(ctx, page, pasos).catch(() => false)) {
      await page.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => {});
      await page.waitForTimeout(2500).catch(() => {});
      await cerrarPantallas(ctx, page);
    }
    const url = page.url();
    const texto = (await page.evaluate(() => (document.body?.innerText || "").slice(0, 300)).catch(() => "")) as string;
    loginError = /oauth2\/error|autenticamenuinternet|problema en la aplicaci|no podemos atenderlo/i.test(url + " " + texto);
    pasos.push({ paso: "login", url, loginError, intento: intento + 1, reutilizada: false });
    if (loginError) await page.waitForTimeout(2500).catch(() => {});
  }
  return loginError;
}

/**
 * Abre una sesión SUNAT lista para navegar (page en el menú, autenticada).
 * Reutiliza cookies en caché si siguen vivas (sin volver a loguearse).
 * El llamador DEBE cerrar `browser` al terminar (libera el cupo de la cola).
 */
export async function abrirSesionSunat(c: CredsSol, pasos: any[] = []): Promise<SesionSunat> {
  const browser = await lanzarNavegador();

  // 1) Intento de REUTILIZAR cookies en caché.
  const cacheState = leerCache(c);
  if (cacheState) {
    try {
      const ctx = await nuevaContexto(browser, cacheState);
      const page = await ctx.newPage();
      await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
      await page.waitForTimeout(2000).catch(() => {});
      await cerrarPantallas(ctx, page);
      if (!(await enPaginaLogin(page))) {
        pasos.push({ paso: "login", reutilizada: true, loginError: false });
        return { browser, ctx, page, loginError: false, reutilizada: true };
      }
      // Sesión vencida: descartar y loguear de cero.
      olvidarSesion(c);
      await ctx.close().catch(() => {});
    } catch { olvidarSesion(c); }
  }

  // 2) Login completo.
  const ctx = await nuevaContexto(browser);
  const page = await ctx.newPage();
  const loginError = await loginCompleto(ctx, page, c, pasos);
  if (!loginError) {
    try { guardarCache(c, await ctx.storageState()); } catch { /* */ }
  }
  return { browser, ctx, page, loginError, reutilizada: false };
}
