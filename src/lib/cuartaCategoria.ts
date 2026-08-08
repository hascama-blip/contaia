// ============================================================
//  Reporte de Ingresos de Cuarta Categoría — consulta MENSUAL (en pantalla)
// ============================================================
// Persona natural (RUC 10/15). SUNAT lo muestra en pantalla (no por correo):
// login SOL → acceso directo (code=11.5.1.1.12, app cpelec001Alias) → elegir
// Mes + Año → "Buscar" → leer el reporte. Modo diagnóstico vuelca la estructura.

import { lanzarNavegador, bloquearRecursos } from "./navegador";

const LOGIN_URL =
  process.env.BUZON_LOGIN_URL ??
  "https://e-menu.sunat.gob.pe/cl-ti-itmenu/MenuInternet.htm?exe=01.04.00.00.000000";

export interface CuartaParams {
  ruc: string;
  solUser: string;
  solPass: string;
  mes: string;   // "01".."12"
  anio: string;  // "2025"
  diagnostico?: boolean;
}
export interface CuartaResultado {
  ok: boolean;
  loginError?: boolean;
  error?: string;
  cuarta?: { mes: string; anio: string; html: string };
  diag?: { pasos: any[] };
}

// --- helpers (mismos del RTT / rentas / ITF, probados) -----------------------
async function rellenar(page: any, sels: string[], val: string) {
  for (const s of sels) { try { const el = await page.$(s); if (el) { await el.fill(val); return true; } } catch { /* */ } }
  return false;
}
async function clickAny(frame: any, sels: string[]) {
  for (const s of sels) { try { const el = await frame.$(s); if (el) { await el.click(); return true; } } catch { /* */ } }
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
/** Extrae SOLO la tabla de datos del reporte (la de honorarios/renta), como
 *  HTML limpio (sin scripts/links) para renderizarla tal cual la muestra SUNAT. */
async function leerTablaCuartaHTML(frame: any): Promise<string> {
  return frame.evaluate(() => {
    const norm = (s: any) => String(s || "").replace(/\s+/g, " ").trim();
    const tablas = Array.from(document.querySelectorAll("table")) as HTMLTableElement[];
    let best: HTMLTableElement | null = null;
    let bestScore = -1;
    for (const tb of tablas) {
      const txt = norm(tb.innerText);
      if (!txt) continue;
      const filas = Array.from(tb.querySelectorAll("tr"));
      const cols = Math.max(0, ...filas.map((tr) => tr.querySelectorAll("th,td").length));
      const datos = /Honorarios|Renta Bruta|Total Neto Recibido|Documento Emitido/i.test(txt) ? 1000 : 0;
      const fecha = /\d{2}\/\d{2}\/\d{4}/.test(txt) ? 200 : 0;
      const score = datos + fecha + cols * 10 + filas.length;
      if (score > bestScore) { bestScore = score; best = tb; }
    }
    if (!best) return "";
    const clone = best.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("script,a,img,input,button,style").forEach((e) => e.remove());
    clone.querySelectorAll("*").forEach((e) => {
      for (const at of Array.from(e.attributes)) {
        if (/^on/i.test(at.name) || at.name === "href" || at.name === "class" || at.name === "id") e.removeAttribute(at.name);
      }
    });
    return clone.outerHTML;
  }).catch(() => "");
}

/** ¿Este frame es el del reporte de 4ta categoría? */
async function frameCuarta(ctx: any): Promise<any> {
  for (const fr of todosLosFrames(ctx)) {
    if (/cpelec001|cpelec|honorario|cuarta/i.test(fr.url())) return fr;
    const txt = (await fr.evaluate(() => (document.body?.innerText || "").slice(0, 500)).catch(() => "")) as string;
    if (/Ingresos de Cuarta Categor|Cuarta Categor|Recibo por Honorario/i.test(txt)) return fr;
  }
  return null;
}

export async function consultarCuartaCategoria(params: CuartaParams): Promise<CuartaResultado> {
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

    // 2) Acceso directo al "Reporte de Ingresos de Cuarta Categoría".
    const CODE = process.env.CUARTA_CODE || "11.5.1.1.12";
    await page.goto(`https://e-menu.sunat.gob.pe/cl-ti-itmenu/MenuInternet.htm?action=execute&code=${CODE}&s=ww1`, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(2500).catch(() => {});
    await cerrarPantallas(ctx, page);
    let fr: any = await frameCuarta(ctx);
    let opcion: string | null = null;
    if (!fr) opcion = await clicMenu(ctx, ["Reporte de Ingresos de Cuarta Categoría", "Cuarta Categoría", "Recibo por Honorarios"]);
    for (let i = 0; i < 12 && !fr; i++) { await page.waitForTimeout(1000).catch(() => {}); await cerrarPantallas(ctx, page); fr = await frameCuarta(ctx); }
    pasos.push({ paso: "menu", encontrado: !!fr, onclick: opcion });

    // 3) Elegir Mes (select) y Año (input), luego "Buscar".
    const mes = String(params.mes || "01").padStart(2, "0");
    const anio = String(params.anio || "").replace(/\D/g, "").slice(0, 4);
    let mesOk = false, anioOk = false;
    if (fr) {
      const sel = fr.locator('select[id*="mes" i], select[name*="mes" i], select').first();
      if (await sel.count().catch(() => 0)) {
        for (const arg of [{ value: mes }, { label: mes }, mes]) { try { await sel.selectOption(arg as any); mesOk = true; break; } catch { /* */ } }
      }
      for (const s of ['input[id*="anio" i]', 'input[id*="ano" i]', 'input[name*="anio" i]', 'input[name*="ano" i]', 'input[type="text"]']) {
        const el = fr.locator(s).first();
        if (await el.count().catch(() => 0)) { await el.fill(anio).catch(() => {}); const v = await el.inputValue().catch(() => ""); if (v) { anioOk = true; break; } }
      }
    }
    const estructura = await volcar(ctx);
    pasos.push({ paso: "form", mesOk, anioOk, mes, anio, ...estructura });

    // 4) Buscar → leer el reporte.
    let buscado = false;
    if (fr) {
      buscado = await clickAny(fr, ['input[value="Buscar" i]', '#btnBuscar', 'button:has-text("Buscar")']);
      if (!buscado) buscado = !!(await clickEnFrame(fr, ["Buscar", "Consultar"]));
    }
    await page.waitForTimeout(3500).catch(() => {});
    const frRep = (await frameCuarta(ctx)) || fr;
    const html = frRep ? await leerTablaCuartaHTML(frRep) : "";
    pasos.push({ paso: "reporte", buscado, htmlLen: html.length });

    if (params.diagnostico) return { ok: false, diag: { pasos } };
    if (!fr) return { ok: false, error: "No se encontró el formulario de Cuarta Categoría. Usa Modo diagnóstico.", diag: { pasos } };

    // Sin tabla = sin ingresos de 4ta en ese periodo (no es error).
    return { ok: true, cuarta: { mes, anio, html }, diag: { pasos } };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "Error consultando la Cuarta Categoría.", diag: { pasos } };
  } finally {
    clearTimeout(tope);
    if (browser) await browser.close().catch(() => {});
  }
}
