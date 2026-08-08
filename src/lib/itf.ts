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
    if (/itconitf|itf|transacc|financ|0695/i.test(fr.url())) return fr;
    const txt = (await fr.evaluate(() => (document.body?.innerText || "").slice(0, 500)).catch(() => "")) as string;
    if (/Impuesto a las Transacciones Financieras|Consulta ITF|Formulario 0695|\bITF\b/i.test(txt)) return fr;
  }
  return null;
}

/** Lee todas las tablas de un frame como filas de texto (para ver el reporte). */
async function leerTablas(frame: any): Promise<string[][][]> {
  return frame.evaluate(() => {
    const norm = (s: any) => String(s || "").replace(/\s+/g, " ").trim();
    return (Array.from(document.querySelectorAll("table")) as HTMLTableElement[])
      .map((tb) => (Array.from(tb.querySelectorAll("tr")) as HTMLTableRowElement[])
        .map((tr) => (Array.from(tr.querySelectorAll("th,td")) as HTMLElement[]).map((td) => norm(td.textContent)))
        .filter((r) => r.some((c) => c)))
      .filter((rows) => rows.length).slice(0, 12);
  }).catch(() => []);
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

    // 2) Ir DIRECTO a "Consulta de ITF" por la URL de ejecución del menú
    //    (code descubierto por DevTools: 13.6.1.1.1 → app cl-at-itconitf).
    //    Respaldo: clic en la opción del menú.
    const CODE = process.env.ITF_CODE || "13.6.1.1.1";
    await page.goto(`https://e-menu.sunat.gob.pe/cl-ti-itmenu/MenuInternet.htm?action=execute&code=${CODE}&s=ww1`, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(2500).catch(() => {});
    await cerrarPantallas(ctx, page);
    let fr: any = await frameItf(ctx);
    let opcion: string | null = null;
    if (!fr) {
      opcion = await clicMenu(ctx, [
        "Consulta de ITF",
        "Consulta ITF",
        "ITF",
        "Impuesto a las Transacciones Financieras",
        "Transacciones Financieras",
      ]);
    }
    for (let i = 0; i < 12 && !fr; i++) {
      await page.waitForTimeout(1000).catch(() => {});
      await cerrarPantallas(ctx, page);
      fr = await frameItf(ctx);
    }
    const menu = await opcionesDeMenu(ctx);
    pasos.push({ paso: "menu", encontrado: !!fr, onclick: opcion, opcionesMenu: menu });

    // 3) Formulario 0695: Periodo Inicial (aaaamm) y Periodo Final (aaaamm).
    //    año → {año}01 a {año}12. Son los dos primeros campos de texto.
    const ej = (params.ejercicio || "2025").replace(/\D/g, "").slice(0, 4);
    const perIni = `${ej}01`, perFin = `${ej}12`;
    let periodosOk = false;
    if (fr) {
      const inputs = fr.locator('input[type="text"], input:not([type])');
      const n = await inputs.count().catch(() => 0);
      if (n >= 2) {
        await inputs.nth(0).fill(perIni).catch(() => {});
        await inputs.nth(1).fill(perFin).catch(() => {});
        const v0 = await inputs.nth(0).inputValue().catch(() => "");
        const v1 = await inputs.nth(1).inputValue().catch(() => "");
        periodosOk = /\d{6}/.test(v0) && /\d{6}/.test(v1);
      }
    }
    const estructuraForm = await volcar(ctx);
    pasos.push({ paso: "form", periodosOk, perIni, perFin, ...estructuraForm });

    // 4) Siguiente → el reporte se muestra en pantalla.
    let siguiente = false;
    if (fr) {
      siguiente = await clickAny(fr, ['input[value="Siguiente" i]', '#btnSiguiente', 'button:has-text("Siguiente")']);
      if (!siguiente) siguiente = !!(await clickEnFrame(fr, ["Siguiente", "Continuar"]));
    }
    await page.waitForTimeout(3500).catch(() => {});
    const frRep = (await frameItf(ctx)) || fr;
    const tablas = frRep ? await leerTablas(frRep) : [];
    pasos.push({ paso: "reporte", siguiente, tablas });

    // 5) Parse best-effort: filas con periodo (aaaamm) y un monto.
    const filas: ItfFila[] = [];
    for (const rows of tablas) for (const celdas of rows) {
      const per = celdas.find((c) => /^\d{6}$/.test(c));
      const montoTxt = [...celdas].reverse().find((c) => /\d[\d.,]*\d|\d/.test(c) && !/^\d{6}$/.test(c) && /[.,]\d|^\d+$/.test(c));
      if (per && montoTxt) {
        const monto = Number(montoTxt.replace(/[^\d.-]/g, "")) || 0;
        const concepto = celdas.filter((c) => c !== per && c !== montoTxt).join(" ").slice(0, 60);
        filas.push({ periodo: `${per.slice(0, 4)}/${per.slice(4)}`, concepto, monto });
      }
    }
    const total = filas.reduce((a, x) => a + x.monto, 0);

    if (params.diagnostico) return { ok: false, diag: { pasos } };
    if (!fr) return { ok: false, error: "No se encontró el módulo de ITF en el menú. Usa Modo diagnóstico y pásame la traza.", diag: { pasos } };
    if (!filas.length) return { ok: false, error: "Se llegó al formulario pero no se pudo leer el reporte. Usa Modo diagnóstico y pásame la traza.", diag: { pasos } };

    return { ok: true, itf: { ejercicio: ej, filas, total }, diag: { pasos } };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "Error consultando el ITF.", diag: { pasos } };
  } finally {
    clearTimeout(tope);
    if (browser) await browser.close().catch(() => {});
  }
}
