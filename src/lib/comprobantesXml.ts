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
import type { ItemRelacion } from "./relacionComprobantes";

const LOGIN_URL =
  "https://e-menu.sunat.gob.pe/cl-ti-itmenu/MenuInternet.htm?exe=01.04.00.00.000000";

export interface ComprobantesParams {
  ruc: string;
  solUser: string;
  solPass: string;
  periodo: string; // "YYYYMM"
  /** Relación específica a descargar (si viene, se bajan SOLO estos). */
  relacion?: ItemRelacion[];
  diagnostico?: boolean;
}

export interface ComprobantesResultado {
  facturas?: FacturaXml[];
  descargados?: number;
  /** Comprobantes de la relación que NO se pudieron bajar (para reintentar). */
  fallidos?: { item: ItemRelacion; motivo: string }[];
  loginError?: boolean;
  /** SUNAT respondió "Error del Servidor / reintentar en N minutos": su servicio
   *  de consulta está caído (no es la data). El frontend corta y avisa. */
  sunatCaido?: boolean;
  error?: string;
  diag?: { pasos: any[] };
}

// Aviso de SUNAT cuando su servicio de consulta está caído (no es la data).
const ES_SERVIDOR_CAIDO = /error del servidor|no se puede acceder a los servicios|reintentar en\s*\d*\s*minuto|servicio.*no.*disponible|no podemos atenderlo/i;

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
/** Clic por texto visible dentro de cualquier frame. Prefiere el enlace/anchor
 *  real (el menú SOL usa <a> con onclick; clicar solo el texto no navega). */
async function clicTexto(ctx: any, textos: string[]): Promise<boolean> {
  for (const pg of ctx.pages()) {
    for (const fr of pg.frames()) {
      for (const t of textos) {
        // 1) intenta un <a> que contenga el texto.
        const link = fr.locator(`a:has-text("${t}")`).first();
        if (await link.count().catch(() => 0)) {
          await link.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => {});
          await link.click({ timeout: 3000 }).catch(() => {});
          return true;
        }
        // 2) si no hay <a>, clic por texto (y sube al ancestro clickeable).
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

/** Clic NATIVO por texto (exact y luego parcial) en cualquier frame. Es el
 *  método que sí funciona en el menú SOL (mismo que usa el F36). */
async function clicNativo(ctx: any, textos: string[], timeout = 4000): Promise<string | null> {
  for (const pg of ctx.pages()) {
    for (const fr of pg.frames()) {
      for (const t of textos) {
        for (const exact of [true, false]) {
          try {
            const loc = fr.getByText(t, { exact }).first();
            if ((await loc.count()) > 0) {
              await loc.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => {});
              await loc.click({ timeout });
              return t;
            }
          } catch { /* siguiente */ }
        }
      }
    }
  }
  return null;
}
/** Reintenta el clic nativo hasta que aparezca la opción (menú que carga lento). */
async function clicNativoEspera(ctx: any, page: any, textos: string[], intentos = 6, esperaMs = 1500): Promise<string | null> {
  for (let i = 0; i < intentos; i++) {
    const hit = await clicNativo(ctx, textos);
    if (hit) return hit;
    await page.waitForTimeout(esperaMs).catch(() => {});
  }
  return null;
}

/** Lista TODOS los frames (url) de todas las páginas, para ver dónde cargó el
 *  formulario aunque el volcado detallado lo filtre. */
function listarFrames(ctx: any): string[] {
  const urls: string[] = [];
  for (const pg of ctx.pages()) {
    for (const fr of pg.frames()) urls.push(fr.url().slice(0, 140));
  }
  return Array.from(new Set(urls));
}
// Idéntico a fraccionamiento/RTT: engancha las páginas EXISTENTES y las futuras.
function autoAceptarDialogos(ctx: any) {
  const enganchar = (pg: any) => pg.on("dialog", (d: any) => d.accept().catch(() => {}));
  ctx.pages().forEach(enganchar);
  ctx.on("page", enganchar);
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
  // MISMA secuencia probada, pero REINTENTADA: el login de SOL a veces no pasa a
  // la primera (hipo/timing) aunque las credenciales estén bien. Se intenta 2
  // veces antes de dar por fallado (no toca la lógica de cada intento).
  let url = "";
  let loginError = true;
  for (let intento = 0; intento < 2 && loginError; intento++) {
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
    if (!navOk) await page.goto(LOGIN_URL, { waitUntil: "commit", timeout: 45000 }).catch(() => {});
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
    // Detección de login idéntica a fraccionamiento/buzón/RTT (probada).
    url = page.url();
    const texto = (await page.evaluate(() => (document.body?.innerText || "").slice(0, 300)).catch(() => "")) as string;
    loginError = /oauth2\/error|autenticamenuinternet|problema en la aplicaci|no podemos atenderlo/i.test(url + " " + texto);
    pasos.push({ paso: "login", url, loginError, intento: intento + 1 });
    if (loginError) await page.waitForTimeout(2500); // respiro antes de reintentar
  }
  return { browser, ctx, page, loginError };
}

/** Vuelca la estructura visible con DETALLE del formulario (ids/names, opciones
 *  de los select, radios con su etiqueta y botones) para calibrar el llenado. */
async function volcarEstructura(ctx: any): Promise<any> {
  const out: any = { frames: [] };
  for (const pg of ctx.pages()) {
    for (const fr of pg.frames()) {
      const info = await fr
        .evaluate(() => {
          const norm = (s: any) => String(s || "").replace(/\s+/g, " ").trim();
          const vis = (el: Element) => (el as HTMLElement).offsetParent !== null || el.tagName === "BODY";
          const inputs = (Array.from(document.querySelectorAll("input,select,textarea")) as HTMLElement[])
            .filter(vis)
            .map((e) => {
              const t = e.tagName.toLowerCase();
              const tipo = (e as HTMLInputElement).type || "";
              const base: any = {
                t, tipo,
                id: (e as any).id || "",
                name: (e as any).name || "",
                fc: e.getAttribute("formcontrolname") || "",
                ph: e.getAttribute("placeholder") || "",
                aria: e.getAttribute("aria-label") || "",
              };
              if (t === "select") base.opciones = Array.from((e as HTMLSelectElement).options).map((o) => norm(o.textContent)).slice(0, 20);
              if (tipo === "radio") { base.value = (e as HTMLInputElement).value; base.cerca = norm((e.parentElement?.textContent || "").slice(0, 40)); }
              return base;
            })
            .slice(0, 60);
          const botones = (Array.from(document.querySelectorAll("button,input[type=button],input[type=submit],a[onclick]")) as HTMLElement[])
            .filter(vis)
            .map((e) => norm(e.textContent) || norm((e as HTMLInputElement).value))
            .filter((t) => t && t.length < 40)
            .slice(0, 30);
          const conXml = (Array.from(document.querySelectorAll("a,[href],[onclick]")) as HTMLElement[])
            .map((e) => norm(e.getAttribute?.("href") || "") + " " + norm(e.getAttribute?.("onclick") || "") + " " + norm(e.textContent))
            .filter((s) => /xml|descarg|archivo|\.zip|cdr/i.test(s))
            .slice(0, 30);
          return { titulo: norm(document.title), textoTop: norm((document.body?.innerText || "").slice(0, 200)), inputs, botones, conXml };
        })
        .catch(() => null);
      if (info && (info.inputs?.length || info.botones?.length)) {
        out.frames.push({ url: fr.url().slice(0, 120), ...info });
      }
    }
  }
  return out;
}

/** Frame del formulario Angular de consulta de comprobantes. */
function frameForm(ctx: any): any {
  const pgs = ctx.pages();
  for (const pg of pgs) {
    for (const fr of pg.frames()) if (/nuevaconsulta|consultacpe/i.test(fr.url())) return fr;
  }
  return pgs[0]?.mainFrame() ?? null;
}

const APP_URL_CONSULTA = "https://e-menu.sunat.gob.pe/cl-ti-itmenu/MenuInternet.htm?action=execute&code=11.38.1.1.1&s=ww1";

/** Navega al formulario limpio y espera a que cargue (RUC Emisor visible). */
async function abrirFormulario(page: any, ctx: any): Promise<any> {
  await page.goto(APP_URL_CONSULTA, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(1200).catch(() => {});
    const fr = frameForm(ctx);
    if (fr) {
      const listo = await fr.getByText(/RUC\s*Emisor|Filtro de comprobante/i).first().count().catch(() => 0);
      if (listo) return fr;
    }
  }
  return frameForm(ctx);
}

// Código de tipo → texto del dropdown "Tipo de comprobante".
const TIPO_LABEL: Record<string, string> = {
  "01": "Factura",
  "03": "Boleta",
  "07": "Factura - Nota de Crédito",
  "08": "Factura - Nota de Débito",
  "14": "Recibo de Servicios Públicos",
};
// Palabra clave distintiva por tipo (para elegir la opción aunque el texto
// exacto del dropdown varíe un poco). AJUSTABLE con las opciones del diagnóstico.
const TIPO_KEYS: Record<string, string> = {
  "01": "factura",
  "03": "boleta",
  "07": "crédito",
  "08": "débito",
  "14": "recibo",
};

/** Llena el formulario (Recibido + RUC + tipo + serie/número) y da "Consultar". */
async function llenarYConsultar(fr: any, page: any, item: ItemRelacion): Promise<any> {
  const hecho: any = {};
  try {
    // 1) Cambiar a "Recibido" DE VERDAD. En "Emitido" (default) el RUC Emisor
    //    está fijo al RUC del cliente y es read-only → si no cambiamos el modo,
    //    el fill del proveedor se pierde y SUNAT busca un comprobante del cliente
    //    a sí mismo (error). check() solo no basta si el radio está estilizado;
    //    forzamos y, de respaldo, clic real en la etiqueta "Recibido".
    const recibido = fr.locator("#recibido").first();
    await recibido.check({ force: true }).catch(() => {});
    if (!(await recibido.isChecked().catch(() => false))) {
      await fr.getByText("Recibido", { exact: true }).first().click({ timeout: 3000 }).catch(() => {});
    }
    // Angular re-renderiza al cambiar de modo (limpia/habilita el RUC Emisor).
    await page.waitForTimeout(1500).catch(() => {});
    hecho.recibido = await recibido.isChecked().catch(() => false);
    // 2) RUC Emisor: comprobar que ya es editable, limpiar el prellenado, escribir
    //    el del proveedor y hacer blur (Tab) para disparar la validación async.
    const rucInput = fr.locator('[formcontrolname="rucEmisor"]').first();
    hecho.rucEstado = await rucInput.evaluate((el: any) => ({ ro: !!el.readOnly, dis: !!el.disabled })).catch(() => ({}));
    await rucInput.click({ timeout: 3000 }).catch(() => {});
    await rucInput.fill("").catch(() => {});
    await rucInput.fill(item.rucEmisor).catch(() => {});
    await rucInput.press("Tab").catch(() => {});
    // SUNAT valida el RUC de forma asíncrona (resuelve la razón social). Si
    // consultamos antes de que termine, devuelve "no encontrado" aunque el
    // comprobante exista. Esperamos a que aparezca la razón social del proveedor
    // (o hasta 5 s) antes de seguir.
    for (let w = 0; w < 5; w++) {
      await page.waitForTimeout(700).catch(() => {});
      const resuelto = await fr
        .getByText(/RUC\s*Emisor[^]{0,80}[A-Za-zÁÉÍÓÚÑ]{3,}/i)
        .first().count().catch(() => 0);
      if (resuelto) break;
    }
    hecho.rucEmisorPedido = item.rucEmisor;
    hecho.rucEmisorVal = await rucInput.inputValue().catch(() => "");
    // 3) Tipo de comprobante. Es un <select> NATIVO ("Factura/Boleta/…"): lo más
    //    fiable es selectOption sobre el propio <select>. Si no fuera nativo, se
    //    usa el respaldo del dropdown "Seleccionar" + clic en la opción.
    const label = TIPO_LABEL[item.tipo] ?? "Factura";
    const keyw = TIPO_KEYS[item.tipo] ?? "factura";
    let tipoOk = false;
    // Buscar el <select> del tipo CON ESPERA: tras "Limpiar" se re-renderiza y a
    // veces no está listo al primer intento (por eso fallaba del 2º en adelante).
    let se: any = null;
    let opciones: string[] = [];
    for (let w = 0; w < 10 && !se; w++) {
      const selects = fr.locator("select");
      const nSel = await selects.count().catch(() => 0);
      for (let k = 0; k < nSel; k++) {
        const cand = selects.nth(k);
        const ops = await cand.locator("option").allInnerTexts().catch(() => []) as string[];
        if (ops.some((o) => /factura|boleta|cr[eé]dito|d[eé]bito|recibo/i.test(o))) { se = cand; opciones = ops; break; }
      }
      if (!se) await page.waitForTimeout(400).catch(() => {});
    }
    if (se) {
      hecho.tipoOpciones = opciones.map((o) => o.trim()).filter(Boolean).slice(0, 25);
      const objetivo = opciones.find((o) => o.trim().toLowerCase() === label.toLowerCase())
        || opciones.find((o) => new RegExp(keyw, "i").test(o));
      if (objetivo) {
        await se.selectOption({ label: objetivo }).catch(async () => {
          await se.selectOption({ index: opciones.indexOf(objetivo) }).catch(() => {});
        });
        await se.evaluate((el: any) => el.dispatchEvent(new Event("change", { bubbles: true }))).catch(() => {});
        hecho.tipoSelectNativo = true;
        hecho.tipoVal = await se.evaluate((el: any) => el.options[el.selectedIndex]?.text || "").catch(() => "");
        tipoOk = true;
      }
    }
    if (!tipoOk) {
      // Respaldo: dropdown custom "Seleccionar" + clic en la opción.
      await fr.getByText("Seleccionar", { exact: false }).first().click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(900).catch(() => {});
      hecho.tipoOpciones = await fr
        .locator('mat-option, [role="option"], li, .dropdown-item, .mat-option')
        .allInnerTexts().then((a: string[]) => a.map((t) => t.trim()).filter(Boolean).slice(0, 25)).catch(() => []);
      const opt = fr.getByText(label, { exact: true });
      if (await opt.count().catch(() => 0)) await opt.first().click({ timeout: 3000 }).catch(() => {});
      else {
        const porClave = fr.getByText(new RegExp(keyw, "i")).last();
        if (await porClave.count().catch(() => 0)) await porClave.click({ timeout: 2500 }).catch(() => {});
        else await fr.getByText(label, { exact: false }).first().click({ timeout: 2000 }).catch(() => {});
      }
    }
    hecho.tipo = label;
    // CONFIRMAR que el tipo QUEDÓ seleccionado (el control muestra su etiqueta en
    // aria-label). Evita la carrera: si "Consultar" dispara antes del commit del
    // form Angular, SUNAT recibe una consulta mal formada → "Error del Servidor".
    let tipoConfirmado = false;
    for (let w = 0; w < 8 && !tipoConfirmado; w++) {
      await page.waitForTimeout(400).catch(() => {});
      tipoConfirmado = (await fr.locator(`input[aria-label*="${label}" i]`).count().catch(() => 0)) > 0;
    }
    hecho.tipoConfirmado = tipoConfirmado;
    // 4) Serie y Número.
    const serieInput = fr.locator('[formcontrolname="serieComprobante"]').first();
    const numeroInput = fr.locator('[formcontrolname="numeroComprobante"]').first();
    await serieInput.fill(item.serie).catch(() => {});
    await numeroInput.fill(item.numero).catch(() => {});
    hecho.serieVal = await serieInput.inputValue().catch(() => "");
    hecho.numeroVal = await numeroInput.inputValue().catch(() => "");
    // Pausa para que el formulario termine de validar antes de consultar.
    await page.waitForTimeout(800).catch(() => {});
    // 5) Consultar.
    await fr.getByText("Consultar", { exact: false }).first().click({ timeout: 4000 }).catch(() => {});
    hecho.consultado = true;
  } catch (e: any) {
    hecho.error = String(e?.message ?? e).slice(0, 150);
  }
  return hecho;
}

/** En el modal "Resultado", hace clic en el icono "Descargar XML" y captura el
 *  archivo (por evento download o por pestaña nueva). `diagOut` recibe el
 *  volcado de iconos del modal para calibrar el selector. */
async function descargarXmlResultado(fr: any, page: any, diagOut?: any): Promise<Buffer | null> {
  const { promises: fs } = await import("fs");
  // Esperar a que el modal de resultado termine de renderizar los iconos.
  await page.waitForTimeout(1400).catch(() => {});

  // Volcado de iconos/botones clicables del modal (para ver el icono XML real).
  if (diagOut) {
    diagOut.iconos = await fr.evaluate(() => {
      const vis = (el: Element) => (el as HTMLElement).offsetParent !== null;
      const els = Array.from(document.querySelectorAll("button, a, i, img, mat-icon, span[mattooltip], [mattooltip], [title], [aria-label], [ng-reflect-message]")) as HTMLElement[];
      return els.filter(vis).map((e) => ({
        tag: e.tagName.toLowerCase(),
        tip: e.getAttribute("mattooltip") || e.getAttribute("ng-reflect-message") || e.getAttribute("title") || e.getAttribute("aria-label") || "",
        cls: (e.getAttribute("class") || "").slice(0, 45),
        txt: (e.textContent || "").trim().slice(0, 18),
        src: (e.getAttribute("src") || "").slice(-28),
      })).filter((x) => x.tip || /xml|pdf|descarg|download|fa-file|fa-code|excel/i.test(x.cls + " " + x.txt + " " + x.src)).slice(0, 30);
    }).catch(() => []);
  }

  // Candidatos del icono "Descargar XML". En SUNAT ConsultaCpe los iconos son
  // font-awesome: el XML es fa-file-code (el PDF es fa-file-pdf). Se apunta al
  // XML explícitamente para NO bajar el PDF por error.
  const candidatos = [
    'i[class*="fa-file-code"]', '[class*="fa-file-code"]',
    'i[class*="fa-file-excel"]', '[class*="fa-file-excel"]',
    'i[class*="fa-code"]',
    '[mattooltip*="XML" i]', '[ng-reflect-message*="XML" i]', '[title*="XML" i]', '[aria-label*="XML" i]',
    'button:has-text("XML")', 'a:has-text("XML")', 'img[src*="xml" i]', '[class*="xml" i]',
  ];
  const clicar = async () => {
    for (const sel of candidatos) {
      const el = fr.locator(sel).first();
      if (await el.count().catch(() => 0)) { await el.click({ timeout: 4000 }).catch(() => {}); return true; }
    }
    // Respaldo: ícono de archivo que NO sea el PDF (el XML es el otro fa-file-*).
    const noPdf = fr.locator('i[class*="fa-file"]:not([class*="fa-file-pdf"]):not([class*="pdf"]), [class*="fa-file"]:not([class*="pdf"])');
    if (await noPdf.count().catch(() => 0)) { await noPdf.first().click({ timeout: 3000 }).catch(() => {}); return true; }
    return false;
  };

  // El XML puede llegar como descarga (evento) o abrirse en una pestaña nueva.
  const waitDl = page.waitForEvent("download", { timeout: 16000 }).then((d: any) => ({ download: d })).catch(() => null);
  const waitPop = page.context().waitForEvent("page", { timeout: 16000 }).then((p: any) => ({ popup: p })).catch(() => null);
  await clicar();
  const res: any = await Promise.race([waitDl, waitPop]);

  if (res?.download) {
    try { const p = await res.download.path(); if (p) return await fs.readFile(p); } catch { /* */ }
  }
  if (res?.popup) {
    try {
      await res.popup.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => {});
      const contenido = await res.popup.content().catch(() => "");
      await res.popup.close().catch(() => {});
      const m = contenido.match(/<\?xml[\s\S]*<\/[A-Za-z:]+>\s*$/i) || contenido.match(/<(Invoice|CreditNote|DebitNote)[\s\S]*<\/\1>/i);
      if (m) return Buffer.from(m[0], "utf-8");
    } catch { /* */ }
  }
  return null;
}

/** En el modal "Resultado", clic en el icono PDF (rojo) y captura el PDF OFICIAL
 *  de SUNAT (por evento download o por pestaña nueva del visor PDF). */
async function descargarPdfResultado(fr: any, page: any): Promise<Buffer | null> {
  const { promises: fs } = await import("fs");
  // El PDF es fa-file-pdf (confirmado en el diagnóstico).
  const candidatos = [
    'i[class*="fa-file-pdf"]', '[class*="fa-file-pdf"]',
    '[mattooltip*="PDF" i]', '[ng-reflect-message*="PDF" i]', '[title*="PDF" i]',
    '[aria-label*="PDF" i]', 'a:has-text("PDF")', 'img[src*="pdf" i]', '[class*="pdf" i]',
  ];
  const waitDl = page.waitForEvent("download", { timeout: 16000 }).then((d: any) => ({ download: d })).catch(() => null);
  const waitPop = page.context().waitForEvent("page", { timeout: 16000 }).then((p: any) => ({ popup: p })).catch(() => null);
  for (const sel of candidatos) {
    const el = fr.locator(sel).first();
    if (await el.count().catch(() => 0)) { await el.click({ timeout: 4000 }).catch(() => {}); break; }
  }
  const res: any = await Promise.race([waitDl, waitPop]);
  if (res?.download) {
    try { const p = await res.download.path(); if (p) return await fs.readFile(p); } catch { /* */ }
  }
  if (res?.popup) {
    // Visor PDF en pestaña nueva: bajar los bytes de su URL (con cookies).
    try {
      await res.popup.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => {});
      const u = res.popup.url();
      if (/^https?:/.test(u)) {
        const b64 = (await res.popup.evaluate(async (url: string) => {
          try {
            const r = await fetch(url, { credentials: "include" });
            const b = await r.arrayBuffer(); const by = new Uint8Array(b);
            let s = ""; for (let i = 0; i < by.length; i++) s += String.fromCharCode(by[i]);
            return btoa(s);
          } catch { return ""; }
        }, u).catch(() => "")) as string;
        await res.popup.close().catch(() => {});
        if (b64) return Buffer.from(b64, "base64");
      } else {
        await res.popup.close().catch(() => {});
      }
    } catch { /* */ }
  }
  return null;
}

/** Tras "Consultar", espera a que aparezca el modal "Resultado" (factura) o un
 *  aviso de error ("Aceptar"). Devuelve cuál apareció. */
async function esperarResultado(fr: any, page: any): Promise<{ estado: "resultado" | "error" | "nada"; aviso: string }> {
  for (let i = 0; i < 9; i++) {
    await page.waitForTimeout(1500).catch(() => {});
    // ERROR primero: el aviso de "no encontrado" trae botón "Aceptar" (y el
    // modal de factura NO lo tiene). Así no confundimos el título "Resultado".
    if (await fr.getByText("Aceptar", { exact: true }).first().count().catch(() => 0)) {
      // Captura el TEXTO del aviso de SUNAT (para distinguir "no existe" de
      // "Error del Servidor / reintentar en N minutos").
      const aviso = (await fr.evaluate(() => {
        const vis = (el: Element) => (el as HTMLElement).offsetParent !== null;
        const cont = Array.from(document.querySelectorAll(
          '.modal, .modal-content, .mat-dialog-container, mat-dialog-container, .swal2-popup, .p-dialog, [role="dialog"], .mat-snack-bar-container, .toast, .alert'
        )) as HTMLElement[];
        const t = cont.filter(vis).map((n) => (n.innerText || "").replace(/\s+/g, " ").trim()).find((s) => s.length > 0);
        return (t || "").slice(0, 400);
      }).catch(() => "")) as string;
      return { estado: "error", aviso };
    }
    // RESULTADO real: aparece el contenido de la factura o el icono de descarga.
    const facturaReal = await fr
      .getByText(/Importe Total|FACTURA ELECTR|Descargar XML/i)
      .first().count().catch(() => 0);
    if (facturaReal) return { estado: "resultado", aviso: "" };
  }
  return { estado: "nada", aviso: "" };
}

/** Cierra el modal "Resultado" (× arriba a la derecha) para pasar al siguiente. */
async function cerrarModal(fr: any): Promise<void> {
  for (const sel of ['.modal .close', '[aria-label="Close"]', '[aria-label="Cerrar"]', '.modal-header button']) {
    const el = fr.locator(sel).first();
    if (await el.count().catch(() => 0)) { await el.click({ timeout: 2000 }).catch(() => {}); return; }
  }
  await fr.getByText("×", { exact: false }).first().click({ timeout: 2000 }).catch(() => {});
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

    // URL DIRECTA del formulario (descubierta por inspección): la opción del
    // menú "Nueva Consulta de comprobantes de pago" es code=11.38.1.1.1 y carga
    // una app Angular. Vamos directo, sin navegar el árbol del menú.
    const APP_URL = "https://e-menu.sunat.gob.pe/cl-ti-itmenu/MenuInternet.htm?action=execute&code=11.38.1.1.1&s=ww1";
    try {
      await s.page.goto(APP_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
      pasos.push({ paso: "goto-app", url: APP_URL });
    } catch (e: any) {
      pasos.push({ paso: "goto-app", error: String(e?.message ?? e).slice(0, 120) });
    }
    // Esperar a que cargue el formulario Angular (aparece "RUC Emisor").
    let formOk = false;
    for (let i = 0; i < 12 && !formOk; i++) {
      await s.page.waitForTimeout(1500).catch(() => {});
      formOk = await Promise.all(
        s.ctx.pages().flatMap((pg: any) =>
          pg.frames().map((fr: any) =>
            fr.getByText(/RUC\s*Emisor|Filtro de comprobante|Recibido/i).first().count().catch(() => 0)
          )
        )
      ).then((cs) => cs.some((c) => c > 0)).catch(() => false);
    }
    // Respaldo: si el goto directo no cargó el form, navegar el árbol del menú.
    if (!formOk) {
      pasos.push({ paso: "goto-app", nota: "no cargó por URL directa, uso el árbol del menú" });
      await s.page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
      await s.page.waitForTimeout(2000).catch(() => {});
      const ruta = [
        ["Comprobantes de pago", "Comprobantes de Pago"],
        ["Comprobantes de Pago"],
        ["Consulta de Comprobantes de Pago"],
        ["Nueva Consulta de comprobantes de pago"],
      ];
      for (const opciones of ruta) {
        const hit = await clicNativoEspera(s.ctx, s.page, opciones, 5, 1500);
        pasos.push({ paso: "menu", buscaba: opciones[0], clico: hit });
        await s.page.waitForTimeout(2000).catch(() => {});
      }
    }

    // Volcado del formulario (antes de llenar).
    const estructura = await volcarEstructura(s.ctx);
    pasos.push({ paso: "estructura", relacionRecibida: params.relacion?.length ?? 0, framesTodos: listarFrames(s.ctx), ...estructura });

    const relacionTotal = params.relacion ?? [];
    if (!relacionTotal.length) {
      return { facturas: [], descargados: 0, error: "Sube una relación de comprobantes (con la plantilla) para descargar.", diag: { pasos } };
    }
    // Tope de seguridad por request: cada comprobante toma ~5-8 s; con el límite
    // de 220 s del navegador entran ~25. El frontend YA parte la relación en
    // bloques chicos (~12) y llama varias veces, así que este tope casi nunca se
    // alcanza; es solo un cinturón de seguridad para no exceder el tiempo.
    const MAX_POR_TANDA = 25;
    const relacion = relacionTotal.slice(0, MAX_POR_TANDA);
    const sobrantes = relacionTotal.length - relacion.length;

    // BUCLE: por cada comprobante → navegar al formulario LIMPIO, llenar,
    // consultar, descargar el XML del modal "Resultado" y parsearlo (ZIP/XML).
    const { esZip, extraerDeZip, extraerTodo } = await import("./zip");
    const facturas: FacturaXml[] = [];
    const errores: any[] = [];
    const fallidos: { item: ItemRelacion; motivo: string }[] = [];
    const marcarFallo = (item: ItemRelacion, motivo: string, llenado?: any) => {
      errores.push({ item: `${item.serie}-${item.numero}`, motivo, ...(llenado ? { llenado } : {}) });
      fallidos.push({ item, motivo });
    };
    // El formulario ya está abierto (goto-app arriba). Entre comprobantes se usa
    // "Limpiar" para resetearlo, SIN re-navegar (re-navegar cerraba el navegador).
    // La Consulta individual solo soporta CPE (factura/boleta/notas/recibo).
    // Tipos como 50/52/54 (DUA/DAM de importación) no se pueden bajar aquí.
    const TIPOS_SOPORTADOS = new Set(["01", "03", "07", "08", "14"]);
    let sunatCaido: string | null = null;
    let serverSeguidos = 0;          // "Error del Servidor" consecutivos
    const UMBRAL_CAIDO = 4;          // ese nº seguido = SUNAT realmente caído
    for (let i = 0; i < relacion.length; i++) {
      const item = relacion[i];
      try {
        if (!TIPOS_SOPORTADOS.has(item.tipo)) {
          marcarFallo(item, `Tipo ${item.tipo} (importación/aduana u otro) no se descarga en la Consulta individual de SUNAT.`);
          continue;
        }
        const fr = frameForm(s.ctx);
        if (!fr) {
          // Navegador caído: este y TODOS los que faltan quedan como fallidos
          // (se podrán reintentar desde el frontend).
          for (let j = i; j < relacion.length; j++) marcarFallo(relacion[j], "el navegador se cerró (reintentar)");
          break;
        }
        // Hasta 2 intentos por comprobante: un "no encontrado" o un "Error del
        // Servidor" suele ser transitorio (SUNAT sí responde al reintentar).
        let estado: "resultado" | "error" | "nada" = "nada";
        let llenado: any = null;
        let ultimoAviso = "";
        for (let intento = 0; intento < 2; intento++) {
          if (i > 0 || intento > 0) {
            // Reset del formulario (para el siguiente comprobante o el reintento).
            await fr.getByText("Limpiar", { exact: false }).first().click({ timeout: 3000 }).catch(() => {});
            await s.page.waitForTimeout(1200).catch(() => {});
          }
          llenado = await llenarYConsultar(fr, s.page, item);
          const r = await esperarResultado(fr, s.page);
          estado = r.estado;
          if (r.aviso) ultimoAviso = r.aviso;
          if (params.diagnostico && r.aviso && llenado) llenado.aviso = r.aviso;
          if (estado === "resultado") break;
          // Cierra el aviso ("Aceptar"); si fue "Error del Servidor" espera algo
          // más antes de reintentar (suele resolverse en el 2º intento).
          await fr.getByText("Aceptar", { exact: false }).first().click({ timeout: 2000 }).catch(() => {});
          await s.page.waitForTimeout(ES_SERVIDOR_CAIDO.test(r.aviso || "") ? 3000 : 1200).catch(() => {});
        }

        if (estado !== "resultado") {
          if (ES_SERVIDOR_CAIDO.test(ultimoAviso)) {
            serverSeguidos++;
            marcarFallo(item, "SUNAT respondió “Error del Servidor” para este comprobante (reintenta en unos minutos).", llenado);
            // Solo si es PERSISTENTE (varios seguidos) se declara caído y se corta.
            if (serverSeguidos >= UMBRAL_CAIDO) {
              const msg = "SUNAT no está disponible: respondió “Error del Servidor” varias veces seguidas. Reintenta en unos minutos.";
              for (let j = i + 1; j < relacion.length; j++) marcarFallo(relacion[j], msg);
              sunatCaido = msg;
              break;
            }
          } else {
            serverSeguidos = 0;
            marcarFallo(
              item,
              estado === "error"
                ? "SUNAT no devolvió el comprobante (revisa RUC emisor, tipo, serie y número, o el comprobante no existe)."
                : "no apareció el resultado (tiempo agotado).",
              llenado,
            );
          }
          continue;
        }
        serverSeguidos = 0; // hubo resultado → SUNAT está respondiendo

        const dxml: any = {};
        const buf = await descargarXmlResultado(fr, s.page, params.diagnostico ? dxml : undefined);
        if (!buf) {
          marcarFallo(item, "salió la factura pero no se pudo bajar el XML (revisar icono de descarga).", { ...llenado, iconosModal: dxml.iconos });
        } else {
          // El botón XML de SUNAT baja un ZIP con los documentos: se descomprime
          // y se leen TODOS (cualquier extensión, y ZIPs anidados). Cada uno se
          // intenta parsear como comprobante; nos quedamos con el/los que lo sean.
          const xmls: string[] = [];
          const recolectar = (b: Buffer, depth: number) => {
            if (!esZip(b)) { xmls.push(b.toString("utf-8")); return; }
            for (const it of extraerTodo(b)) {
              if (depth < 3 && (it.name.toLowerCase().endsWith(".zip") || esZip(it.data))) recolectar(it.data, depth + 1);
              else xmls.push(it.data.toString("utf-8"));
            }
          };
          recolectar(buf, 0);
          const nuevas: FacturaXml[] = [];
          for (const x of xmls) {
            const fx = parseFacturaXml(x);
            if (fx && fx.rucEmisor) { facturas.push(fx); nuevas.push(fx); }
          }
          if (!nuevas.length) {
            // Diagnóstico: ¿qué se descargó realmente? (firma/tipo/muestra).
            const firma = buf.slice(0, 8).toString("latin1");
            const cabeza = buf.slice(0, 400).toString("utf-8");
            const tipoArch = esZip(buf) ? "zip"
              : firma.startsWith("%PDF") ? "pdf"
              : /<\?xml|<Invoice|<CreditNote|<DebitNote|<ApplicationResponse/i.test(cabeza) ? "xml(otro-root)"
              : /<!doctype|<html/i.test(cabeza) ? "html" : "otro";
            const nombresZip = esZip(buf) ? extraerDeZip(buf, [".xml", ".pdf", ".txt", ".zip", ".cdr", ".html"]).map((z) => z.name).slice(0, 8) : [];
            marcarFallo(item, "el archivo descargado no era un XML de comprobante", {
              ...llenado,
              arch: { tipoArch, len: buf.length, firma: firma.replace(/[^\x20-\x7e]/g, "."), muestra: cabeza.replace(/\s+/g, " ").slice(0, 220), nombresZip },
              iconosModal: dxml.iconos,
            });
          } else {
            // PDF OFICIAL de SUNAT (ícono rojo del modal): se adjunta a la factura.
            const pdfBuf = await descargarPdfResultado(fr, s.page).catch(() => null);
            if (pdfBuf && pdfBuf.slice(0, 4).toString("latin1") === "%PDF") {
              const b64 = pdfBuf.toString("base64");
              for (const f of nuevas) f.pdfBase64 = b64;
            }
          }
        }
        await cerrarModal(fr);
        await s.page.waitForTimeout(1200).catch(() => {});
      } catch (e: any) {
        marcarFallo(item, String(e?.message ?? e).slice(0, 120));
      }
    }
    pasos.push({ paso: "descargas", pedidos: relacion.length, ok: facturas.length, errores });

    // En modo diagnóstico, además vuelca la estructura del resultado (por si hay
    // que calibrar el icono de descarga).
    if (params.diagnostico) {
      const resultado = await volcarEstructura(s.ctx);
      pasos.push({ paso: "resultado", framesTodos: listarFrames(s.ctx), ...resultado });
    }

    const notaSobrantes = sobrantes > 0
      ? ` (Se procesaron ${relacion.length} de ${relacionTotal.length}; sube el resto en otra tanda.)`
      : "";
    return {
      facturas,
      descargados: facturas.length,
      fallidos,
      sunatCaido: !!sunatCaido,
      error: sunatCaido
        ? sunatCaido
        : facturas.length
        ? (sobrantes > 0 ? `Descargados ${facturas.length}.${notaSobrantes}` : undefined)
        : `No se descargó ningún XML (de ${relacion.length}). Revisa el diagnóstico. ${errores.slice(0, 2).map((e) => e.motivo).join(" · ")}`,
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
