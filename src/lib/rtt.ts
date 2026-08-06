// ============================================================
//  RTT — bot que dispara la generación del Reporte Tributario para Terceros
// ============================================================
// Paso 3 de la trazabilidad: inicia sesión en SOL, entra por el MENÚ a
// "Reporte Tributario para Terceros" (ir directo a ww1 falla: SUNAT exige los
// parámetros de sesión que inyecta el menú), marca la casilla "Acepto" y escribe
// como correo de destino el sub-address con el RUC embebido (reportes+RUC{ruc}@
// dominio). SUNAT envía el PDF/XML por correo (asíncrono); el webhook lo captura.
//
// El inicio de sesión y la EVASIÓN de las pantallas flotantes ("Valida tus datos
// de contacto") están copiados del flujo YA PROBADO del buzón/fraccionamiento
// (mismos helpers), para no reintroducir problemas ya resueltos allí.

import { lanzarNavegador, bloquearRecursos } from "./navegador";

const LOGIN_URL =
  process.env.BUZON_LOGIN_URL ??
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

// ============================================================
//  Helpers copiados del flujo probado (buzón / fraccionamiento)
// ============================================================

async function rellenar(page: any, selectores: string[], valor: string) {
  for (const sel of selectores) {
    try {
      const el = await page.$(sel);
      if (el) { await el.fill(valor); return true; }
    } catch { /* siguiente */ }
  }
  return false;
}
async function clickAny(page: any, selectores: string[]) {
  for (const sel of selectores) {
    try {
      const el = await page.$(sel);
      if (el) { await el.click(); return true; }
    } catch { /* siguiente */ }
  }
  return false;
}

/** Acepta automáticamente cualquier alert/confirm ("mensaje de página web"). */
function autoAceptarDialogos(ctx: any) {
  const enganchar = (pg: any) => pg.on("dialog", (d: any) => d.accept().catch(() => {}));
  ctx.pages().forEach(enganchar);
  ctx.on("page", enganchar);
}

/** Todos los frames de todas las páginas del contexto. */
function todosLosFrames(ctx: any): any[] {
  const out: any[] = [];
  for (const pg of ctx.pages()) for (const fr of pg.frames()) out.push(fr);
  return out;
}

/** Clic por texto DENTRO de un frame concreto (JS click, tolera oculto). */
async function clickEnFrame(frame: any, textos: string[]): Promise<string | null> {
  return frame
    .evaluate((textos: string[]) => {
      const norm = (s: any) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
      const els = Array.from(
        document.querySelectorAll('a, button, input[type="button"], input[type="submit"], [role="button"]')
      ) as HTMLElement[];
      for (const t of textos) {
        const tl = norm(t);
        const el = els.find((e) => norm((e.textContent || "") + " " + ((e as HTMLInputElement).value || "")).includes(tl));
        if (el) { el.click(); return t; }
      }
      return null;
    }, textos)
    .catch(() => null);
}

/** Cierra la campaña "VALIDA TUS DATOS DE CONTACTO" dentro de SU frame
 *  (Continuar sin confirmar / Finalizar). Copiado tal cual de fraccionamiento. */
async function cerrarPantallas(ctx: any, page: any) {
  for (let i = 0; i < 6; i++) {
    const camp = ctx
      .pages()
      .flatMap((p: any) => p.frames())
      .find((f: any) => /itadminforuc-modifdatos|campanha/i.test(f.url()));
    if (!camp) break;
    await clickEnFrame(camp, ["Continuar sin confirmar"]);
    await page.waitForTimeout(1000);
    await clickEnFrame(camp, ["Finalizar"]);
    await page.waitForTimeout(1200);
  }
}

/** Clic en el ENLACE REAL del menú (onclick ejecuta/iconExecute) por su texto.
 *  Copiado de fraccionamiento (clicMenu). */
async function clicMenu(ctx: any, textos: string[]): Promise<string | null> {
  for (const pg of ctx.pages()) {
    for (const fr of pg.frames()) {
      const hit = await fr
        .evaluate((textos: string[]) => {
          const norm = (s: any) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
          const els = Array.from(document.querySelectorAll("a,[onclick]")) as HTMLElement[];
          for (const t of textos) {
            const el = els.find(
              (e) => /ejecuta\(|iconexecute/i.test(e.getAttribute("onclick") || "") && norm(e.textContent).includes(norm(t))
            );
            if (el) { el.click(); return (el.getAttribute("onclick") || "").slice(0, 160); }
          }
          return null;
        }, textos)
        .catch(() => null);
      if (hit) return hit;
    }
  }
  return null;
}

// ============================================================
//  Helpers específicos del RTT
// ============================================================

// Selectores del campo de correo del RTT (aparece tras "Acepto").
const CORREO_SELS = '#txtCorreo, input[name="txtCorreo"], input[type="email"], input[id*="correo" i], input[name*="correo" i], input[placeholder*="correo" i]';

/** ¿Este frame es el CONTENIDO del RTT? El RTT SIEMPRE vive en
 *  ol-ti-itreportetri/reportetri.htm. Cualquier otro frame (menú, campaña
 *  "valida tus datos" — que también tiene campos txtCorreo — o el reloj) NO es
 *  el RTT: exigir la URL evita rellenar el correo en el formulario equivocado. */
async function esFrameRTT(fr: any): Promise<{ app: boolean; correo: boolean; acepto: boolean }> {
  if (!/itreportetri|reportetri/i.test(fr.url())) return { app: false, correo: false, acepto: false };
  const correo = await fr.locator(CORREO_SELS).count().catch(() => 0);
  const acepto = await fr.locator("#chkAceptar").count().catch(() => 0);
  return { app: true, correo: !!correo, acepto: !!acepto };
}

/** Pantalla 1 del RTT: marca la casilla (#chkAceptar) y pulsa "Acepto".
 *  1) interacción REAL de Playwright; 2) respaldo por JS que ADEMÁS ejecuta el
 *  onclick del botón (algunos handlers no responden a un click sintético sobre
 *  un <a> deshabilitado por clase). Devuelve la vía que se usó. */
async function marcarYAceptar(fr: any): Promise<string> {
  const chk = fr.locator("#chkAceptar").first();
  if (await chk.count().catch(() => 0)) {
    await chk.check({ force: true }).catch(async () => { await chk.click({ force: true }).catch(() => {}); });
  }
  await fr.page().waitForTimeout(400).catch(() => {});
  // Clic real de Playwright sobre "Acepto".
  const acepto = fr.locator('a:has-text("Acepto"), input[value="Acepto" i], button:has-text("Acepto"), #btnAceptar').first();
  if (await acepto.count().catch(() => 0)) {
    await acepto.click({ force: true, timeout: 4000 }).catch(() => {});
  }
  await fr.page().waitForTimeout(600).catch(() => {});
  // Respaldo JS: asegurar checked, habilitar y EJECUTAR el onclick del botón.
  const via = (await fr.evaluate(() => {
    const c = document.querySelector("#chkAceptar") as HTMLInputElement | null;
    if (c && !c.checked) {
      c.checked = true;
      c.dispatchEvent(new Event("click", { bubbles: true }));
      c.dispatchEvent(new Event("change", { bubbles: true }));
    }
    const a = (Array.from(document.querySelectorAll("a,button,input")) as any[])
      .find((e) => /acepto/i.test((e.value || "") + " " + (e.textContent || "")));
    if (!a) return "sin-boton";
    a.classList?.remove("disabled"); a.removeAttribute?.("disabled"); a.disabled = false;
    const oc = a.getAttribute && a.getAttribute("onclick");
    if (oc) { try { (0, eval)(oc); return "onclick-eval"; } catch { /* sigue */ } }
    try { a.click(); return "js-click"; } catch { /* sigue */ }
    return "noop";
  }).catch(() => "err")) as string;
  await fr.page().waitForTimeout(1000).catch(() => {});
  return via;
}

/** Vuelca el checkbox y el botón "Acepto" reales del frame del RTT (para
 *  calibrar el handler exacto que abre la pantalla del correo). */
async function dumpRTT(fr: any): Promise<any> {
  return await fr.evaluate(() => {
    const norm = (s: any) => String(s || "").replace(/\s+/g, " ").trim();
    const c = document.querySelector("#chkAceptar") as HTMLInputElement | null;
    const botones = (Array.from(document.querySelectorAll("a,button,input")) as any[])
      .filter((e) => /acepto|generar|enviar|continuar/i.test((e.value || "") + " " + (e.textContent || "")))
      .map((e) => ({
        tag: e.tagName, txt: norm(e.textContent || e.value), cls: (e.className || "").slice(0, 60),
        disabled: !!e.disabled, onclick: (e.getAttribute && e.getAttribute("onclick") || "").slice(0, 160),
        href: (e.getAttribute && e.getAttribute("href") || "").slice(0, 100),
        html: (e.outerHTML || "").replace(/\s+/g, " ").slice(0, 220),
      })).slice(0, 8);
    return {
      checkbox: c ? { checked: c.checked, onclick: (c.getAttribute("onclick") || "").slice(0, 160), html: (c.outerHTML || "").replace(/\s+/g, " ").slice(0, 220) } : null,
      botones,
    };
  }).catch(() => null);
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

// ============================================================
//  Bot RTT
// ============================================================

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
    autoAceptarDialogos(ctx);
    const page = await ctx.newPage();

    // 1) Login SOL (secuencia idéntica a fraccionamiento/buzón, con reintento).
    let navOk = false;
    for (let i = 0; i < 3 && !navOk; i++) {
      try { await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 45000 }); navOk = true; }
      catch { await page.waitForTimeout(2000).catch(() => {}); }
    }
    if (!navOk) await page.goto(LOGIN_URL, { waitUntil: "commit", timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(2500).catch(() => {});
    await rellenar(page, ["#txtRuc", 'input[name="ruc"]', "#ruc"], params.ruc);
    await rellenar(page, ["#txtUsuario", 'input[name="usuario"]', "#usuario"], params.solUser);
    await rellenar(page, ["#txtContrasena", 'input[type="password"]', "#password"], params.solPass);
    await clickAny(page, ["#btnAceptar", 'button[type="submit"]', 'input[type="submit"]']);
    await page.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(3000).catch(() => {});
    // Cerrar campaña "valida tus datos" (dos vías, como fraccionamiento).
    for (let i = 0; i < 5; i++) {
      const camp = page.frames().find((f: any) => /itadminforuc-modifdatos|campanha/i.test(f.url()));
      if (!camp) break;
      await clickEnFrame(camp, ["Finalizar"]); await page.waitForTimeout(1200).catch(() => {});
      await clickEnFrame(camp, ["Continuar sin confirmar", "Continuar"]); await page.waitForTimeout(1800).catch(() => {});
    }
    await cerrarPantallas(ctx, page);

    const url = page.url();
    const texto = (await page.evaluate(() => (document.body?.innerText || "").slice(0, 300)).catch(() => "")) as string;
    const loginError = /oauth2\/error|autenticamenuinternet|problema en la aplicaci|no podemos atenderlo/i.test(url + " " + texto);
    pasos.push({ paso: "login", url, loginError });
    if (loginError) {
      return { ok: false, loginError: true, error: "SUNAT rechazó el inicio de sesión (Usuario/Clave SOL, o bloqueo temporal por varios intentos). Espera ~10 min y reintenta.", diag: { pasos } };
    }

    // 2) Entrar por el MENÚ a "Reporte Tributario para Terceros" (el menú inyecta
    //    los parámetros de sesión; ir directo a ww1 da error de autenticación).
    //    En SUNAT el texto viene pegado: "Reporte Tributariopara Terceros".
    await cerrarPantallas(ctx, page);
    const opcionMenu = await clicMenu(ctx, [
      "Reporte Tributariopara Terceros",
      "Reporte Tributario para Terceros",
      "Tributariopara Terceros",
      "para Terceros",
    ]);
    pasos.push({ paso: "menu-rtt", clico: !!opcionMenu, onclick: opcionMenu });

    // Esperar el CONTENIDO del RTT (frame ol-ti-itreportetri): primero la pantalla
    // "Acepto", luego la del correo. Se cierra la campaña por si reaparece.
    let frameRTT: any = null;
    let estado = { app: false, correo: false, acepto: false };
    for (let i = 0; i < 15 && !frameRTT; i++) {
      await page.waitForTimeout(1000).catch(() => {});
      await cerrarPantallas(ctx, page);
      for (const fr of todosLosFrames(ctx)) {
        const st = await esFrameRTT(fr);
        if (st.app) { frameRTT = fr; estado = st; break; }
      }
    }

    // 3) Pantalla 1 → marcar la casilla y pulsar "Acepto". Luego aparece el correo.
    let via = "no-frame";
    let domRTT: any = null;
    if (frameRTT && estado.acepto && !estado.correo) {
      if (params.diagnostico) domRTT = await dumpRTT(frameRTT); // antes de tocar
      via = await marcarYAceptar(frameRTT);
      for (let i = 0; i < 12; i++) {
        await page.waitForTimeout(1000).catch(() => {});
        await cerrarPantallas(ctx, page);
        let encontrado = false;
        for (const fr of todosLosFrames(ctx)) {
          const st = await esFrameRTT(fr);
          if (st.correo) { frameRTT = fr; estado = st; encontrado = true; break; }
        }
        if (encontrado) break;
      }
    }
    pasos.push({ paso: "acepto", via, hayCorreo: estado.correo, ...(domRTT ? { domRTT } : {}) });

    const estructura = await volcar(ctx);
    pasos.push({ paso: "estructura", emailDestino: params.emailDestino, formCargado: !!frameRTT, hayCorreo: estado.correo, ...estructura });

    if (params.diagnostico) return { ok: false, diag: { pasos } };

    if (!frameRTT) {
      return {
        ok: false,
        error: opcionMenu
          ? "Se abrió la opción del RTT en el menú, pero el formulario no cargó. Usa Modo diagnóstico y revisa 'menu-rtt' / 'estructura'."
          : "No se encontró la opción 'Reporte Tributario para Terceros' en el menú de SOL. Usa Modo diagnóstico y revisa 'estructura'.",
        diag: { pasos },
      };
    }

    // 4) Escribir el correo DENTRO del frame del RTT (nunca en el buscador del
    //    menú ni en la campaña de datos) y Enviar.
    let escrito = false, selUsado = "";
    for (const sel of CORREO_SELS.split(",").map((s) => s.trim())) {
      const el = frameRTT.locator(sel).first();
      if (await el.count().catch(() => 0)) {
        await el.fill(params.emailDestino).catch(() => {});
        const v = await el.inputValue().catch(() => "");
        if (v) { escrito = true; selUsado = sel; break; }
      }
    }
    pasos.push({ paso: "correo", escrito, sel: selUsado, emailDestino: params.emailDestino });
    if (!escrito) {
      return { ok: false, error: "Se llegó al RTT pero no apareció el campo de correo (tras 'Acepto'). Usa Modo diagnóstico y revisa 'acepto' / 'estructura'.", diag: { pasos } };
    }

    // Enviar dentro del frame del RTT (el confirm lo acepta autoAceptarDialogos).
    let enviado = false;
    for (const sel of ["#btnCorreo", "#btnEnviar", 'button[name="btnCorreo"]', 'button:has-text("Enviar")', 'input[value*="Enviar" i]', 'a:has-text("Enviar")']) {
      const el = frameRTT.locator(sel).first();
      if (await el.count().catch(() => 0)) { await el.click({ force: true, timeout: 4000 }).catch(() => {}); enviado = true; break; }
    }
    if (!enviado) enviado = !!(await clickEnFrame(frameRTT, ["Enviar"]));
    await page.waitForTimeout(2500).catch(() => {});
    const trasEnviar = (await frameRTT.evaluate(() => (document.body?.innerText || "").slice(0, 300)).catch(() => "")) as string;
    pasos.push({ paso: "enviar", clico: enviado, respuesta: trasEnviar.slice(0, 200) });

    return { ok: enviado, error: enviado ? undefined : "No se pudo pulsar Enviar en el formulario del RTT.", diag: { pasos } };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "Error generando el RTT.", diag: { pasos } };
  } finally {
    clearTimeout(tope);
    if (browser) await browser.close().catch(() => {});
  }
}
