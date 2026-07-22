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
  loginError?: boolean;
  error?: string;
  diag?: { pasos: any[] };
}

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
function autoAceptarDialogos(ctx: any) {
  ctx.on("page", (pg: any) => pg.on("dialog", (d: any) => d.accept().catch(() => {})));
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
  if (!navOk) await page.goto(LOGIN_URL, { waitUntil: "commit", timeout: 45000 });
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
  const url = page.url();
  const texto = (await page.evaluate(() => (document.body?.innerText || "").slice(0, 300)).catch(() => "")) as string;
  const loginError = /oauth2\/error|autenticamenuinternet|problema en la aplicaci|no podemos atenderlo/i.test(url + " " + texto);
  pasos.push({ paso: "login", url, loginError });
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
  for (const pg of ctx.pages()) {
    for (const fr of pg.frames()) if (/nuevaconsulta|consultacpe/i.test(fr.url())) return fr;
  }
  return ctx.pages()[0].mainFrame();
}

// Código de tipo (01/03/07/08) → texto EXACTO del dropdown "Tipo de comprobante".
const TIPO_LABEL: Record<string, string> = {
  "01": "Factura",
  "03": "Boleta",
  "07": "Factura - Nota de Crédito",
  "08": "Factura - Nota de Débito",
};

/** Llena el formulario (Recibido + RUC + tipo + serie/número) y da "Consultar". */
async function llenarYConsultar(fr: any, page: any, item: ItemRelacion): Promise<any> {
  const hecho: any = {};
  try {
    // 1) Marcar "Recibido".
    const recibido = fr.locator("#recibido").first();
    await recibido.check().catch(async () => { await recibido.click().catch(() => {}); });
    hecho.recibido = true;
    // 2) RUC Emisor.
    await fr.locator('[formcontrolname="rucEmisor"]').first().fill(item.rucEmisor).catch(() => {});
    // 3) Tipo de comprobante (dropdown Angular): abrir y elegir por texto EXACTO
    //    (hay "Factura" y "Factura - Nota de Crédito"; sin exact se confunden).
    const label = TIPO_LABEL[item.tipo] ?? "Factura";
    await fr.getByText("Seleccionar", { exact: false }).first().click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(900).catch(() => {});
    await fr.getByText(label, { exact: true }).first().click({ timeout: 3000 }).catch(async () => {
      await fr.getByText(label, { exact: false }).first().click({ timeout: 2000 }).catch(() => {});
    });
    hecho.tipo = label;
    // 4) Serie y Número.
    await fr.locator('[formcontrolname="serieComprobante"]').first().fill(item.serie).catch(() => {});
    await fr.locator('[formcontrolname="numeroComprobante"]').first().fill(item.numero).catch(() => {});
    // 5) Consultar.
    await fr.getByText("Consultar", { exact: false }).first().click({ timeout: 4000 }).catch(() => {});
    hecho.consultado = true;
  } catch (e: any) {
    hecho.error = String(e?.message ?? e).slice(0, 150);
  }
  return hecho;
}

/** En el modal "Resultado", hace clic en el icono "Descargar XML" y captura el
 *  archivo. Devuelve el Buffer del XML (o del ZIP que lo contiene) o null. */
async function descargarXmlResultado(fr: any, page: any): Promise<Buffer | null> {
  const { promises: fs } = await import("fs");
  // Candidatos del icono "Descargar XML" (tooltip Angular Material u otros).
  const candidatos = [
    '[title="Descargar XML"]',
    '[aria-label="Descargar XML"]',
    '[mattooltip="Descargar XML"]',
    '[ng-reflect-message="Descargar XML"]',
  ];
  const clicar = async () => {
    for (const sel of candidatos) {
      const el = fr.locator(sel).first();
      if (await el.count().catch(() => 0)) { await el.click({ timeout: 4000 }).catch(() => {}); return true; }
    }
    // Respaldo: los 4 iconos (PDF, XML, Imprimir, Email) están juntos; el XML
    // suele ser el 2º. Busca dentro de un contenedor con el icono PDF.
    const iconos = fr.locator(".modal a, .modal i, .modal img, [class*=result] a, [class*=result] i").filter({ hasNot: fr.locator("nothing") });
    const n = await iconos.count().catch(() => 0);
    if (n >= 2) { await iconos.nth(1).click({ timeout: 3000 }).catch(() => {}); return true; }
    return false;
  };
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 20000 }).catch(() => null),
    clicar(),
  ]);
  if (!download) return null;
  try {
    const p = await download.path();
    if (!p) return null;
    return await fs.readFile(p);
  } catch {
    return null;
  }
}

/** Tras "Consultar", espera a que aparezca el modal "Resultado" (factura) o un
 *  aviso de error ("Aceptar"). Devuelve cuál apareció. */
async function esperarResultado(fr: any, page: any): Promise<"resultado" | "error" | "nada"> {
  for (let i = 0; i < 9; i++) {
    await page.waitForTimeout(1500).catch(() => {});
    // ERROR primero: el aviso de "no encontrado" trae botón "Aceptar" (y el
    // modal de factura NO lo tiene). Así no confundimos el título "Resultado".
    if (await fr.getByText("Aceptar", { exact: true }).first().count().catch(() => 0)) return "error";
    // RESULTADO real: aparece el contenido de la factura o el icono de descarga.
    const facturaReal = await fr
      .getByText(/Importe Total|FACTURA ELECTR|Descargar XML/i)
      .first().count().catch(() => 0);
    if (facturaReal) return "resultado";
  }
  return "nada";
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

    const relacion = params.relacion ?? [];
    if (!relacion.length) {
      return { facturas: [], descargados: 0, error: "Sube una relación de comprobantes (con la plantilla) para descargar.", diag: { pasos } };
    }

    // BUCLE: por cada comprobante de la relación → llenar, consultar, descargar
    // el XML del modal "Resultado", parsearlo (ZIP o XML) y cerrar el modal.
    const { esZip, extraerDeZip } = await import("./zip");
    const facturas: FacturaXml[] = [];
    const errores: any[] = [];
    for (let i = 0; i < relacion.length; i++) {
      const item = relacion[i];
      try {
        const fr = frameForm(s.ctx);
        const llenado = await llenarYConsultar(fr, s.page, item);
        // ¿Salió el modal Resultado (factura) o un aviso de error?
        const estado = await esperarResultado(fr, s.page);
        if (estado !== "resultado") {
          // Cierra el aviso de error para poder consultar el siguiente.
          await fr.getByText("Aceptar", { exact: false }).first().click({ timeout: 2000 }).catch(() => {});
          errores.push({
            item: `${item.serie}-${item.numero}`,
            motivo: estado === "error"
              ? "SUNAT no devolvió el comprobante (revisa RUC emisor, tipo, serie y número, o el comprobante no existe)."
              : "no apareció el resultado (tiempo agotado).",
            llenado,
          });
          await s.page.waitForTimeout(1000).catch(() => {});
          continue;
        }
        const buf = await descargarXmlResultado(fr, s.page);
        if (!buf) {
          errores.push({ item: `${item.serie}-${item.numero}`, motivo: "salió la factura pero no se pudo bajar el XML (revisar icono de descarga).", llenado });
        } else {
          // Puede venir como XML directo o dentro de un ZIP.
          const xmls: string[] = [];
          if (esZip(buf)) {
            for (const it of extraerDeZip(buf, [".xml"])) xmls.push(it.data.toString("utf-8"));
          } else {
            xmls.push(buf.toString("utf-8"));
          }
          let ok = false;
          for (const x of xmls) {
            const fx = parseFacturaXml(x);
            if (fx && fx.rucEmisor) { facturas.push(fx); ok = true; }
          }
          if (!ok) errores.push({ item: `${item.serie}-${item.numero}`, motivo: "el archivo no era un XML de comprobante" });
        }
        await cerrarModal(fr);
        await s.page.waitForTimeout(1200).catch(() => {});
      } catch (e: any) {
        errores.push({ item: `${item.serie}-${item.numero}`, motivo: String(e?.message ?? e).slice(0, 120) });
      }
    }
    pasos.push({ paso: "descargas", pedidos: relacion.length, ok: facturas.length, errores });

    // En modo diagnóstico, además vuelca la estructura del resultado (por si hay
    // que calibrar el icono de descarga).
    if (params.diagnostico) {
      const resultado = await volcarEstructura(s.ctx);
      pasos.push({ paso: "resultado", framesTodos: listarFrames(s.ctx), ...resultado });
    }

    return {
      facturas,
      descargados: facturas.length,
      error: facturas.length
        ? undefined
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
