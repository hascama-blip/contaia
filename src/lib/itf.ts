// ============================================================
//  ITF — Impuesto a las Transacciones Financieras (persona natural)
// ============================================================
// A diferencia del RTT/rentas, SUNAT muestra el ITF EN PANTALLA (no lo envía por
// correo). Este bot: login SOL → entra al módulo de ITF → lee el reporte de la
// pantalla. Mientras calibramos el menú exacto, el Modo diagnóstico vuelca las
// opciones del menú y la estructura del formulario (como se hizo con rentas).

import { lanzarNavegador, bloquearRecursos } from "./navegador";

const LOGIN_URL =
  process.env.BUZON_LOGIN_URL ??
  "https://e-menu.sunat.gob.pe/cl-ti-itmenu/MenuInternet.htm?exe=01.04.00.00.000000";

export interface ItfParams {
  ruc: string;
  solUser: string;
  solPass: string;
  ejercicio?: string;   // año a consultar
  diagnostico?: boolean;
}
export interface ItfFila { periodo: string; concepto: string; monto: number; }
export interface ItfResultado {
  ok: boolean;
  loginError?: boolean;
  error?: string;
  itf?: { ejercicio: string; filas: ItfFila[]; total: number };
  diag?: { pasos: any[] };
}

// --- helpers (mismos del RTT / rentas, probados) -----------------------------
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
function todosLosFrames(ctx: any): any[] {
  const out: any[] = [];
  for (const pg of ctx.pages()) for (const fr of pg.frames()) out.push(fr);
  return out;
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
async function clicMenu(ctx: any, textos: string[]): Promise<string | null> {
  for (const pg of ctx.pages()) for (const fr of pg.frames()) {
    const hit = await fr.evaluate((textos: string[]) => {
      const norm = (s: any) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
      const els = Array.from(document.querySelectorAll("a,[onclick]")) as HTMLElement[];
      for (const t of textos) {
        const el = els.find((e) => /ejecuta\(|iconexecute/i.test(e.getAttribute("onclick") || "") && norm(e.textContent).includes(norm(t)));
        if (el) { el.click(); return (el.getAttribute("onclick") || "").slice(0, 160); }
      }
      return null;
    }, textos).catch(() => null);
    if (hit) return hit;
  }
  return null;
}
/** Vuelca TODAS las opciones del menú (para identificar la de ITF si el nombre no calza). */
async function opcionesDeMenu(ctx: any): Promise<string[]> {
  const set = new Set<string>();
  for (const fr of todosLosFrames(ctx)) {
    const arr = await fr.evaluate(() => {
      const norm = (s: any) => String(s || "").replace(/\s+/g, " ").trim();
      return (Array.from(document.querySelectorAll("a,[onclick]")) as HTMLElement[])
        .filter((e) => /ejecuta\(|iconexecute/i.test(e.getAttribute("onclick") || "") || /itmenu/i.test((e as HTMLAnchorElement).href || ""))
        .map((e) => norm(e.textContent)).filter((t) => t && t.length < 80);
    }).catch(() => [] as string[]);
    for (const t of arr) set.add(t);
  }
  return [...set].filter((t) => /itf|transacc|financ|impuesto/i.test(t)).concat([...set]).slice(0, 40);
}
async function volcar(ctx: any): Promise<any> {
  const frames: any[] = [];
  for (const pg of ctx.pages()) for (const fr of pg.frames()) {
    const info = await fr.evaluate(() => {
      const norm = (s: any) => String(s || "").replace(/\s+/g, " ").trim();
      const inputs = (Array.from(document.querySelectorAll("input,select,textarea")) as HTMLElement[])
        .map((e) => ({ t: e.tagName.toLowerCase(), tipo: (e as HTMLInputElement).type || "", id: (e as any).id || "", name: (e as any).name || "", ph: e.getAttribute("placeholder") || "" })).slice(0, 40);
      const links = (Array.from(document.querySelectorAll("a,button")) as HTMLElement[]).map((e) => norm(e.textContent)).filter((t) => t && t.length < 60).slice(0, 60);
      return { titulo: norm(document.title), textoTop: norm((document.body?.innerText || "").slice(0, 300)), inputs, links };
    }).catch(() => null);
    if (info && (info.inputs?.length || info.links?.length)) frames.push({ url: fr.url().slice(0, 120), ...info });
  }
  return { frames };
}

/** ¿Este frame es el del ITF? (por URL de la app o texto propio). */
async function frameItf(ctx: any): Promise<any> {
  for (const fr of todosLosFrames(ctx)) {
    if (/itf|transacc|financ/i.test(fr.url())) return fr;
    const txt = (await fr.evaluate(() => (document.body?.innerText || "").slice(0, 500)).catch(() => "")) as string;
    if (/Impuesto a las Transacciones Financieras|\bITF\b/i.test(txt)) return fr;
  }
  return null;
}

export async function consultarItf(params: ItfParams): Promise<ItfResultado> {
  const pasos: any[] = [];
  let browser: any = null;
  const tope = setTimeout(() => { if (browser) browser.close().catch(() => {}); }, 180000);
  try {
    browser = await lanzarNavegador();
    const ctx = await browser.newContext({ acceptDownloads: true, userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36" });
    await bloquearRecursos(ctx);
    autoAceptarDialogos(ctx);
    const page = await ctx.newPage();

    // 1) Login (con reintento).
    let loginError = true, url = "";
    for (let intento = 0; intento < 2 && loginError; intento++) {
      let navOk = false;
      for (let i = 0; i < 3 && !navOk; i++) {
        try { await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 45000 }); navOk = true; } catch { await page.waitForTimeout(2000).catch(() => {}); }
      }
      if (!navOk) await page.goto(LOGIN_URL, { waitUntil: "commit", timeout: 45000 }).catch(() => {});
      await page.waitForTimeout(2500).catch(() => {});
      await rellenar(page, ["#txtRuc", 'input[name="ruc"]', "#ruc"], params.ruc);
      await rellenar(page, ["#txtUsuario", 'input[name="usuario"]', "#usuario"], params.solUser);
      await rellenar(page, ["#txtContrasena", 'input[type="password"]', "#password"], params.solPass);
      await clickAny(page, ["#btnAceptar", 'button[type="submit"]', 'input[type="submit"]']);
      await page.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => {});
      await page.waitForTimeout(3000).catch(() => {});
      await cerrarPantallas(ctx, page);
      url = page.url();
      const texto = (await page.evaluate(() => (document.body?.innerText || "").slice(0, 300)).catch(() => "")) as string;
      loginError = /oauth2\/error|autenticamenuinternet|problema en la aplicaci|no podemos atenderlo/i.test(url + " " + texto);
      pasos.push({ paso: "login", url, loginError, intento: intento + 1 });
      if (loginError) await page.waitForTimeout(2500).catch(() => {});
    }
    if (loginError) return { ok: false, loginError: true, error: "SUNAT rechazó el inicio de sesión (Usuario/Clave SOL, o bloqueo temporal).", diag: { pasos } };

    // 2) Buscar el módulo de ITF por el menú (candidatos por nombre).
    let fr: any = await frameItf(ctx);
    let opcion: string | null = null;
    if (!fr) {
      opcion = await clicMenu(ctx, [
        "ITF",
        "Impuesto a las Transacciones Financieras",
        "Transacciones Financieras",
        "Consulta de ITF",
        "Reporte de ITF",
      ]);
    }
    for (let i = 0; i < 12 && !fr; i++) {
      await page.waitForTimeout(1000).catch(() => {});
      await cerrarPantallas(ctx, page);
      fr = await frameItf(ctx);
    }
    const menu = await opcionesDeMenu(ctx);
    pasos.push({ paso: "menu", encontrado: !!fr, onclick: opcion, opcionesMenu: menu });

    // 3) (Cuando sepamos el formulario) seleccionar ejercicio y consultar.
    //    Por ahora volcamos la estructura para calibrar.
    const estructura = await volcar(ctx);
    pasos.push({ paso: "estructura", ...estructura });

    if (params.diagnostico) return { ok: false, diag: { pasos } };
    if (!fr) return { ok: false, error: "No se encontró el módulo de ITF en el menú. Usa Modo diagnóstico y pásame la traza.", diag: { pasos } };

    // Placeholder: hasta calibrar el formulario, devolvemos la estructura.
    return { ok: false, error: "Módulo de ITF localizado; falta calibrar la lectura del reporte. Usa Modo diagnóstico.", diag: { pasos } };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "Error consultando el ITF.", diag: { pasos } };
  } finally {
    clearTimeout(tope);
    if (browser) await browser.close().catch(() => {});
  }
}
