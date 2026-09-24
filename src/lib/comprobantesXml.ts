// ============================================================
//  Descarga de XML de comprobantes RECIBIDOS (compras) desde SUNAT SOL
// ============================================================
// Módulo NUEVO e independiente. Hace login SOL (scraping, como el buzón/F36),
// va a "Consulta de comprobantes" (SEE-SOL), y descarga los XML de un periodo.
// Como la navegación exacta de esa pantalla se calibra con Modo diagnóstico,
// la extracción devuelve SIEMPRE un volcado (pasos) para afinar sin adivinar.
// Los XML descargados se leen con facturaXml.ts y se arman en un Excel.

import { lanzarNavegador, bloquearRecursos } from "./navegador";
import { abrirSesionSunat } from "./sunatSesion";
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

/** Cierra anuncios/avisos flotantes de SUNAT (novedades, encuestas, etc.)
 *  pulsando "Ver más tarde"/"Ahora no"/"Omitir". Textos específicos para NO
 *  tocar los botones del formulario (Consultar/Limpiar/Aceptar). */
async function cerrarAnuncios(ctx: any): Promise<boolean> {
  return await clicTexto(ctx, [
    "Ver más tarde", "Ver mas tarde", "Recordar más tarde", "Recordarme más tarde",
    "Más tarde", "Mas tarde", "Ahora no", "En otro momento", "Omitir",
    "No, gracias", "Cerrar aviso", "Saltar",
  ]);
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

// --- login SOL: sesión compartida con caché de cookies ----------------------
// Antes cada factura abría su propio navegador y se logueaba → extraer 40
// facturas = 40 logins (riesgo de bloqueo). Ahora delega en la sesión
// compartida: la 1ª factura inicia sesión y las siguientes REUTILIZAN las
// cookies (dentro de la ventana de la caché) → 1 solo login para el lote.
async function loginSol(params: ComprobantesParams, pasos: any[]) {
  const s = await abrirSesionSunat({ ruc: params.ruc, solUser: params.solUser, solPass: params.solPass }, pasos);
  // Cerrar anuncio flotante de novedades si aparece ("Ver más tarde"…).
  await cerrarAnuncios(s.ctx).catch(() => {});
  return s;
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
  const matches: any[] = [];
  for (const pg of pgs) {
    for (const fr of pg.frames()) if (/nuevaconsulta|consultacpe/i.test(fr.url())) matches.push(fr);
  }
  // Preferir el frame del APP (no el "loader" del menú, que aún no tiene el form).
  return matches.find((f) => !/loader/i.test(f.url()))
    || matches[0]
    || pgs[0]?.mainFrame() || null;
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
    // 2) RUC Emisor PRIMERO: en "Recibido" ya es editable. Se limpia el
    //    prellenado, se escribe el del proveedor y Tab para la validación async.
    //    Va ANTES del tipo: solo con el RUC ya activo el <select> del tipo se
    //    puebla bien (si se elige el tipo antes, sale vacío → "Error del Servidor").
    const rucInput = fr.locator('[formcontrolname="rucEmisor"]').first();
    hecho.rucEstado = await rucInput.evaluate((el: any) => ({ ro: !!el.readOnly, dis: !!el.disabled })).catch(() => ({}));
    await rucInput.click({ timeout: 3000 }).catch(() => {});
    await rucInput.fill("").catch(() => {});
    await rucInput.fill(item.rucEmisor).catch(() => {});
    await rucInput.press("Tab").catch(() => {});
    // SUNAT valida el RUC de forma asíncrona (resuelve la razón social). Si
    // consultamos antes de que termine, devuelve "no encontrado" aunque el
    // comprobante exista. Esperamos a que aparezca la razón social (o hasta 5 s).
    for (let w = 0; w < 5; w++) {
      await page.waitForTimeout(700).catch(() => {});
      const resuelto = await fr
        .getByText(/RUC\s*Emisor[^]{0,80}[A-Za-zÁÉÍÓÚÑ]{3,}/i)
        .first().count().catch(() => 0);
      if (resuelto) break;
    }
    hecho.rucEmisorPedido = item.rucEmisor;
    hecho.rucEmisorVal = await rucInput.inputValue().catch(() => "");
    // 3) TIPO de comprobante: es un DESPLEGABLE CON BUSCADOR (no un <select>
    //    simple). Como a mano: se ABRE el desplegable y se CLICA "Factura" en la
    //    lista. (selectOption sobre el <select> oculto NO sincroniza el widget →
    //    SUNAT recibe el tipo vacío → "Error del Servidor".)
    const label = TIPO_LABEL[item.tipo] ?? "Factura";
    const keyw = TIPO_KEYS[item.tipo] ?? "factura";
    let tipoOk = false;
    // ¿Está abierto el panel de opciones? (aparecen otras opciones de la lista).
    const panelListo = async () =>
      (await fr.getByText(/Boleta de Venta|Comprobante de Percepci|Recibo por Honorarios|Liquidaci[oó]n de compra/i).first().count().catch(() => 0)) > 0;
    // 3a) Abrir el desplegable (clic en el control que muestra "Seleccionar").
    for (let intento = 0; intento < 4 && !(await panelListo()); intento++) {
      const trig = fr.getByText("Seleccionar", { exact: true }).first();
      if (await trig.count().catch(() => 0)) await trig.click({ timeout: 3000 }).catch(() => {});
      else {
        const combo = fr.locator('[role="combobox"], .p-dropdown, .ng-select, ng-select, select').first();
        if (await combo.count().catch(() => 0)) await combo.click({ force: true, timeout: 3000 }).catch(() => {});
      }
      await page.waitForTimeout(700).catch(() => {});
    }
    // 3b) Volcado de opciones visibles (diagnóstico).
    hecho.tipoOpciones = await fr
      .locator('[role="option"], .p-dropdown-item, .ng-option, li, .dropdown-item')
      .allInnerTexts().then((a: string[]) => a.map((t) => t.trim()).filter(Boolean).filter((t) => t.length < 50).slice(0, 30)).catch(() => []);
    // 3c) Si hay buscador dentro del panel, filtrar por "Factura".
    const buscador = fr.locator('.p-dropdown-filter, input.p-dropdown-filter, .ng-input > input, input[type="search"], input[aria-label*="Search" i], input[aria-label*="Buscar" i]').first();
    if (await buscador.count().catch(() => 0)) {
      await buscador.fill(label).catch(() => {});
      await page.waitForTimeout(700).catch(() => {});
    }
    // 3d) Clic en la opción EXACTA "Factura" (no "Factura - Nota de Crédito").
    const opcionExacta = fr.getByRole("option", { name: new RegExp(`^\\s*${label}\\s*$`, "i") }).first();
    if (await opcionExacta.count().catch(() => 0)) { await opcionExacta.click({ timeout: 3000 }).catch(() => {}); tipoOk = true; }
    else {
      const porTexto = fr.getByText(label, { exact: true }).first();
      if (await porTexto.count().catch(() => 0)) { await porTexto.click({ timeout: 3000 }).catch(() => {}); tipoOk = true; }
    }
    hecho.tipo = label;
    hecho.tipoOk = tipoOk;
    // Confirmar que el tipo quedó seleccionado (muestra su etiqueta en aria-label).
    let tipoConfirmado = false;
    for (let w = 0; w < 8 && !tipoConfirmado; w++) {
      await page.waitForTimeout(400).catch(() => {});
      tipoConfirmado = (await fr.locator(`input[aria-label*="${label}" i]`).count().catch(() => 0)) > 0
        || (await fr.getByText(new RegExp(`Tipo de comprobante[^]{0,25}${label}`, "i")).first().count().catch(() => 0)) > 0;
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
        tip: e.getAttribute("mattooltip") || e.getAttribute("ng-reflect-message") || e.getAttribute("ng-reflect-text") || e.getAttribute("ptooltip") || e.getAttribute("title") || e.getAttribute("aria-label") || "",
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
    // Por el tooltip "Descargar XML" (PrimeNG: pTooltip → ng-reflect-text).
    '[ng-reflect-text*="XML" i]', '[pTooltip*="XML" i]', '[ng-reflect-p-tooltip*="XML" i]',
    '[mattooltip*="XML" i]', '[ng-reflect-message*="XML" i]', '[title*="XML" i]', '[aria-label*="XML" i]',
    // Por la clase del ícono (font-awesome): el XML es fa-file-code (el PDF es fa-file-pdf).
    'i[class*="fa-file-code"]', '[class*="fa-file-code"]',
    'i[class*="fa-file-excel"]', '[class*="fa-file-excel"]',
    'i[class*="fa-code"]',
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
    // ERROR: el aviso trae botón "Aceptar" O el texto "Error del Servidor" (que a
    // veces queda DETRÁS del "Cargando...", pero igual está en el DOM).
    const hayAceptar = await fr.getByText("Aceptar", { exact: true }).first().count().catch(() => 0);
    const hayErrorServidor = await fr.getByText(/Error del Servidor|no se puede acceder a los servicios de SUNAT/i).first().count().catch(() => 0);
    if (hayAceptar || hayErrorServidor) {
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
      return { estado: "error", aviso: aviso || "Error del Servidor" };
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
      // Esperar a que el LOADER del menú termine de renderizar el formulario
      // (aparece "RUC Emisor"/"Recibido"). Si no se espera, se intenta llenar
      // antes de que existan los campos → todo vacío → timeout.
      for (let i = 0; i < 16 && !formOk; i++) {
        await s.page.waitForTimeout(1500).catch(() => {});
        formOk = await Promise.all(
          s.ctx.pages().flatMap((pg: any) =>
            pg.frames().map((fr: any) =>
              fr.getByText(/RUC\s*Emisor|Filtro de comprobante|Recibido/i).first().count().catch(() => 0)
            )
          )
        ).then((cs) => cs.some((c) => c > 0)).catch(() => false);
      }
      pasos.push({ paso: "menu-form", formOk });
    }

    // Cerrar anuncio flotante si apareció sobre el formulario ("Ver más tarde"…).
    await cerrarAnuncios(s.ctx);

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
            marcarFallo(item, "No se puede extraer por problemas en la plataforma de SUNAT (respondió “Error del Servidor”). Reintenta en unos minutos.", llenado);
            // Solo si es PERSISTENTE (varios seguidos) se declara caído y se corta.
            if (serverSeguidos >= UMBRAL_CAIDO) {
              const msg = "No se puede extraer por problemas en la plataforma de SUNAT (respondió “Error del Servidor” varias veces). Reintenta en unos minutos.";
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
            if (fx && fx.rucEmisor) {
              fx.xmlBase64 = Buffer.from(x, "utf-8").toString("base64"); // XML crudo para descargar
              facturas.push(fx); nuevas.push(fx);
            }
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

// ============================================================
//  MODO API — descarga del XML por el endpoint interno del portal
// ============================================================
// SUNAT NO publica una API REST oficial para bajar el XML de comprobantes
// RECIBIDOS de terceros: la pantalla "Consulta de comprobantes" (ConsultaCPE) es
// una app Angular que, por dentro, llama endpoints JSON/REST propios. Este modo:
//   1) OMITE el PDF (solo XML) → cada comprobante es más rápido.
//   2) En Modo diagnóstico, CAPTURA todas las llamadas de red internas a SUNAT
//      (URL, método, payload, status) durante la consulta+descarga → así se
//      IDENTIFICA el endpoint interno para luego llamarlo directo (calibración).
//   3) Si se configura el endpoint por entorno (CPE_XML_API_URL), lo llama
//      DIRECTO por fetch (con las cookies de la sesión), sin clics.
// Comparte login y navegación con el modo scraping (reutiliza sus helpers).

/** Una llamada de red capturada del portal (para calibrar el endpoint interno). */
export interface LlamadaApi {
  url: string;
  metodo: string;
  status?: number;
  tipo?: string;      // content-type
  postData?: string;  // cuerpo enviado (truncado)
  muestra?: string;   // fragmento de la respuesta (truncado)
}

/** Registra en `calls` las llamadas XHR/fetch a hosts de SUNAT de todas las
 *  páginas (actuales y futuras). Solo para diagnóstico: revela el endpoint que
 *  la app Angular usa para consultar y para descargar el XML. Captura tanto la
 *  PETICIÓN (método, URL, cuerpo, cabeceras clave) como la RESPUESTA — así se ve
 *  el endpoint aunque la descarga del XML sea un adjunto (sin cuerpo legible). */
function grabarRedSunat(ctx: any, calls: LlamadaApi[]) {
  const esSunat = /sunat\.gob\.pe/i;
  const relevante = /(api|rest|service|servicio|consulta|comprob|cpe|descarg|download|archivo|reporte|xml|zip|cdr)/i;
  const esAsset = (u: string) => /\.(js|css|png|jpe?g|gif|svg|woff2?|ttf|ico|map|html?)(\?|$)/i.test(u);
  const push = (c: LlamadaApi) => { calls.push(c); if (calls.length > 250) calls.splice(0, calls.length - 250); };

  // 1) Toda PETICIÓN relevante (XHR/fetch/POST) → registra método, URL, cuerpo y
  //    cabeceras útiles para replicar (content-type, accept, referer, tokens).
  const onReq = (req: any) => {
    try {
      const url = String(req.url() || "");
      if (!esSunat.test(url) || esAsset(url)) return;
      const metodo = String(req.method() || "GET");
      const tipoRec = String(req.resourceType?.() || "");
      if (metodo === "GET" && tipoRec !== "xhr" && tipoRec !== "fetch" && !relevante.test(url)) return;
      let postData = "";
      try { postData = String(req.postData?.() || ""); } catch { /* */ }
      const h = (req.headers?.() ?? {}) as Record<string, string>;
      const cabeceras = ["content-type", "accept", "referer", "authorization", "x-csrf-token", "cookie"]
        .filter((k) => h[k]).map((k) => `${k}: ${k === "cookie" ? "(presente)" : String(h[k]).slice(0, 120)}`).join(" · ");
      push({ url: url.slice(0, 240), metodo, tipo: `req:${tipoRec}`, postData: postData.slice(0, 400), muestra: cabeceras.slice(0, 300) });
    } catch { /* */ }
  };
  // 2) RESPUESTA de datos → registra status/content-type y una muestra del cuerpo.
  const onResp = async (resp: any) => {
    try {
      const url = String(resp.url() || "");
      if (!esSunat.test(url) || esAsset(url)) return;
      const ct = String((resp.headers?.() ?? {})["content-type"] || "");
      if (!relevante.test(url) && !/json|xml|zip|octet/i.test(ct)) return;
      let muestra = "";
      if (/json|xml|text/i.test(ct)) muestra = String(await resp.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 300);
      else if (/zip|octet/i.test(ct)) muestra = "(binario/adjunto — probable ZIP/XML de descarga)";
      push({ url: url.slice(0, 240), metodo: String(resp.request?.().method?.() || ""), status: resp.status?.(), tipo: `resp:${ct.slice(0, 50)}`, muestra });
    } catch { /* */ }
  };
  const enganchar = (pg: any) => { try { pg.on("request", onReq); pg.on("response", onResp); } catch { /* */ } };
  ctx.pages().forEach(enganchar);
  ctx.on("page", enganchar);
}

/** Resuelve la URL del endpoint para un comprobante. Placeholders admitidos:
 *  {ruc} {rucEmisor} {tipo} {serie} {numero} {numeroPad} {periodo} {fecha}. */
function urlComprobante(plantilla: string, ruc: string, item: ItemRelacion, periodo: string): string {
  const repl: Record<string, string> = {
    ruc,
    rucEmisor: item.rucEmisor,
    tipo: item.tipo,
    serie: item.serie,
    numero: item.numero,
    numeroSc: String(item.numero).replace(/^0+/, "") || "0",
    numeroPad: String(item.numero).replace(/^0+/, "").padStart(8, "0"),
    periodo: periodo || "",
    fecha: item.fecha || "",
  };
  let url = plantilla;
  for (const [k, v] of Object.entries(repl)) url = url.replaceAll(`{${k}}`, encodeURIComponent(v));
  return url;
}

/** Una petición lista para disparar (URL + opciones de fetch). */
interface PeticionXml { url: string; metodo: string; body?: string; headers?: Record<string, string> }

/** Descarga EN PARALELO (en lote) el XML de muchos comprobantes por el endpoint
 *  interno, DENTRO de la página (usa las cookies de sesión). Devuelve, en el
 *  mismo orden, el texto (base64) de cada uno (o "" si falló). Esto es lo que
 *  hace rápida la extracción masiva: N descargas concurrentes en una sola
 *  llamada, sin abrir navegador por comprobante ni consultar de a uno.
 *  Soporta GET o POST con cuerpo/cabeceras (según lo que revele la captura). */
async function fetchXmlLote(runner: any, peticiones: PeticionXml[], concurrencia: number, credentials: string = "include"): Promise<string[]> {
  return (await runner.evaluate(async ({ peticiones, concurrencia, credentials }: { peticiones: PeticionXml[]; concurrencia: number; credentials: string }) => {
    const out: string[] = new Array(peticiones.length).fill("");
    let i = 0;
    async function worker() {
      while (i < peticiones.length) {
        const idx = i++;
        const p = peticiones[idx];
        try {
          const init: any = { method: p.metodo || "GET", credentials };
          if (p.headers) init.headers = p.headers;
          if (p.body != null && p.metodo !== "GET") init.body = p.body;
          const r = await fetch(p.url, init);
          if (!r.ok) continue;
          const b = await r.arrayBuffer(); const by = new Uint8Array(b);
          let s = ""; const CH = 0x8000;
          for (let k = 0; k < by.length; k += CH) s += String.fromCharCode.apply(null, Array.from(by.subarray(k, k + CH)) as any);
          out[idx] = btoa(s);
        } catch { /* deja "" */ }
      }
    }
    await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrencia, peticiones.length)) }, worker));
    return out;
  }, { peticiones, concurrencia, credentials }).catch(() => peticiones.map(() => ""))) as string[];
}

/** Rellena una plantilla (URL o body) con los datos del comprobante. */
function rellenarPlantilla(plantilla: string, ruc: string, item: ItemRelacion, periodo: string): string {
  const repl: Record<string, string> = {
    ruc,
    rucEmisor: item.rucEmisor,
    tipo: item.tipo,
    serie: item.serie,
    numero: item.numero,
    numeroSc: String(item.numero).replace(/^0+/, "") || "0",
    numeroPad: String(item.numero).replace(/^0+/, "").padStart(8, "0"),
    periodo: periodo || "",
    fecha: item.fecha || "",
  };
  let out = plantilla;
  for (const [k, v] of Object.entries(repl)) out = out.replaceAll(`{${k}}`, v);
  return out;
}

// --- Endpoint interno REAL de SUNAT (ConsultaCPE), hallado por diagnóstico -----
// La app Angular ConsultaCPE (code 11.38.1.1.1) baja el XML así:
//   GET https://api-cpe.sunat.gob.pe/v1/contribuyente/consultacpe/comprobantes/
//       {rucEmisor}-{tipo}-{serie}-{numero}-2/02
//   → 200 JSON { nomArchivo:"...-XML.zip", valArchivo:"<base64 del ZIP>" }
// Auth: Authorization: Bearer <JWT> (token que el portal emite tras el login
// SOL). Origen de las llamadas: e-factura.sunat.gob.pe (por CORS, el fetch debe
// dispararse DESDE ese frame). El sufijo "-2" y "/02" son constantes del portal.
const ENDPOINT_CPE_DEFAULT =
  "https://api-cpe.sunat.gob.pe/v1/contribuyente/consultacpe/comprobantes/{rucEmisor}-{tipo}-{serie}-{numeroSc}-2/02";
const HOST_CPE = /api-cpe\.sunat\.gob\.pe/i;

/** Frame de la app Angular ConsultaCPE (origen e-factura.sunat.gob.pe). El fetch
 *  al api-cpe debe correr desde AHÍ para que el CORS y el token coincidan. */
function frameEFactura(ctx: any): any {
  for (const pg of ctx.pages()) for (const fr of pg.frames()) {
    if (/e-factura\.sunat\.gob\.pe|consultacpe|nuevaconsulta/i.test(fr.url())) return fr;
  }
  return null;
}

/** Captura COMPLETO (sin truncar) el Bearer que la app manda al api-cpe. Se
 *  engancha antes de navegar: la 1ª llamada (/parametros) ya lo lleva. */
function capturarTokenCpe(ctx: any, ref: { token: string }) {
  const grab = (req: any) => {
    try {
      if (!HOST_CPE.test(String(req.url() || ""))) return;
      const h = (req.headers?.() ?? {}) as Record<string, string>;
      const a = h["authorization"] || h["Authorization"] || "";
      if (/bearer\s+eyJ/i.test(a)) ref.token = a;
    } catch { /* */ }
  };
  const eng = (pg: any) => { try { pg.on("request", grab); } catch { /* */ } };
  ctx.pages().forEach(eng); ctx.on("page", eng);
}

/** Respaldo: si no se capturó el token de la red, búscalo en el storage del
 *  frame de la app (Angular lo guarda tras el login). */
async function tokenDesdeStorage(fr: any): Promise<string> {
  if (!fr?.evaluate) return "";
  return (await fr.evaluate(() => {
    try {
      for (const store of [sessionStorage, localStorage]) {
        for (let i = 0; i < store.length; i++) {
          const v = store.getItem(store.key(i) as string) || "";
          const m = v.match(/eyJ[\w-]+\.[\w-]+\.[\w-]+/);
          if (m) return "Bearer " + m[0];
        }
      }
    } catch { /* */ }
    return "";
  }).catch(() => "")) as string;
}

/** De la respuesta cruda (base64) del endpoint saca los XML. El api-cpe devuelve
 *  JSON { valArchivo } con el ZIP en base64; otros endpoints podrían devolver el
 *  ZIP/XML directo. Maneja ambos. */
function xmlsDeRespuesta(
  b64: string,
  esZip: (b: Buffer) => boolean,
  extraerTodo: (b: Buffer) => { name: string; data: Buffer }[],
): string[] {
  if (!b64) return [];
  const buf = Buffer.from(b64, "base64");
  if (buf[0] === 0x7b /* '{' → JSON { valArchivo } */) {
    try {
      const j = JSON.parse(buf.toString("utf-8"));
      const val = j.valArchivo || j.arch || j.archivo || j.contenido;
      if (typeof val === "string" && val) {
        const z = Buffer.from(val, "base64");
        return esZip(z) ? extraerTodo(z).map((it) => it.data.toString("utf-8")) : [z.toString("utf-8")];
      }
    } catch { /* */ }
    return [];
  }
  return esZip(buf) ? extraerTodo(buf).map((it) => it.data.toString("utf-8")) : [buf.toString("utf-8")];
}

/**
 * Extrae los XML (SIN PDF) por el modo API. En diagnóstico captura las llamadas
 * de red internas de SUNAT para identificar el endpoint. Reutiliza el login y la
 * navegación del modo scraping; si hay CPE_XML_API_URL, baja el XML por fetch
 * directo (sin clics).
 */
export async function extraerComprobantesXmlApi(params: ComprobantesParams): Promise<ComprobantesResultado & { diag?: { pasos: any[]; apiCalls?: LlamadaApi[] } }> {
  const pasos: any[] = [];
  const apiCalls: LlamadaApi[] = [];
  const endpointDirecto = (process.env.CPE_XML_API_URL || ENDPOINT_CPE_DEFAULT).trim();
  let browser: any = null;
  let cerradoPorTiempo = false;
  const tope = setTimeout(() => { cerradoPorTiempo = true; if (browser) browser.close().catch(() => {}); }, 220000);
  try {
    const s = await loginSol(params, pasos);
    browser = s.browser;
    if (s.loginError) {
      return { loginError: true, error: "SUNAT rechazó el inicio de sesión (Usuario/Clave SOL incorrectos o bloqueo temporal). Espera ~10 min y reintenta.", diag: { pasos } };
    }
    // Captura de red SIEMPRE activa (barata); se devuelve solo en diagnóstico.
    grabarRedSunat(s.ctx, apiCalls);

    const relacionTotal = params.relacion ?? [];
    if (!relacionTotal.length) {
      return { facturas: [], descargados: 0, error: "Sube una relación de comprobantes para descargar.", diag: { pasos } };
    }

    // --- Camino DIRECTO por endpoint interno (api-cpe) -------------------------
    // Descubierto por diagnóstico: GET .../comprobantes/{clave}/02 → JSON con el
    // XML (ZIP en base64). Requiere el Bearer que el portal emite tras el login;
    // se captura navegando a la app y el fetch se dispara DESDE su frame (origen
    // e-factura) para que CORS y token coincidan. N descargas EN PARALELO: esto
    // es lo que hace rápida la extracción masiva (sin abrir navegador por CPE).
    if (endpointDirecto) {
      const { esZip, extraerTodo } = await import("./zip");
      const usaBearer = HOST_CPE.test(endpointDirecto);
      const relacion = relacionTotal; // TODA la relación (son fetch, no clics)
      const concurrencia = Math.max(1, Math.min(Number(process.env.CPE_XML_CONCURRENCIA || 12), 30));
      // Método/cuerpo/cabeceras configurables por env (por si SUNAT cambia algo).
      const metodo = (process.env.CPE_XML_API_METHOD || "GET").toUpperCase();
      const bodyTpl = process.env.CPE_XML_API_BODY || "";
      let headersEnv: Record<string, string> | undefined;
      try { headersEnv = process.env.CPE_XML_API_HEADERS ? JSON.parse(process.env.CPE_XML_API_HEADERS) : undefined; } catch { headersEnv = undefined; }

      // 1) Navegar a la app para EMITIR/CAPTURAR el token y ubicar su frame.
      const tokRef = { token: "" };
      let frameRun: any = s.page;
      if (usaBearer) {
        capturarTokenCpe(s.ctx, tokRef);
        await s.page.goto(APP_URL_CONSULTA, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
        for (let i = 0; i < 20 && !tokRef.token; i++) await s.page.waitForTimeout(1000).catch(() => {});
        const fApp = frameEFactura(s.ctx);
        if (fApp) frameRun = fApp;
        if (!tokRef.token) tokRef.token = await tokenDesdeStorage(fApp || s.page);
        pasos.push({ paso: "api-token", capturado: !!tokRef.token, frameApp: !!fApp });
        if (!tokRef.token) {
          return {
            facturas: [], descargados: 0,
            fallidos: relacion.map((item) => ({ item, motivo: "no se pudo obtener el token de sesión de SUNAT" })),
            error: "No se pudo obtener el token de la sesión SUNAT. Reintenta; si persiste, corre el Modo diagnóstico.",
            diag: { pasos, apiCalls: params.diagnostico ? apiCalls : undefined },
          };
        }
      }
      const headersBase: Record<string, string> | undefined = usaBearer
        ? { authorization: tokRef.token, accept: "application/json, text/plain, */*" }
        : headersEnv;
      const cred = usaBearer ? "omit" : "include";

      const facturas: FacturaXml[] = [];
      const fallidos: { item: ItemRelacion; motivo: string }[] = [];
      const t0 = Date.now();
      // Se procesa por bloques para acotar memoria en volúmenes grandes (1000+),
      // pero cada bloque baja en paralelo (concurrencia N).
      const TAM_BLOQUE = 200;
      for (let ini = 0; ini < relacion.length; ini += TAM_BLOQUE) {
        const bloque = relacion.slice(ini, ini + TAM_BLOQUE);
        const peticiones: PeticionXml[] = bloque.map((it) => ({
          url: urlComprobante(endpointDirecto, params.ruc, it, params.periodo),
          metodo,
          body: bodyTpl ? rellenarPlantilla(bodyTpl, params.ruc, it, params.periodo) : undefined,
          headers: headersBase,
        }));
        const textos = await fetchXmlLote(frameRun, peticiones, concurrencia, cred);
        for (let j = 0; j < bloque.length; j++) {
          const item = bloque[j];
          const xmls = xmlsDeRespuesta(textos[j], esZip, extraerTodo);
          if (!xmls.length) { fallidos.push({ item, motivo: "el endpoint no devolvió XML (revisar clave o token)" }); continue; }
          let ok = false;
          for (const x of xmls) {
            const fx = parseFacturaXml(x);
            if (fx && fx.rucEmisor) { fx.xmlBase64 = Buffer.from(x, "utf-8").toString("base64"); facturas.push(fx); ok = true; }
          }
          if (!ok) fallidos.push({ item, motivo: "el contenido no era un XML de comprobante" });
        }
        if (cerradoPorTiempo) break;
      }
      pasos.push({ paso: "api-directo", endpoint: endpointDirecto.replace(/\{[^}]+\}/g, "•"), pedidos: relacion.length, ok: facturas.length, concurrencia, segundos: Math.round((Date.now() - t0) / 1000) });
      return {
        facturas, descargados: facturas.length, fallidos,
        error: facturas.length ? undefined : "El endpoint directo no devolvió XML. Reintenta o revisa el Modo diagnóstico.",
        diag: { pasos, apiCalls: params.diagnostico ? apiCalls : undefined },
      };
    }

    // --- Camino con el FORMULARIO (mismo que scraping) pero SIN PDF ------------
    const APP_URL = "https://e-menu.sunat.gob.pe/cl-ti-itmenu/MenuInternet.htm?action=execute&code=11.38.1.1.1&s=ww1";
    await s.page.goto(APP_URL, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
    pasos.push({ paso: "goto-app", url: APP_URL });
    let formOk = false;
    for (let i = 0; i < 12 && !formOk; i++) {
      await s.page.waitForTimeout(1500).catch(() => {});
      formOk = await Promise.all(
        s.ctx.pages().flatMap((pg: any) => pg.frames().map((fr: any) => fr.getByText(/RUC\s*Emisor|Filtro de comprobante|Recibido/i).first().count().catch(() => 0)))
      ).then((cs) => cs.some((c) => c > 0)).catch(() => false);
    }
    await cerrarAnuncios(s.ctx);

    const { esZip, extraerTodo } = await import("./zip");
    const facturas: FacturaXml[] = [];
    const fallidos: { item: ItemRelacion; motivo: string }[] = [];
    const errores: any[] = [];
    const marcarFallo = (item: ItemRelacion, motivo: string, extra?: any) => { errores.push({ item: `${item.serie}-${item.numero}`, motivo, ...(extra || {}) }); fallidos.push({ item, motivo }); };
    const TIPOS_SOPORTADOS = new Set(["01", "03", "07", "08", "14"]);
    const relacion = relacionTotal.slice(0, 25);
    const sobrantes = relacionTotal.length - relacion.length;
    let sunatCaido: string | null = null;
    let serverSeguidos = 0;

    for (let i = 0; i < relacion.length; i++) {
      const item = relacion[i];
      try {
        if (!TIPOS_SOPORTADOS.has(item.tipo)) { marcarFallo(item, `Tipo ${item.tipo} no se descarga en la Consulta individual de SUNAT.`); continue; }
        const fr = frameForm(s.ctx);
        if (!fr) { for (let j = i; j < relacion.length; j++) marcarFallo(relacion[j], "el navegador se cerró (reintentar)"); break; }
        let estado: "resultado" | "error" | "nada" = "nada";
        let llenado: any = null;
        let ultimoAviso = "";
        for (let intento = 0; intento < 2; intento++) {
          if (i > 0 || intento > 0) {
            await fr.getByText("Limpiar", { exact: false }).first().click({ timeout: 3000 }).catch(() => {});
            await s.page.waitForTimeout(1200).catch(() => {});
          }
          llenado = await llenarYConsultar(fr, s.page, item);
          const r = await esperarResultado(fr, s.page);
          estado = r.estado;
          if (r.aviso) ultimoAviso = r.aviso;
          if (params.diagnostico && r.aviso && llenado) llenado.aviso = r.aviso;
          if (estado === "resultado") break;
          await fr.getByText("Aceptar", { exact: false }).first().click({ timeout: 2000 }).catch(() => {});
          await s.page.waitForTimeout(ES_SERVIDOR_CAIDO.test(ultimoAviso || "") ? 3000 : 1200).catch(() => {});
        }
        if (estado !== "resultado") {
          if (ES_SERVIDOR_CAIDO.test(ultimoAviso)) {
            serverSeguidos++;
            marcarFallo(item, "SUNAT respondió “Error del Servidor”. Reintenta en unos minutos.", { llenado });
            if (serverSeguidos >= 4) { sunatCaido = "SUNAT respondió “Error del Servidor” varias veces. Reintenta en unos minutos."; for (let j = i + 1; j < relacion.length; j++) marcarFallo(relacion[j], sunatCaido); break; }
          } else {
            serverSeguidos = 0;
            marcarFallo(item, estado === "error" ? "SUNAT no devolvió el comprobante (revisa RUC/tipo/serie/número o no existe)." : "no apareció el resultado (tiempo agotado).", { llenado });
          }
          continue;
        }
        serverSeguidos = 0;
        const dxml: any = {};
        const buf = await descargarXmlResultado(fr, s.page, params.diagnostico ? dxml : undefined);
        if (!buf) {
          marcarFallo(item, "salió la factura pero no se pudo bajar el XML.", { iconosModal: dxml.iconos });
        } else {
          const xmls: string[] = [];
          const recolectar = (b: Buffer, depth: number) => {
            if (!esZip(b)) { xmls.push(b.toString("utf-8")); return; }
            for (const it of extraerTodo(b)) {
              if (depth < 3 && (it.name.toLowerCase().endsWith(".zip") || esZip(it.data))) recolectar(it.data, depth + 1);
              else xmls.push(it.data.toString("utf-8"));
            }
          };
          recolectar(buf, 0);
          let nuevas = 0;
          for (const x of xmls) {
            const fx = parseFacturaXml(x);
            if (fx && fx.rucEmisor) { fx.xmlBase64 = Buffer.from(x, "utf-8").toString("base64"); facturas.push(fx); nuevas++; }
          }
          // MODO API: NO se descarga el PDF (solo XML) → cada comprobante es más rápido.
          if (!nuevas) marcarFallo(item, "el archivo descargado no era un XML de comprobante", { iconosModal: dxml.iconos });
        }
        await cerrarModal(fr);
        await s.page.waitForTimeout(1000).catch(() => {});
      } catch (e: any) {
        marcarFallo(item, String(e?.message ?? e).slice(0, 120));
      }
    }
    pasos.push({ paso: "descargas", pedidos: relacion.length, ok: facturas.length, errores });

    const notaSobrantes = sobrantes > 0 ? ` (Se procesaron ${relacion.length} de ${relacionTotal.length}; sube el resto en otra tanda.)` : "";
    return {
      facturas,
      descargados: facturas.length,
      fallidos,
      sunatCaido: !!sunatCaido,
      error: sunatCaido ? sunatCaido : facturas.length ? (sobrantes > 0 ? `Descargados ${facturas.length}.${notaSobrantes}` : undefined) : `No se descargó ningún XML (de ${relacion.length}). Revisa el diagnóstico.`,
      diag: { pasos, apiCalls: params.diagnostico ? apiCalls : undefined },
    };
  } catch (err: any) {
    if (cerradoPorTiempo) return { error: "La consulta tardó demasiado y se canceló. Reintenta.", diag: { pasos } };
    return { error: err?.message ?? "Error extrayendo los comprobantes.", diag: { pasos, apiCalls: params.diagnostico ? apiCalls : undefined } };
  } finally {
    clearTimeout(tope);
    if (browser) await browser.close().catch(() => {});
  }
}
