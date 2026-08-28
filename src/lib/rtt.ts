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
import { resolverCaptchaSiHay, hookTurnstileSitekey, hookRecaptchaV3, detectarRecaptchaV3, resolverTurnstileSunat } from "./captcha";

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

/** Pantalla 1 del RTT: marca la casilla y pasa a la pantalla del correo.
 *  Capturado con DevTools: "Acepto" es un GET a
 *  reportetri.htm?action=cargarFormulario, SIN hc/token (la sesión va por
 *  cookies). Como ya entramos por el menú, las cookies están puestas: navegamos
 *  el frame DIRECTO a esa URL y así saltamos el checkbox + "Acepto". */
// El flujo REAL: marcar la casilla "Acepto" y pulsar el botón "Acepto"
// (#btnAceptar). Esto lo hace SUNAT: arma el hidden `token` y corre initTurnstile.
// Se usa .check()/.click() de Playwright (clic REAL): con eventos sintéticos la
// casilla se destildaba y el botón quedaba deshabilitado → Acepto no avanzaba.
async function irAlFormularioCorreo(fr: any): Promise<string> {
  let via = "acepto:?";
  try {
    // 1) Marcar la casilla (SIN ella el botón "Acepto" queda deshabilitado) y
    //    VERIFICAR que quedó tildada; si no, reintentar con clic + eventos.
    const chk = fr.locator('#chkAceptar, input[type="checkbox"]').first();
    if (await chk.count().catch(() => 0)) {
      for (let t = 0; t < 3; t++) {
        await chk.check({ force: true, timeout: 4000 }).catch(() => {});
        if (await chk.isChecked().catch(() => false)) break;
        // Forzar por JS + disparar change (habilita el botón).
        await fr.evaluate(() => {
          const c = (document.querySelector("#chkAceptar") || document.querySelector('input[type="checkbox"]')) as HTMLInputElement | null;
          if (c) { c.checked = true; c.dispatchEvent(new Event("change", { bubbles: true })); }
        }).catch(() => {});
        await fr.page().waitForTimeout(300).catch(() => {});
      }
    }
    await fr.page().waitForTimeout(400).catch(() => {});
    // 2) Pulsar "Acepto" (botón o enlace), ya habilitado por la casilla.
    const btn = fr.locator('#btnAceptar, button:has-text("Acepto"), a:has-text("Acepto"), input[value*="Acepto" i]').first();
    if (await btn.count().catch(() => 0)) { await btn.click({ force: true, timeout: 5000 }).catch(() => {}); via = "acepto:click"; }
    else via = "acepto:sin-boton";
  } catch { via = "acepto:err"; }
  await fr.page().waitForTimeout(2500).catch(() => {});
  return via;
}

// RESPALDO: navegar el frame DIRECTO al formulario del correo. La sesión viaja
// por cookies (ya entramos por el menú), así que este GET carga el form con todo
// el Turnstile aunque el clic en "Acepto" no haya avanzado.
const FORM_CORREO_URL = "https://ww1.sunat.gob.pe/ol-ti-itreportetri/reportetri.htm?action=cargarFormulario";
async function saltarPorGet(fr: any): Promise<void> {
  await fr.evaluate((u: string) => { try { window.location.href = u; } catch (e) { /* */ } }, FORM_CORREO_URL).catch(() => {});
  await fr.page().waitForTimeout(2200).catch(() => {});
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
  const tope = setTimeout(() => { if (browser) browser.close().catch(() => {}); }, 285000);
  try {
    // Se corre IGUAL que el buzón (lanzarNavegador() sin proxy): ese camino YA
    // llega a SUNAT y hace login. El reCAPTCHA v3 NO se resuelve con la IP: lo
    // GENERA CapSolver (buena reputación) y lo inyectamos antes de Enviar
    // (hookRecaptchaV3 + resolverRecaptchaV3). Así el proxy deja de ser necesario.
    browser = await lanzarNavegador();
    const ctx = await browser.newContext({
      acceptDownloads: true,
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    });
    await bloquearRecursos(ctx);
    await hookTurnstileSitekey(ctx); // captura el sitekey del Turnstile (SUNAT lo pasa por JS)
    await hookRecaptchaV3(ctx);      // captura sitekey/action del v3 y permite devolver nuestro token
    autoAceptarDialogos(ctx);
    const page = await ctx.newPage();

    // 1) Login SOL (secuencia idéntica a fraccionamiento/buzón, con reintento).
    //    Se GUARDA el net-error de cada intento: si el proxy no tuneliza HTTPS a
    //    SUNAT, aquí sale ERR_TUNNEL/ERR_TIMED_OUT y la URL queda en chrome-error.
    let navOk = false;
    let navErr = "";
    for (let i = 0; i < 3 && !navOk; i++) {
      try { await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 70000 }); navOk = true; }
      catch (e: any) { navErr = String(e?.message ?? e).replace(/\s+/g, " ").slice(0, 160); await page.waitForTimeout(2000).catch(() => {}); }
    }
    if (!navOk) {
      try { await page.goto(LOGIN_URL, { waitUntil: "commit", timeout: 70000 }); navOk = true; }
      catch (e: any) { navErr = String(e?.message ?? e).replace(/\s+/g, " ").slice(0, 160); }
    }
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
    // La navegación misma falló (proxy no llegó a SUNAT): la URL queda en
    // chrome-error o about:blank. Es distinto de "SUNAT rechazó la clave".
    const navFallo = /^chrome-error|^about:blank/i.test(url) || !navOk;
    const loginError = /oauth2\/error|autenticamenuinternet|problema en la aplicaci|no podemos atenderlo/i.test(url + " " + texto);
    pasos.push({ paso: "login", url, navOk, navErr: navErr || undefined, navFallo, loginError });
    if (navFallo) {
      return {
        ok: false,
        loginError: true,
        error:
          "No se pudo abrir la página de SUNAT (la navegación falló: " +
          (navErr || "chrome-error") +
          "). Suele ser el proxy residencial: no tuneliza HTTPS a SUNAT o está lento/caído. En el panel del supremo usa 'Probar proxy' y revisa que 'SUNAT (HTTPS)' salga ✓.",
        diag: { pasos },
      };
    }
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

    // 3) Pasar de la pantalla "Acepto" al formulario del correo, con REINTENTO:
    //    a veces el Acepto no avanza al primer intento (casilla/boton), así que
    //    se reintenta hasta 3 veces esperando que aparezca el campo de correo.
    let via = "no-frame";
    if (frameRTT && !estado.correo) {
      for (let intento = 0; intento < 3 && !estado.correo; intento++) {
        // Intento 0: "Acepto" real (mimetiza al usuario). Intentos 1-2: RESPALDO
        // por GET a ?action=cargarFormulario, que SIEMPRE carga el formulario del
        // correo con el Turnstile (turnstileSitekey/getTokenTurnstile/enviarCorreo).
        if (intento === 0) via = await irAlFormularioCorreo(frameRTT);
        else { via = "get-jump"; await saltarPorGet(frameRTT); }
        for (let i = 0; i < 10 && !estado.correo; i++) {
          await page.waitForTimeout(1000).catch(() => {});
          await cerrarPantallas(ctx, page);
          for (const fr of todosLosFrames(ctx)) {
            const st = await esFrameRTT(fr);
            if (st.correo) { frameRTT = fr; estado = st; break; }
            if (st.app && st.acepto) frameRTT = fr; // seguir en la pantalla Acepto
          }
        }
      }
    }
    pasos.push({ paso: "cargar-formulario", via, hayCorreo: estado.correo });

    const estructura = await volcar(ctx);
    pasos.push({ paso: "estructura", emailDestino: params.emailDestino, formCargado: !!frameRTT, hayCorreo: estado.correo, ...estructura });

    // En diagnóstico: verificar el LÍMITE del campo de correo (SUNAT suele
    // truncar la dirección ~40 chars) y probar el captcha, SIN llegar a Enviar.
    if (params.diagnostico) {
      if (frameRTT) {
        const chk = await frameRTT.evaluate((email: string) => {
          const el = document.querySelector('#txtCorreo, input[name="txtCorreo"], input[type="email"]') as HTMLInputElement | null;
          if (!el) return null;
          const max = el.maxLength; // -1 = sin límite
          try { el.value = email; } catch (e) { /* */ }
          return { maxLength: max, valorTrasEscribir: (el.value || "").length };
        }, params.emailDestino).catch(() => null as any);
        if (chk) pasos.push({
          paso: "correo-limite",
          emailDestino: params.emailDestino,
          longitud: params.emailDestino.length,
          maxLength: chk.maxLength,
          truncaria: chk.maxLength != null && chk.maxLength > 0 && params.emailDestino.length > chk.maxLength,
        });
      }
      await resolverCaptchaSiHay(ctx, page, pasos).catch(() => false);
      // El reCAPTCHA del RTT APARECE al Enviar (capa translúcida con el desafío).
      // Antes de Enviar no hay sitekey. Así que en diagnóstico: escribimos el
      // correo, damos Enviar (NO envía sin resolver el captcha) y volcamos qué
      // captcha apareció + intentamos resolverlo con CapSolver.
      const v3pre = await detectarRecaptchaV3(ctx).catch(() => null);
      pasos.push({ paso: "recaptchaV3-detect", ...(v3pre || { detectado: false }), nota: "antes de Enviar (suele venir vacío: el captcha aparece al Enviar)" });
      if (frameRTT) {
        // SONDA: qué es el botón Enviar y qué JS/recaptcha hay en el form ANTES
        // de tocarlo (para entender por qué el captcha no aparece).
        const sonda = (fr: any) => fr.evaluate(() => {
          const g: any = (window as any).grecaptcha;
          const scriptSrcs = (Array.from(document.querySelectorAll("script[src]")) as HTMLScriptElement[]).map((s) => s.src || "").slice(0, 40);
          const inline = (Array.from(document.querySelectorAll("script:not([src])")) as HTMLScriptElement[]).map((s) => s.textContent || "").join("\n");
          const iframeSrcs = (Array.from(document.querySelectorAll("iframe")) as HTMLIFrameElement[]).map((f) => f.src || "");
          const html = document.documentElement.outerHTML;
          const site = (/6L[0-9A-Za-z_-]{38}(?![0-9A-Za-z_-])/.exec(html) || [])[0] || null;
          const render = (/render=(6L[0-9A-Za-z_-]{38})/.exec(html) || [])[1] || null;
          const btn = (document.querySelector('#btnEnviar, #btnCorreo, [name="btnCorreo"]')
            || (Array.from(document.querySelectorAll("a,button,input")) as HTMLElement[]).find((e) => /enviar/i.test((e.textContent || "") + ((e as HTMLInputElement).value || "")))) as HTMLElement | null;
          return {
            typeofGrecaptcha: typeof g,
            grecaptchaExecute: !!(g && typeof g.execute === "function"),
            scriptSrcs,
            recaptchaEnScripts: /recaptcha/i.test(scriptSrcs.join(" ")),
            recaptchaEnInline: /grecaptcha|g-recaptcha|recaptcha|execute\s*\(/i.test(inline),
            iframeSrcs,
            siteEnHtml: site,
            renderEnHtml: render,
            enviarBtn: btn ? { tag: btn.tagName, id: (btn as any).id || "", onclick: (btn.getAttribute("onclick") || "").slice(0, 220), href: (btn.getAttribute("href") || "").slice(0, 160), texto: (btn.textContent || "").trim().slice(0, 40) } : null,
            texto: (document.body?.innerText || "").replace(/\s+/g, " ").slice(0, 500),
          };
        }).catch(() => null);

        pasos.push({ paso: "sonda-antes", ...(await sonda(frameRTT)) });

        // DETALLE del form: ¿el token viene vacío (por GET-saltar Acepto)?, ¿el
        // botón está deshabilitado?, ¿qué hace el handler inline de Enviar?
        const detalle = await frameRTT.evaluate(() => {
          const val = (id: string) => ((document.getElementById(id) as HTMLInputElement | null)?.value || "");
          const btn = document.getElementById("btnCorreo") as HTMLButtonElement | null;
          const inlines = (Array.from(document.querySelectorAll("script:not([src])")) as HTMLScriptElement[]).map((s) => s.textContent || "");
          const relevantes = inlines
            .filter((t) => /btnCorreo|turnstile|enviarCorreo|grecaptcha|sunatTurnstile|sunatRecaptcha|onSubmit|submit|Acepto|cargarFormulario/i.test(t))
            .map((t) => t.replace(/\s+/g, " ").trim().slice(0, 900));
          const fns = Object.keys(window as any).filter((k) => /turnstile|recaptcha|enviar|correo|sunat|acepto|reporte/i.test(k)).slice(0, 40);
          return {
            tokenVal: val("token").slice(0, 40),
            tokenLen: val("token").length,
            tokenV3Len: val("tokenCaptchaV3").length,
            btnDisabled: btn ? btn.disabled : null,
            btnHtml: btn ? btn.outerHTML.slice(0, 220) : null,
            windowFns: fns,
            inlineRelevantes: relevantes.slice(0, 8),
          };
        }).catch(() => null);
        pasos.push({ paso: "detalle-form", ...(detalle || { error: "no se pudo leer" }) });

        await frameRTT.locator('#txtCorreo, input[name="txtCorreo"], input[type="email"]').first().fill(params.emailDestino).catch(() => {});
        // FUENTES: el código EXACTO de las funciones de SUNAT (para saber cómo
        // dispara el envío: si enviarCorreo es el callback del Turnstile, si usa
        // turnstile.execute, qué valida, etc.) y así conducir bien el POST.
        const fuentes = await frameRTT.evaluate(() => {
          const src = (n: string) => { try { const f = (window as any)[n]; return typeof f === "function" ? f.toString().replace(/\s+/g, " ").slice(0, 1600) : "typeof:" + typeof f; } catch (e) { return "err"; } };
          return {
            initTurnstile: src("initTurnstile"),
            enviarCorreo: src("enviarCorreo"),
            getTokenTurnstile: src("getTokenTurnstile"),
            validaCorreo: src("validaCorreo"),
            turnstileWidgetId: String((window as any).turnstileWidgetId),
          };
        }).catch(() => null);
        pasos.push({ paso: "fuentes-sunat", ...(fuentes || { error: "no se pudo leer" }) });
        // TURNSTILE del RTT vía funciones de SUNAT: leer turnstileSitekey y
        // resolverlo con CapSolver (sobrescribe getTokenTurnstile). NO se pulsa
        // Enviar en diagnóstico → no se manda el reporte, solo se valida.
        await resolverTurnstileSunat(ctx, frameRTT, pasos).catch(() => false);
      }
      return { ok: false, diag: { pasos } };
    }

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

    // Buscar el frame del RTT fresco (tras enviar la pantalla se re-renderiza).
    const frameActual = () => todosLosFrames(ctx).find((f: any) => /reportetri|itreportetri/i.test(f.url())) || frameRTT;
    const leerTexto = async () => (await (frameActual()).evaluate(() => (document.body?.innerText || "").slice(0, 600)).catch(() => "")) as string;
    const yaExito = (t: string) => /se est[aá] procesando|bandeja de correo|se ha enviado|de manera exitosa|exitos|env[ií]o.*exitos|generar.*reporte.*correo/i.test(t);
    // Error VISIBLE de SUNAT (cuadro rojo #msgCorreoErr / alertas): correo
    // inválido, límite de 3/día, o rechazo de la validación de seguridad.
    const leerError = async (): Promise<string> => (await (frameActual()).evaluate(() => {
      const cajas = ["#msgCorreoErr", "#msgNidiErr", "#msgErrorCorreo", ".alert-danger", ".has-error .help-block", ".text-danger"];
      for (const s of cajas) {
        const el = document.querySelector(s) as HTMLElement | null;
        const vis = el && (el.offsetParent !== null || !el.classList.contains("hidden"));
        const t = (el?.innerText || "").replace(/\s+/g, " ").trim();
        if (vis && t) return t.slice(0, 180);
      }
      const body = document.body?.innerText || "";
      const m = /(no es v[aá]lid[oa][^.]*|solo.*\d+ reporte[^.]*d[ií]a[^.]*|excedi[óo][^.]*|error en la validaci[oó]n[^.]*|no se ha[^.]*generar[^.]*)/i.exec(body);
      return m ? m[1].replace(/\s+/g, " ").trim().slice(0, 180) : "";
    }).catch(() => "")) as string;

    // ENVÍO reforzado: replicamos el callback del Turnstile (poner token en #token
    // + form01.submit). Hasta 3 intentos con token NUEVO (el de Turnstile es de un
    // solo uso y caduca). Tras cada intento se SONDEA hasta ~18s el cuadro verde o
    // un error visible de SUNAT (para no esperar de más ni de menos).
    let enviado = false;
    let trasEnviar = "";
    let errorSunat = "";
    for (let intento = 0; intento < 3 && !yaExito(trasEnviar); intento++) {
      const ok = await resolverTurnstileSunat(ctx, frameActual(), pasos, true).catch(() => false);
      if (ok) enviado = true;
      for (let i = 0; i < 12 && !yaExito(trasEnviar); i++) {
        await page.waitForTimeout(1500).catch(() => {});
        trasEnviar = await leerTexto();
        if (yaExito(trasEnviar)) break;
        errorSunat = await leerError();
        if (errorSunat) break; // SUNAT mostró un error concreto → no reintentar a ciegas
      }
      // Correo inválido o límite: reintentar no ayuda → cortar.
      if (/no es v[aá]lid|reporte.*d[ií]a|excedi/i.test(errorSunat)) break;
    }
    const exito = yaExito(trasEnviar);
    const fallo = !exito && (!!errorSunat || /no es v[aá]lid|inv[aá]lid|no se pudo|vuelva a intentar|captcha|verificaci[oó]n/i.test(trasEnviar));
    pasos.push({ paso: "enviar", enviado, exito, fallo, errorSunat: errorSunat || undefined, respuesta: trasEnviar.slice(0, 300) });

    if (exito) return { ok: true, diag: { pasos } };
    if (errorSunat) return { ok: false, error: "SUNAT no aceptó el envío: " + errorSunat, diag: { pasos } };
    if (!enviado) return { ok: false, error: "No se pudo resolver la verificación de seguridad (Turnstile). Reintenta en unos minutos.", diag: { pasos } };
    // Se envió el form pero SUNAT no confirmó a tiempo: puede que el correo llegue
    // igual; se deja en proceso (el webhook lo capturará) en vez de marcar error.
    return { ok: true, diag: { pasos } };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "Error generando el RTT.", diag: { pasos } };
  } finally {
    clearTimeout(tope);
    if (browser) await browser.close().catch(() => {});
  }
}
