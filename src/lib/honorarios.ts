// ============================================================
//  Honorarios (RxH) — Consulta Receptor (SEE): extrae los Recibos por Honorarios
//  Electrónicos que la empresa RECIBIÓ (como receptor/pagador) para armar la
//  plantilla de importación a Contasis.
// ============================================================
// Reusa el MISMO scraping ya probado del buzón/RTT: login SOL + cerrar la
// campaña "valida tus datos" + entrar por el MENÚ. Ruta en el menú:
//   Empresas → Comprobantes de pago → SEE-SOL → Recibo por Honorarios
//   Electrónicos → "Consulta Receptor".
// El formulario "Consulta al SEE - Receptor" filtra por RANGO DE FECHAS
// (dd/mm/aaaa). Aquí SIEMPRE se consulta por MES(ES) COMPLETO(S): del día 1 del
// mes inicial al último día del mes final. Trae un REGISTRADOR de peticiones para
// capturar el endpoint de datos (sin DevTools).

import { lanzarNavegador, bloquearRecursos } from "./navegador";

const LOGIN_URL =
  process.env.BUZON_LOGIN_URL ??
  "https://e-menu.sunat.gob.pe/cl-ti-itmenu/MenuInternet.htm?exe=01.04.00.00.000000";

export interface HonorariosParams {
  ruc: string;
  solUser: string;
  solPass: string;
  /** Mes inicial y final del rango, en "YYYYMM" (meses completos). Si falta
   *  `hasta`, se consulta solo el mes `desde`. */
  desde?: string;
  hasta?: string;
  diagnostico?: boolean;
}

export interface HonorariosResultado {
  ok: boolean;
  loginError?: boolean;
  error?: string;
  recibos?: any[];
  diag?: { pasos: any[]; requests?: any[]; rango?: { fi: string; ff: string } };
}

/** Rango de fechas (dd/mm/aaaa) para MES(ES) COMPLETO(S) a partir de YYYYMM. */
export function rangoMeses(desde?: string, hasta?: string): { fi: string; ff: string } {
  const norm = (s?: string) => String(s || "").replace(/\D/g, "");
  const hoy = new Date();
  const d = norm(desde) || `${hoy.getFullYear()}${String(hoy.getMonth() + 1).padStart(2, "0")}`;
  const h = norm(hasta) || d;
  const y1 = +d.slice(0, 4), m1 = +d.slice(4, 6) || 1;
  const y2 = +h.slice(0, 4), m2 = +h.slice(4, 6) || 12;
  const p2 = (n: number) => String(n).padStart(2, "0");
  const ultimo = new Date(y2, m2, 0).getDate(); // último día del mes final
  return { fi: `01/${p2(m1)}/${y1}`, ff: `${p2(ultimo)}/${p2(m2)}/${y2}` };
}

// ---- Helpers (copiados del flujo probado del RTT/buzón) ----
async function rellenar(page: any, selectores: string[], valor: string) {
  for (const sel of selectores) {
    try { const el = await page.$(sel); if (el) { await el.fill(valor); return true; } } catch { /* */ }
  }
  return false;
}
async function clickAny(page: any, selectores: string[]) {
  for (const sel of selectores) {
    try { const el = await page.$(sel); if (el) { await el.click(); return true; } } catch { /* */ }
  }
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
      const tl = norm(t);
      const el = els.find((e) => norm((e.textContent || "") + " " + ((e as HTMLInputElement).value || "")).includes(tl));
      if (el) { el.click(); return t; }
    }
    return null;
  }, textos).catch(() => null);
}
async function cerrarPantallas(ctx: any, page: any) {
  for (let i = 0; i < 6; i++) {
    const camp = ctx.pages().flatMap((p: any) => p.frames()).find((f: any) => /itadminforuc-modifdatos|campanha/i.test(f.url()));
    if (!camp) break;
    await clickEnFrame(camp, ["Finalizar"]); await page.waitForTimeout(1000);
    await clickEnFrame(camp, ["Continuar sin confirmar", "Continuar"]); await page.waitForTimeout(1200);
  }
}
/** Clic en el ENLACE REAL del menú por su texto; devuelve TODOS los onclick que
 *  coinciden (para saber cuál es la opción correcta cuando hay duplicados). */
async function clicMenu(ctx: any, textos: string[]): Promise<{ clico: string | null; candidatos: string[] }> {
  for (const pg of ctx.pages()) {
    for (const fr of pg.frames()) {
      const r = await fr.evaluate((textos: string[]) => {
        const norm = (s: any) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
        const els = Array.from(document.querySelectorAll("a,[onclick]")) as HTMLElement[];
        const candidatos: string[] = [];
        let clicado: string | null = null;
        for (const t of textos) {
          for (const e of els) {
            const oc = e.getAttribute("onclick") || "";
            if (/ejecuta\(|iconexecute/i.test(oc) && norm(e.textContent).includes(norm(t))) {
              candidatos.push(oc.slice(0, 160));
              if (!clicado) { e.click(); clicado = oc.slice(0, 160); }
            }
          }
          if (clicado) break;
        }
        return { clicado, candidatos };
      }, textos).catch(() => null as any);
      if (r && (r.clicado || (r.candidatos && r.candidatos.length))) return { clico: r.clicado, candidatos: r.candidatos };
    }
  }
  return { clico: null, candidatos: [] };
}

/** ¿Es el frame del formulario "Consulta SEE - Receptor"? (por su contenido). */
async function esFrameReceptor(fr: any): Promise<boolean> {
  return fr.evaluate(() => /Fecha De Inicio|RUC del Emisor|Emisi[oó]n Electr[oó]nica.*Receptor|Tipo de Comprobante/i.test(document.body?.innerText || "")).catch(() => false);
}

/** Rellena Fecha Inicio / Fecha Fin ubicando el input por su etiqueta. Devuelve
 *  los id/name hallados (para calibrar). */
async function llenarFechas(frame: any, fi: string, ff: string): Promise<any> {
  return frame.evaluate(({ fi, ff }: { fi: string; ff: string }) => {
    const norm = (s: any) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
    const inputsTxt = () => Array.from(document.querySelectorAll('input[type="text"], input:not([type])')) as HTMLInputElement[];
    const setByLabel = (needle: string, val: string) => {
      const labs = Array.from(document.querySelectorAll("td,label,th,div,span,b")) as HTMLElement[];
      const lab = labs.find((e) => norm(e.textContent).includes(needle) && norm(e.textContent).length < 60);
      if (!lab) return null;
      // input de texto en la misma fila; si no, el primer input de texto que sigue al label.
      const fila = lab.closest("tr") || lab.parentElement || document.body;
      let inp = fila.querySelector('input[type="text"], input:not([type])') as HTMLInputElement | null;
      if (!inp) inp = inputsTxt().find((i) => lab.compareDocumentPosition(i) & Node.DOCUMENT_POSITION_FOLLOWING) || null;
      if (inp) {
        inp.value = val;
        inp.dispatchEvent(new Event("input", { bubbles: true }));
        inp.dispatchEvent(new Event("change", { bubbles: true }));
        inp.dispatchEvent(new Event("blur", { bubbles: true }));
        return { id: inp.id || "", name: inp.name || "" };
      }
      return null;
    };
    return { inicio: setByLabel("fecha de inicio", fi), fin: setByLabel("fecha de fin", ff) };
  }, { fi, ff }).catch(() => null);
}

/** Vuelca la estructura visible de todos los frames (inputs/links/tabla). */
async function volcar(ctx: any): Promise<any> {
  const frames: any[] = [];
  for (const pg of ctx.pages()) {
    for (const fr of pg.frames()) {
      const info = await fr.evaluate(() => {
        const norm = (s: any) => String(s || "").replace(/\s+/g, " ").trim();
        const inputs = (Array.from(document.querySelectorAll("input,select,textarea,button")) as HTMLElement[])
          .map((e) => ({ t: e.tagName.toLowerCase(), tipo: (e as HTMLInputElement).type || "", id: (e as any).id || "", name: (e as any).name || "", ph: e.getAttribute("placeholder") || "", txt: norm(e.textContent).slice(0, 30) }))
          .slice(0, 70);
        const tablaCols = (Array.from(document.querySelectorAll("table th")) as HTMLElement[]).map((e) => norm(e.textContent)).filter(Boolean).slice(0, 30);
        const filas = (Array.from(document.querySelectorAll("table tbody tr")).slice(0, 3) as HTMLElement[])
          .map((tr) => Array.from(tr.querySelectorAll("td")).map((td) => norm(td.textContent).slice(0, 24)));
        return { titulo: norm(document.title), textoTop: norm((document.body?.innerText || "").slice(0, 180)), inputs, tablaCols, filas };
      }).catch(() => null);
      if (info && (info.inputs?.length || info.tablaCols?.length)) frames.push({ url: fr.url().slice(0, 130), ...info });
    }
  }
  return { frames };
}

// ============================================================
//  Bot
// ============================================================
export async function extraerHonorarios(params: HonorariosParams): Promise<HonorariosResultado> {
  const pasos: any[] = [];
  const requests: any[] = [];
  const rango = rangoMeses(params.desde, params.hasta);
  let browser: any = null;
  const tope = setTimeout(() => { if (browser) browser.close().catch(() => {}); }, 240000);
  try {
    browser = await lanzarNavegador();
    const ctx = await browser.newContext({
      acceptDownloads: true,
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    });
    await bloquearRecursos(ctx);
    autoAceptarDialogos(ctx);
    // REGISTRADOR de peticiones a SUNAT (para ver el endpoint de datos).
    ctx.on("request", (req: any) => {
      try {
        const url = req.url();
        const tipo = req.resourceType();
        if (!/sunat\.gob\.pe/i.test(url)) return;
        if (["xhr", "fetch", "document"].includes(tipo) && !/\.(js|css|png|jpg|gif|svg|woff2?|ico)(\?|$)/i.test(url)) {
          requests.push({ m: req.method(), t: tipo, url: url.slice(0, 220) });
          if (requests.length > 60) requests.shift();
        }
      } catch { /* */ }
    });
    const page = await ctx.newPage();

    // 1) Login SOL.
    let navOk = false;
    for (let i = 0; i < 3 && !navOk; i++) {
      try { await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 70000 }); navOk = true; }
      catch { await page.waitForTimeout(2000).catch(() => {}); }
    }
    await page.waitForTimeout(2500).catch(() => {});
    await rellenar(page, ["#txtRuc", 'input[name="ruc"]', "#ruc"], params.ruc);
    await rellenar(page, ["#txtUsuario", 'input[name="usuario"]', "#usuario"], params.solUser);
    await rellenar(page, ["#txtContrasena", 'input[type="password"]', "#password"], params.solPass);
    await clickAny(page, ["#btnAceptar", 'button[type="submit"]', 'input[type="submit"]']);
    await page.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(3000).catch(() => {});
    await cerrarPantallas(ctx, page);
    const url = page.url();
    const loginError = /oauth2\/error|autenticamenuinternet|problema en la aplicaci|no podemos atenderlo/i.test(url);
    pasos.push({ paso: "login", url, loginError });
    if (loginError) return { ok: false, loginError: true, error: "SUNAT rechazó el inicio de sesión (Usuario/Clave SOL o bloqueo temporal).", diag: { pasos, requests, rango } };

    // 2) Entrar por el menú a "Consulta Receptor".
    await cerrarPantallas(ctx, page);
    const menu = await clicMenu(ctx, ["Consulta Receptor", "Consulta del Receptor"]);
    pasos.push({ paso: "menu-consulta-receptor", clico: !!menu.clico, onclick: menu.clico, candidatos: menu.candidatos });

    // 3) Esperar el formulario "Consulta SEE - Receptor" (detección por contenido).
    let appFrame: any = null;
    for (let i = 0; i < 15 && !appFrame; i++) {
      await page.waitForTimeout(1200).catch(() => {});
      await cerrarPantallas(ctx, page);
      for (const fr of todosLosFrames(ctx)) {
        if (await esFrameReceptor(fr)) { appFrame = fr; break; }
      }
    }
    pasos.push({ paso: "app-cargada", encontrada: !!appFrame, url: appFrame ? appFrame.url().slice(0, 160) : null });

    // 4) Llenar el RANGO de fechas (meses completos) y Buscar.
    let fechas: any = null;
    if (appFrame) {
      fechas = await llenarFechas(appFrame, rango.fi, rango.ff);
      pasos.push({ paso: "fechas", fi: rango.fi, ff: rango.ff, campos: fechas });
      await clickEnFrame(appFrame, ["Buscar", "Consultar"]).catch(() => {});
      await page.waitForTimeout(4000).catch(() => {});
    }

    // 5) En diagnóstico: volcar estructura + resultado + peticiones capturadas.
    if (params.diagnostico) {
      const estructura = await volcar(ctx);
      pasos.push({ paso: "estructura", ...estructura });
      return { ok: false, diag: { pasos, requests, rango } };
    }

    // 6) Extracción real: pendiente de calibrar con el endpoint del diagnóstico.
    return { ok: false, error: "Extracción aún no calibrada. Corre el Modo diagnóstico y comparte el endpoint capturado.", diag: { pasos, requests, rango } };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "Error extrayendo honorarios.", diag: { pasos, requests, rango } };
  } finally {
    clearTimeout(tope);
    if (browser) await browser.close().catch(() => {});
  }
}
