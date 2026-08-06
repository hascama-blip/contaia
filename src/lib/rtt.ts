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

/** Lista opciones del menú cuyo texto matchea un patrón (para calibrar el RTT). */
async function opcionesMenu(ctx: any, re: RegExp): Promise<any[]> {
  const out: any[] = [];
  for (const fr of todosLosFrames(ctx)) {
    const items = await fr.evaluate(() => {
      const norm = (s: any) => String(s || "").replace(/\s+/g, " ").trim();
      return (Array.from(document.querySelectorAll("a,span[onclick],li[onclick]")) as HTMLElement[])
        .map((e) => ({ text: norm(e.textContent), id: (e as any).id || "", onclick: (e.getAttribute("onclick") || "").slice(0, 60) }))
        .filter((x) => x.text && x.text.length < 80);
    }).catch(() => []);
    for (const it of items) if (re.test(it.text)) out.push({ ...it, frame: fr.url().slice(0, 70) });
  }
  return out;
}
/** Clic (vía JS, funciona con el árbol del menú oculto) en la opción por texto. */
async function clickMenuJS(ctx: any, patrones: string[]): Promise<{ ok: boolean; text?: string; frame?: string }> {
  for (const fr of todosLosFrames(ctx)) {
    const clicked = await fr.evaluate((pats: string[]) => {
      const res = pats.map((p) => new RegExp(p, "i"));
      const norm = (s: any) => String(s || "").replace(/\s+/g, " ").trim();
      const nodes = Array.from(document.querySelectorAll("a,span[onclick],li[onclick]")) as HTMLElement[];
      for (const n of nodes) {
        const t = norm(n.textContent);
        if (t && res.some((r) => r.test(t))) { (n as HTMLElement).click(); return t; }
      }
      return "";
    }, patrones).catch(() => "");
    if (clicked) return { ok: true, text: clicked, frame: fr.url().slice(0, 70) };
  }
  return { ok: false };
}

/** Pantalla 1 del RTT: marca la casilla y pulsa "Acepto" (vía JS, robusto). */
async function marcarYAceptar(fr: any): Promise<boolean> {
  return await fr.evaluate(() => {
    const c = document.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
    if (c) {
      c.checked = true;
      c.dispatchEvent(new Event("click", { bubbles: true }));
      c.dispatchEvent(new Event("change", { bubbles: true }));
    }
    const cands = Array.from(document.querySelectorAll("input,button,a")) as any[];
    const b = cands.find((e) => /acepto|aceptar/i.test(((e as any).value || "") + " " + (e.textContent || "")));
    if (b) { (b as any).disabled = false; (b as HTMLElement).click(); return true; }
    return false;
  }).catch(() => false);
}
/** ¿Este frame es el CONTENIDO del RTT (no el menú)? Por URL del app o textos propios. */
async function esFrameRTT(fr: any): Promise<{ app: boolean; correo: boolean; acepto: boolean }> {
  if (/menuinternet|cl-ti-itmenu/i.test(fr.url())) {
    // El frame del menú también dice "Reporte Tributario para Terceros"; ignóralo
    // salvo que tenga el campo de correo embebido.
    const campo = await fr.locator('#txtCorreo, input[name="txtCorreo"], input[type="email"]').count().catch(() => 0);
    return { app: !!campo, correo: !!campo, acepto: false };
  }
  const url = /itreportetri|reportetri/i.test(fr.url());
  const campo = await fr.locator('#txtCorreo, input[name="txtCorreo"], input[type="email"]').count().catch(() => 0);
  const txt = (await fr.evaluate(() => (document.body?.innerText || "").slice(0, 400)).catch(() => "")) as string;
  const acepto = /desea generar el reporte|marque la casilla|sr\.?\s*contribuyente/i.test(txt) || (await fr.locator('input[type="checkbox"]').count().catch(() => 0)) > 0;
  return { app: url || !!campo || acepto, correo: !!campo, acepto };
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

    // 2) Abrir el RTT POR EL MENÚ. Ir directo a ww1 devuelve "No se ha enviado
    //    correctamente los parametros de autenticacion": es el menú de SOL el que
    //    inyecta los parámetros de sesión al aplicativo. El árbol del menú está en
    //    el DOM (oculto), así que se dispara el clic por JS y el RTT abre en un
    //    iframe/pestaña con la sesión válida.
    const patrones = [
      "reporte tributario.*tercero",
      "reporte.*para terceros",
      "reporte tributario",
      "reporte.*tercero",
    ];
    const candidatos = await opcionesMenu(ctx, /reporte|tercero|tribut/i);
    const clic = await clickMenuJS(ctx, patrones);
    pasos.push({ paso: "menu-rtt", clico: clic.ok, opcion: clic.text, frame: clic.frame, urlDirecta: RTT_URL, candidatos: candidatos.slice(0, 30) });

    // Esperar a que cargue el CONTENIDO del RTT: primero la pantalla "Acepto"
    // (casilla + botón), luego la del correo. Se distingue del frame del menú.
    let frameRTT: any = null;
    let estado = { app: false, correo: false, acepto: false };
    for (let i = 0; i < 15 && !frameRTT; i++) {
      await page.waitForTimeout(1000).catch(() => {});
      for (const fr of todosLosFrames(ctx)) {
        const st = await esFrameRTT(fr);
        if (st.app) { frameRTT = fr; estado = st; break; }
      }
    }

    // 3) Pantalla 1 → marcar la casilla "Acepto" y pulsar el botón. Recién luego
    //    aparece la pantalla del correo (#txtCorreo). Si ya hay correo, se salta.
    let paso1 = false;
    if (frameRTT && estado.acepto && !estado.correo) {
      paso1 = await marcarYAceptar(frameRTT);
      // Esperar la pantalla del correo (mismo frame recargado o uno nuevo).
      for (let i = 0; i < 12; i++) {
        await page.waitForTimeout(1000).catch(() => {});
        let encontrado = false;
        for (const fr of todosLosFrames(ctx)) {
          const st = await esFrameRTT(fr);
          if (st.correo) { frameRTT = fr; estado = st; encontrado = true; break; }
        }
        if (encontrado) break;
      }
    }
    pasos.push({ paso: "acepto", aceptado: paso1, hayCorreo: estado.correo });

    // Volcado de estructura (para calibrar la navegación si algo no aparece).
    const estructura = await volcar(ctx);
    pasos.push({ paso: "estructura", emailDestino: params.emailDestino, formCargado: !!frameRTT, hayCorreo: estado.correo, ...estructura });

    if (params.diagnostico) return { ok: false, diag: { pasos } };

    if (!frameRTT) {
      return {
        ok: false,
        error: clic.ok
          ? "Se abrió la opción del RTT en el menú, pero el formulario no cargó. Usa Modo diagnóstico y revisa los pasos 'menu-rtt' y 'estructura'."
          : "No se encontró la opción del RTT en el menú de SOL. Usa Modo diagnóstico: en 'menu-rtt' → 'candidatos' están las opciones detectadas para calibrar el texto exacto.",
        diag: { pasos },
      };
    }

    // 4) Escribir el correo de destino (en el frame del RTT) y Enviar.
    const emailSels = ["#txtCorreo", 'input[name="txtCorreo"]', 'input[type="email"]', 'input[placeholder*="Correo" i]', 'input[type="text"]'];
    const fill = await fillEnFrames(ctx, emailSels, params.emailDestino);
    pasos.push({ paso: "correo", escrito: fill.ok, frame: fill.frameUrl, sel: fill.sel, emailDestino: params.emailDestino });
    if (!fill.ok) {
      return { ok: false, error: "Se llegó al RTT pero no apareció el campo de correo (tras 'Acepto'). Usa Modo diagnóstico y revisa 'acepto'/'estructura'.", diag: { pasos } };
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
