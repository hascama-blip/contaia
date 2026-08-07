// ============================================================
//  Reporte Electrónico de Rentas y Retenciones — bot (persona natural, 4ta/5ta)
// ============================================================
// Como el RTT: login SOL → entra por el MENÚ a "Reporte Electrónico de Rentas y
// Retenciones" → deja el ejercicio (por defecto 2025) → escribe el correo de la
// nube (reportes+RENTAS{ruc}@dominio) → "Generar Reporte". SUNAT lo envía por
// correo (asíncrono); el webhook lo captura y el parser (reporteRentas.ts) lo lee.
// El login y la evasión de pantallas flotantes son los mismos helpers del RTT.

import { lanzarNavegador, bloquearRecursos } from "./navegador";

const LOGIN_URL =
  process.env.BUZON_LOGIN_URL ??
  "https://e-menu.sunat.gob.pe/cl-ti-itmenu/MenuInternet.htm?exe=01.04.00.00.000000";

export interface RentasParams {
  ruc: string;
  solUser: string;
  solPass: string;
  emailDestino: string;   // reportes+RENTAS{ruc}@dominio
  ejercicio?: string;     // año; por defecto se deja el que trae SUNAT (2025)
  diagnostico?: boolean;
}
export interface RentasResultado {
  ok: boolean;
  loginError?: boolean;
  error?: string;
  diag?: { pasos: any[] };
}

// --- helpers (mismos del RTT / fraccionamiento, probados) --------------------
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
async function volcar(ctx: any): Promise<any> {
  const frames: any[] = [];
  for (const pg of ctx.pages()) for (const fr of pg.frames()) {
    const info = await fr.evaluate(() => {
      const norm = (s: any) => String(s || "").replace(/\s+/g, " ").trim();
      const inputs = (Array.from(document.querySelectorAll("input,select,textarea")) as HTMLElement[])
        .map((e) => ({ t: e.tagName.toLowerCase(), tipo: (e as HTMLInputElement).type || "", id: (e as any).id || "", name: (e as any).name || "", ph: e.getAttribute("placeholder") || "" })).slice(0, 40);
      const links = (Array.from(document.querySelectorAll("a,button")) as HTMLElement[]).map((e) => norm(e.textContent)).filter((t) => t && t.length < 60).slice(0, 60);
      return { titulo: norm(document.title), textoTop: norm((document.body?.innerText || "").slice(0, 250)), inputs, links };
    }).catch(() => null);
    if (info && (info.inputs?.length || info.links?.length)) frames.push({ url: fr.url().slice(0, 120), ...info });
  }
  return { frames };
}

/** ¿Este frame es el del reporte de rentas? (app itreporteec o texto propio). */
async function frameRentas(ctx: any): Promise<any> {
  for (const fr of todosLosFrames(ctx)) {
    if (/itrentasretenc|rentasretenc|itreporteec|reporteec/i.test(fr.url())) return fr;
    const txt = (await fr.evaluate(() => (document.body?.innerText || "").slice(0, 400)).catch(() => "")) as string;
    if (/RENTAS Y RETENCIONES|Generar Reporte|Seleccione ejercicio/i.test(txt)) return fr;
  }
  return null;
}

export async function generarReporteRentas(params: RentasParams): Promise<RentasResultado> {
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

    // 2) Ir DIRECTO al formulario por la URL de ejecución del menú (code
    //    descubierto por DevTools: 13.20.1.1.2 → carga consulta.htm con los
    //    parámetros de sesión). Respaldo: clic en la opción del menú.
    const APP_URL = "https://e-menu.sunat.gob.pe/cl-ti-itmenu/MenuInternet.htm?action=execute&code=13.20.1.1.2&s=ww1";
    await page.goto(APP_URL, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(2500).catch(() => {});
    await cerrarPantallas(ctx, page);
    let fr: any = await frameRentas(ctx);
    let opcion: string | null = null;
    if (!fr) {
      opcion = await clicMenu(ctx, [
        "Reporte Electrónico de Rentas y Retenciones",
        "Reporte Electronico de Rentas y Retenciones",
        "Rentas y Retenciones",
      ]);
    }
    // Esperar el formulario del reporte (aparece "RENTAS Y RETENCIONES"/"Generar").
    for (let i = 0; i < 15 && !fr; i++) {
      await page.waitForTimeout(1000).catch(() => {});
      await cerrarPantallas(ctx, page);
      fr = await frameRentas(ctx);
    }
    pasos.push({ paso: "menu", via: fr ? "url-directa-o-menu" : "no-form", onclick: opcion });

    // 3) Seleccionar el ejercicio (por defecto 2025) y escribir el correo.
    //    IDs reales del formulario (DevTools): #selUsuEjercicio y #txtUsuEmail.
    const ejercicio = params.ejercicio || "2025";
    let ejercicioOk = false;
    if (fr) {
      const sel = fr.locator("#selUsuEjercicio, select").first();
      if (await sel.count().catch(() => 0)) {
        for (const arg of [{ label: ejercicio }, { value: ejercicio }, ejercicio]) {
          try { await sel.selectOption(arg as any); ejercicioOk = true; break; } catch { /* */ }
        }
      }
    }
    let correoOk = false;
    if (fr) {
      for (const s of ['#txtUsuEmail', 'input[type="email"]', 'input[id*="correo" i]', 'input[name*="correo" i]', 'input[placeholder*="correo" i]', 'input[type="text"]']) {
        const el = fr.locator(s).first();
        if (await el.count().catch(() => 0)) {
          await el.fill(params.emailDestino).catch(() => {});
          const v = await el.inputValue().catch(() => "");
          if (v) { correoOk = true; break; }
        }
      }
    }
    pasos.push({ paso: "form", frameOk: !!fr, ejercicioOk, ejercicio, correoOk, emailDestino: params.emailDestino });

    const estructura = await volcar(ctx);
    pasos.push({ paso: "estructura", ...estructura });
    if (params.diagnostico) return { ok: false, diag: { pasos } };

    if (!fr) return { ok: false, error: "No se encontró el formulario del Reporte de Rentas en el menú. Usa Modo diagnóstico.", diag: { pasos } };
    if (!correoOk) return { ok: false, error: "Se llegó al formulario pero no se pudo escribir el correo. Usa Modo diagnóstico.", diag: { pasos } };

    // 4) Generar Reporte.
    let generado = false;
    for (const sel of ['#btnGenerar', 'button:has-text("Generar Reporte")', 'a:has-text("Generar Reporte")', 'input[value*="Generar" i]', 'button:has-text("Generar")', 'a:has-text("Generar")']) {
      const el = fr.locator(sel).first();
      if (await el.count().catch(() => 0)) { await el.click({ force: true, timeout: 4000 }).catch(() => {}); generado = true; break; }
    }
    if (!generado) generado = !!(await clickEnFrame(fr, ["Generar Reporte", "Generar"]));

    // 4b) CONFIRMAR: tras "Generar Reporte" SUNAT abre un modal ("se enviará el
    //     reporte a su correo") con botón Aceptar/Confirmar. Sin este clic el
    //     correo NUNCA se envía. Puede estar en cualquier frame o en el top.
    //     (Los confirm() nativos ya los acepta autoAceptarDialogos.)
    let modalTxt = "";
    let confirmado = false;
    for (let i = 0; i < 6 && !confirmado; i++) {
      await page.waitForTimeout(900).catch(() => {});
      for (const f of todosLosFrames(ctx)) {
        const t = (await f.evaluate(() => {
          const vis = (el: any) => { const r = el.getBoundingClientRect?.(); const s = getComputedStyle(el); return r && r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
          const dlg = Array.from(document.querySelectorAll('.modal, .ui-dialog, [role="dialog"], .swal2-popup, .modal-content')).find(vis as any) as HTMLElement | undefined;
          return dlg ? (dlg.innerText || "").replace(/\s+/g, " ").trim().slice(0, 200) : "";
        }).catch(() => "")) as string;
        if (t) modalTxt = t;
      }
      // Intentar confirmar en todos los frames.
      for (const f of todosLosFrames(ctx)) {
        const hit = await clickEnFrame(f, ["Aceptar", "Confirmar", "Sí", "Si", "Continuar", "Enviar"]);
        if (hit) { confirmado = true; break; }
      }
    }

    // Detectar el mensaje de éxito de SUNAT.
    let trasGen = "";
    for (let i = 0; i < 8; i++) {
      await page.waitForTimeout(1000).catch(() => {});
      for (const f of todosLosFrames(ctx)) {
        const t = (await f.evaluate(() => (document.body?.innerText || "").slice(0, 500)).catch(() => "")) as string;
        if (/se ha enviado|enviad|se enviar|correo electr[óo]nico|su solicitud|se generar|generado con|éxito|exito/i.test(t)) { trasGen = t; break; }
        if (t && !trasGen) trasGen = t;
      }
      if (/se ha enviado|enviad|se enviar|correo electr[óo]nico|su solicitud|se generar|generado con|éxito|exito/i.test(trasGen)) break;
    }
    const exito = /se ha enviado|enviad|se enviar|su solicitud|se generar|generado con|éxito|exito|correo electr[óo]nico/i.test(trasGen);
    pasos.push({ paso: "generar", clico: generado, modal: modalTxt, confirmado, exito, respuesta: trasGen.slice(0, 250) });

    // Si pulsamos el botón, damos la solicitud por buena aunque el texto no
    // confirme (el resultado real llega por correo al webhook).
    return { ok: generado, error: generado ? undefined : "No se pudo pulsar Generar Reporte.", diag: { pasos } };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "Error generando el reporte de rentas.", diag: { pasos } };
  } finally {
    clearTimeout(tope);
    if (browser) await browser.close().catch(() => {});
  }
}
