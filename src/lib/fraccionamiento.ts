// ============================================================
//  Fraccionamiento Art. 36 (F36) — pedido y extracción de deudas (portal SOL)
// ============================================================
// Flujo (manual): Mi Fraccionamiento → Solicito fraccionamiento art.36 →
// Fracc Art 36 → "Generación de pedido de deuda" (Tesoro) → enviar → esperar
// ~5 min → "Consulta estado de pedido de deuda" → fila 1 → cuando esté listo
// aparece un enlace azul "Elaborar solicitud" → (aceptar el aviso) → se abre el
// F36 con pestañas: Valores, Deudas Autoliquidadas/Reliquidadas, Otras Deudas,
// Deudas no Acogibles. Se lee cada pestaña (cabeceras + filas).
//
// Como es navegación por menús SOL, hay MODO DIAGNÓSTICO que vuelca menús y DOM
// para calibrar selectores (igual que se hizo con SIRE/buzón).

const LOGIN_URL =
  process.env.BUZON_LOGIN_URL ??
  "https://e-menu.sunat.gob.pe/cl-ti-itmenu/MenuInternet.htm?exe=01.04.00.00.000000";

export interface FraccParams {
  ruc: string;
  solUser: string;
  solPass: string;
  diagnostico?: boolean;
}

export interface TablaDeuda {
  pestana: string;
  headers: string[];
  filas: string[][];
}

export interface FraccResultado {
  ok: boolean;
  mensaje?: string;
  tablas?: TablaDeuda[];
  /** Mensaje de SUNAT (texto en rojo) cuando bloquea el trámite. */
  nota?: string;
  error?: string;
  diag?: { pasos: any[] };
}

async function lanzarNavegador() {
  const { chromium } = await import("playwright-core");
  try {
    const sparticuz = (await import("@sparticuz/chromium")).default as any;
    const executablePath = await sparticuz.executablePath();
    if (executablePath) {
      return chromium.launch({
        headless: true,
        executablePath,
        args: [...(sparticuz.args ?? []), "--no-sandbox", "--disable-dev-shm-usage"],
      });
    }
  } catch {
    /* fallback local */
  }
  return chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });
}

async function rellenar(page: any, selectores: string[], valor: string) {
  for (const sel of selectores) {
    try {
      const el = await page.$(sel);
      if (el) { await el.fill(valor); return true; }
    } catch {}
  }
  return false;
}
async function clickAny(page: any, selectores: string[]) {
  for (const sel of selectores) {
    try {
      const el = await page.$(sel);
      if (el) { await el.click(); return true; }
    } catch {}
  }
  return false;
}

/** Acepta automáticamente cualquier alert/confirm ("mensaje de página web"). */
function autoAceptarDialogos(ctx: any) {
  const enganchar = (pg: any) => pg.on("dialog", (d: any) => d.accept().catch(() => {}));
  ctx.pages().forEach(enganchar);
  ctx.on("page", enganchar);
}

/** Clic por TEXTO en cualquier frame de cualquier pestaña. Devuelve lo clicado. */
async function clicTexto(ctx: any, textos: string[]): Promise<string | null> {
  for (const pg of ctx.pages()) {
    for (const fr of pg.frames()) {
      const hit = await fr
        .evaluate((textos: string[]) => {
          const norm = (s: any) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
          const els = Array.from(
            document.querySelectorAll('a, button, input[type="button"], input[type="submit"], [role="button"], li, span, td')
          ) as HTMLElement[];
          for (const t of textos) {
            const tl = norm(t);
            const el = els.find((e) => {
              const blob = norm(
                (e.textContent || "") + " " + ((e as HTMLInputElement).value || "") + " " + (e.getAttribute("onclick") || "")
              );
              return blob.includes(tl);
            });
            if (el) {
              let n: HTMLElement | null = el;
              for (let i = 0; i < 4 && n; i++) {
                if (n.tagName === "A" || n.tagName === "BUTTON" || n.tagName === "INPUT" || n.getAttribute("onclick")) {
                  n.click();
                  return t;
                }
                n = n.parentElement;
              }
              el.click();
              return t;
            }
          }
          return null;
        }, textos)
        .catch(() => null);
      if (hit) return hit;
    }
  }
  return null;
}

/** Vuelca los enlaces/menús visibles (para calibrar la navegación). */
async function dumpMenus(ctx: any) {
  const out: any[] = [];
  for (const pg of ctx.pages()) {
    for (const fr of pg.frames()) {
      const items = await fr
        .evaluate(() => {
          return (Array.from(document.querySelectorAll("a,button,[role=button]")) as HTMLElement[])
            .map((e) => ({
              t: (e.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60),
              oc: (e.getAttribute("onclick") || "").slice(0, 120),
            }))
            .filter((x) => x.t || x.oc)
            .slice(0, 60);
        })
        .catch(() => []);
      if (items.length) out.push({ url: (fr.url() || "").slice(0, 90), items });
    }
  }
  return out;
}

/** Clic por texto con reintentos (espera a que cargue el marco de contenido). */
async function clicTextoEspera(ctx: any, page: any, textos: string[], intentos = 6, esperaMs = 1500): Promise<string | null> {
  for (let i = 0; i < intentos; i++) {
    const hit = await clicTexto(ctx, textos);
    if (hit) return hit;
    await page.waitForTimeout(esperaMs);
  }
  return null;
}

/** Clic NATIVO de Playwright (evento real) — necesario para menús con
 * manejadores JS (addEventListener), que no responden a el.click() sintético. */
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
          } catch {
            /* siguiente */
          }
        }
      }
    }
  }
  return null;
}

async function clicNativoEspera(ctx: any, page: any, textos: string[], intentos = 8, esperaMs = 2000): Promise<string | null> {
  for (let i = 0; i < intentos; i++) {
    const hit = await clicNativo(ctx, textos);
    if (hit) return hit;
    await page.waitForTimeout(esperaMs);
  }
  return null;
}

/** Selecciona en un <select> la opción cuyo texto/valor contenga alguno de los textos. */
async function seleccionarOpcion(ctx: any, textos: string[]): Promise<string | null> {
  for (const pg of ctx.pages()) {
    for (const fr of pg.frames()) {
      const hit = await fr
        .evaluate((textos: string[]) => {
          const norm = (s: any) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
          const selects = Array.from(document.querySelectorAll("select")) as HTMLSelectElement[];
          for (const sel of selects) {
            for (const opt of Array.from(sel.options)) {
              const blob = norm(opt.textContent) + " " + norm(opt.value);
              if (textos.some((t) => blob.includes(norm(t)))) {
                sel.value = opt.value;
                sel.dispatchEvent(new Event("change", { bubbles: true }));
                return opt.textContent || opt.value;
              }
            }
          }
          return null;
        }, textos)
        .catch(() => null);
      if (hit) return hit;
    }
  }
  return null;
}

/** Vuelca formularios (selects con opciones, inputs radio, botones) para calibrar. */
async function dumpFormularios(ctx: any) {
  const out: any[] = [];
  for (const pg of ctx.pages()) {
    for (const fr of pg.frames()) {
      const info = await fr
        .evaluate(() => {
          const selects = (Array.from(document.querySelectorAll("select")) as HTMLSelectElement[]).map((s) => ({
            name: s.name || s.id,
            opciones: Array.from(s.options).map((o) => (o.textContent || "").trim()).slice(0, 12),
          }));
          const radios = (Array.from(document.querySelectorAll('input[type=radio]')) as HTMLInputElement[]).map((r) => ({
            name: r.name, value: r.value, label: (r.closest("label")?.textContent || r.parentElement?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40),
          }));
          const botones = (Array.from(document.querySelectorAll('button, input[type=button], input[type=submit], a')) as HTMLElement[])
            .map((b) => ((b as HTMLInputElement).value || b.textContent || "").replace(/\s+/g, " ").trim())
            .filter((t) => t).slice(0, 30);
          return { selects, radios, botones };
        })
        .catch(() => null);
      if (info && (info.selects.length || info.radios.length || info.botones.length)) {
        out.push({ url: (fr.url() || "").slice(0, 90), ...info });
      }
    }
  }
  return out;
}

/** Clic por texto DENTRO de un frame concreto. */
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

/** Cierra la campaña "valida tus datos" dentro de SU frame (Continuar sin confirmar). */
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

/** Diagnóstico dirigido: enlaces de fraccionamiento/deuda (onclick completo) y marcos. */
async function dumpFracc(ctx: any) {
  const re = /fracc|deuda|art\.?\s*36|pedido|elaborar|tesoro|generar|esessalud|essalud/i;
  const marcos: string[] = [];
  const enlaces: { frame: string; t: string; oc: string }[] = [];
  for (const pg of ctx.pages()) {
    for (const fr of pg.frames()) {
      marcos.push((fr.url() || "").slice(0, 110));
      const items = await fr
        .evaluate(
          (reSrc: string) => {
            const re = new RegExp(reSrc, "i");
            return (Array.from(document.querySelectorAll("a,button,[role=button],input")) as HTMLElement[])
              .map((e) => ({
                t: (e.textContent || (e as HTMLInputElement).value || "").replace(/\s+/g, " ").trim().slice(0, 70),
                oc: (e.getAttribute("onclick") || (e as HTMLInputElement).value || "").slice(0, 200),
              }))
              .filter((x) => re.test(x.t) || re.test(x.oc))
              .slice(0, 40);
          },
          re.source
        )
        .catch(() => []);
      for (const it of items) enlaces.push({ frame: (fr.url() || "").slice(0, 60), ...it });
    }
  }
  return { marcos, enlaces };
}

/** Inspecciona el elemento CLICKABLE más interno de cada texto (el enlace real). */
async function inspeccionar(ctx: any, textos: string[]) {
  const out: any[] = [];
  for (const pg of ctx.pages()) {
    for (const fr of pg.frames()) {
      const found = await fr
        .evaluate((textos: string[]) => {
          const norm = (s: any) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
          const res: any[] = [];
          for (const t of textos) {
            const cands = (Array.from(document.querySelectorAll("a,[onclick],[href]")) as HTMLElement[]).filter((e) =>
              norm(e.textContent).includes(norm(t))
            );
            // el más interno = el de texto más corto
            cands.sort((a, b) => (a.textContent || "").length - (b.textContent || "").length);
            const el = cands[0];
            if (el) {
              res.push({
                t,
                tag: el.tagName,
                onclick: (el.getAttribute("onclick") || "").slice(0, 240),
                href: (el.getAttribute("href") || "").slice(0, 240),
                txt: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60),
              });
            } else {
              res.push({ t, found: false });
            }
          }
          return res;
        }, textos)
        .catch(() => []);
      out.push(...(found as any[]));
    }
  }
  const seen = new Set<string>();
  return out.filter((x) => { const k = x.t + (x.onclick || "") + (x.href || ""); if (seen.has(k)) return false; seen.add(k); return true; });
}

/** Vuelca TODOS los enlaces del menú con onclick ejecuta(...code=X) para mapear. */
async function dumpEjecuta(ctx: any) {
  const out: { t: string; oc: string }[] = [];
  for (const pg of ctx.pages()) {
    for (const fr of pg.frames()) {
      const items = await fr
        .evaluate(() =>
          (Array.from(document.querySelectorAll("a,[onclick]")) as HTMLElement[])
            .map((e) => ({
              t: (e.textContent || "").replace(/\s+/g, " ").trim().slice(0, 70),
              oc: (e.getAttribute("onclick") || "").slice(0, 220),
            }))
            .filter((x) => /ejecuta\(|iconexecute/i.test(x.oc))
            .slice(0, 250)
        )
        .catch(() => []);
      out.push(...(items as any[]));
    }
  }
  const seen = new Set<string>();
  return out.filter((x) => {
    const k = x.t + x.oc;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

async function loginSol(params: FraccParams, pasos: any[]) {
  const browser = await lanzarNavegador();
  const ctx = await browser.newContext({
    acceptDownloads: true,
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  });
  autoAceptarDialogos(ctx);
  const page = await ctx.newPage();
  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
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
  await cerrarPantallas(ctx, page);
  // ¿El login fue rechazado? (bloqueo temporal por muchos intentos = "spam").
  const url = page.url();
  const texto = (await page.evaluate(() => (document.body?.innerText || "").slice(0, 300)).catch(() => "")) as string;
  const loginError = /oauth2\/error|autenticamenuinternet|problema en la aplicaci|no podemos atenderlo/i.test(url + " " + texto);
  pasos.push({ paso: "login", url, loginError });
  return { browser, ctx, page, loginError };
}

const MSG_LOGIN_ERROR =
  "SUNAT rechazó el inicio de sesión (bloqueo temporal por varios intentos seguidos). Espera ~10 minutos y reintenta una sola vez.";

/** Clic en el ENLACE REAL del menú (onclick ejecuta/iconExecute) por su texto. */
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

/** Navega por el menú hasta Fracc Art 36 (por texto, con reintentos). */
async function irAFraccArt36(ctx: any, page: any, pasos: any[]) {
  const ruta = [
    ["Mi fraccionamiento", "MI FRACCIONAMIENTO", "Fraccionamiento"],
    ["Solicito fraccionamiento art.36", "Solicito fraccionamiento art. 36", "Solicito fraccionamiento"],
    ["Fracc Art 36", "Fracc. Art 36", "Fracc Art. 36"],
  ];
  const hechos: any[] = [];
  for (const opciones of ruta) {
    await cerrarPantallas(ctx, page);
    const hit = await clicNativoEspera(ctx, page, opciones, 5, 1200);
    await page.waitForTimeout(2000);
    hechos.push({ buscaba: opciones[0], clico: hit });
  }
  pasos.push({ paso: "navegar-fracc", hechos });
}

// ---- FASE 1: generar pedido de deuda ---------------------------------------
export async function generarPedidoDeuda(params: FraccParams): Promise<FraccResultado> {
  const { ruc, solUser, solPass } = params;
  if (!/^\d{11}$/.test(ruc)) return { ok: false, error: "RUC inválido." };
  if (!solUser || !solPass) return { ok: false, error: "Ingresa el Usuario y la Clave SOL." };
  const diagnostico = params.diagnostico === true;
  const pasos: any[] = [];
  let browser: any = null;
  try {
    const s = await loginSol(params, pasos);
    browser = s.browser;
    if (s.loginError) return { ok: false, error: MSG_LOGIN_ERROR, diag: { pasos } };
    await cerrarPantallas(s.ctx, s.page);
    if (diagnostico) {
      pasos.push({ paso: "fracc-inicio", ...(await dumpFracc(s.ctx)) });
      pasos.push({ paso: "menu-completo", links: await dumpEjecuta(s.ctx) });
    }

    await irAFraccArt36(s.ctx, s.page, pasos);
    // "Generación de pedido de deuda"
    const gp = await clicTextoEspera(s.ctx, s.page, ["Generación de pedido de deuda", "Generacion de pedido de deuda"], 6, 1500);
    await s.page.waitForTimeout(3000);
    await cerrarPantallas(s.ctx, s.page);
    pasos.push({ paso: "generacion-pedido", clico: gp });
    if (diagnostico) pasos.push({ paso: "fracc-tras-generacion", ...(await dumpFracc(s.ctx)) });

    // Vuelca el formulario para ver cómo elegir Entidad y el botón real.
    pasos.push({ paso: "form-generacion", formularios: await dumpFormularios(s.ctx) });

    // Entidad = TESORO: primero como opción de <select>, luego como radio/enlace.
    let tesoro: string | null = await seleccionarOpcion(s.ctx, ["Tesoro", "TESORO"]);
    if (!tesoro) tesoro = await clicTexto(s.ctx, ["Tesoro", "TESORO"]);
    await s.page.waitForTimeout(1200);
    pasos.push({ paso: "tesoro", elegido: tesoro });

    // Generar / enviar la solicitud (varias etiquetas posibles).
    const env = await clicTextoEspera(
      s.ctx, s.page,
      ["Generar Pedido", "Generar pedido", "Generar", "Enviar solicitud", "Enviar", "Grabar", "Aceptar", "Continuar"],
      4, 1200
    );
    await s.page.waitForTimeout(3500);
    await cerrarPantallas(s.ctx, s.page);
    pasos.push({ paso: "enviar", clico: env });

    // Vuelca el resultado (mensaje de confirmación / nº de pedido).
    pasos.push({ paso: "resultado", formularios: await dumpFormularios(s.ctx) });

    return {
      ok: Boolean(gp && env),
      mensaje:
        gp && env
          ? "Pedido de deuda enviado (Tesoro). Espera ~5 minutos y usa “Consultar y extraer”."
          : "No pude completar la generación. Revisa el diagnóstico (form-generacion) para calibrar.",
      diag: { pasos },
    };
  } catch (err) {
    pasos.push({ paso: "error", respuesta: err instanceof Error ? err.message : String(err) });
    return { ok: false, error: err instanceof Error ? err.message : String(err), diag: { pasos } };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

// ---- FASE 2: consultar estado y extraer las deudas -------------------------
// Cada pestaña con un texto DISTINTIVO para ubicar su tab.
const PESTANAS_DEF = [
  { label: "Valores", match: "Valores" },
  { label: "Deudas Autoliquidadas/Reliquidadas", match: "Autoliquidadas" },
  { label: "Otras Deudas", match: "Otras Deudas" },
  { label: "Deudas no Acogibles", match: "Acogibles" },
];

/** Cambia de pestaña usando la API de dojo (dijit TabContainer.selectChild). */
async function seleccionarPaneDijit(ctx: any, index: number): Promise<boolean> {
  for (const pg of ctx.pages()) {
    for (const fr of pg.frames()) {
      const ok = await fr
        .evaluate((idx: number) => {
          const dj: any = (window as any).dijit;
          if (!dj || !dj.registry) return false;
          let tc: any = null;
          dj.registry.forEach((w: any) => {
            if (w && w.declaredClass && /TabContainer/.test(w.declaredClass)) tc = w;
          });
          if (!tc || typeof tc.getChildren !== "function") return false;
          const kids = tc.getChildren();
          if (!kids[idx]) return false;
          try { tc.selectChild(kids[idx]); return true; } catch { return false; }
        }, index)
        .catch(() => false);
      if (ok) return true;
    }
  }
  return false;
}

/** Clic en una PESTAÑA del form F36 (dojo dijitTab) por su texto distintivo.
 *  Clic NATIVO sobre el .dijitTab para que dispare el cambio de panel de dijit. */
async function clicPestana(ctx: any, match: string): Promise<boolean> {
  for (const pg of ctx.pages()) {
    for (const fr of pg.frames()) {
      const candidatos = [
        fr.locator(".dijitTab").filter({ hasText: match }),
        fr.getByRole("tab", { name: match }),
        fr.locator("span.tabLabel", { hasText: match }),
      ];
      for (const loc of candidatos) {
        try {
          const el = loc.first();
          if ((await el.count()) === 0) continue;
          await el.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => {});
          await el.click({ timeout: 5000 }); // clic real (no force): dijit lo necesita
          return true;
        } catch {
          try {
            await loc.first().click({ timeout: 3000, force: true });
            return true;
          } catch {
            /* siguiente candidato */
          }
        }
      }
    }
  }
  return false;
}

/** Detecta la pantalla "La aplicación ha retornado el siguiente mensaje" y
 *  copia el mensaje (el texto en rojo) + la acción a realizar. */
async function detectarMensajeApp(ctx: any): Promise<{ mensaje: string; accion: string } | null> {
  for (const pg of ctx.pages()) {
    for (const fr of pg.frames()) {
      const m = await fr
        .evaluate(() => {
          const norm = (s: any) => String(s || "").replace(/\s+/g, " ").trim();
          const body = document.body?.innerText || "";
          if (!/aplicaci[oó]n ha retornado el siguiente mensaje/i.test(body)) return null;
          // Texto en ROJO (font[color], style color rojo, o computed rojizo).
          let rojo = "";
          const cands = Array.from(document.querySelectorAll('font, b, strong, span, td, div, p')) as HTMLElement[];
          for (const e of cands) {
            const attr = (e.getAttribute("color") || "") + " " + (e.getAttribute("style") || "");
            let esRojo = /red|#f00|#ff0000|rgb\(2/i.test(attr);
            if (!esRojo) {
              try {
                const c = getComputedStyle(e).color || "";
                const mm = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
                if (mm && +mm[1] > 150 && +mm[2] < 90 && +mm[3] < 90) esRojo = true;
              } catch {}
            }
            const txt = norm(e.textContent);
            if (esRojo && txt && txt.length < 200 && !/aplicaci[oó]n ha retornado/i.test(txt)) { rojo = txt; break; }
          }
          if (!rojo) {
            const g = body.match(/siguiente mensaje\s*:?\s*([\s\S]*?)\s*Acci[oó]n a realizar/i);
            if (g) rojo = norm(g[1]);
          }
          const a = body.match(/Acci[oó]n a realizar\s*:?\s*([\s\S]*?)(?:Anterior|$)/i);
          return { mensaje: rojo, accion: a ? norm(a[1]) : "" };
        })
        .catch(() => null);
      if (m && m.mensaje) return m;
    }
  }
  return null;
}

/** Lee el GRID DE DEUDAS visible. La cabecera y los datos pueden estar en
 *  tablas separadas (grid dojo), así que toma las cabeceras del grid de deudas
 *  y las filas de cualquier tabla visible con datos de deuda. */
async function leerTablaVisible(ctx: any): Promise<{ headers: string[]; filas: string[][] } | null> {
  for (const pg of ctx.pages()) {
    for (const fr of pg.frames()) {
      const t = await fr
        .evaluate(() => {
          const norm = (s: any) => String(s || "").replace(/\s+/g, " ").trim();
          // visible = no oculto por display:none (panel de pestaña inactivo).
          const visible = (el: Element) => {
            const he = el as HTMLElement;
            if (he.offsetParent === null && he.tagName !== "BODY") return false;
            const r = he.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          };
          const esTecnico = (h: string) => /^[a-z][a-z0-9]*(_[a-z0-9]+)+$/.test(h) || /^(ind|cod|mto|num|fec|lst|pid)[A-Za-z0-9]*$/.test(h);
          const KW = ["periodo", "tributario", "valor", "deuda", "monto", "importe", "tributo", "resoluci"];
          // filas del encabezado de la solicitud (NO son deudas).
          const esJunk = (j: string) =>
            /(ruc\s*:|raz[oó]n social|n[uú]mero de proceso|fecha de pedido|entidad\s*:|c[oó]digo de pago|garant[ií]a|monto acogido \(s|total de registros|total valores)/i.test(j);
          const esDeuda = (tds: string[]) =>
            tds.some((c) => /^\d{1,2}\/\d{4}$/.test(c)) || /orden de pago|resoluci[oó]n|multa|liquidaci/i.test(tds.join(" "));

          // 1) Cabeceras del grid de deudas (del panel visible).
          let headers: string[] | null = null;
          for (const tb of Array.from(document.querySelectorAll("table")).filter(visible)) {
            let hs = Array.from(tb.querySelectorAll("thead th, thead td")).map((x) => norm(x.textContent));
            if (!hs.length) {
              const f0 = tb.querySelector("tr");
              if (f0) hs = Array.from(f0.querySelectorAll("th,td")).map((x) => norm(x.textContent));
            }
            hs = hs.filter((h) => h);
            const score = KW.reduce((a, k) => a + (hs.join(" ").toLowerCase().includes(k) ? 1 : 0), 0);
            if (score >= 3) { headers = hs; break; }
          }
          if (!headers) return null;
          const iTec = headers.findIndex(esTecnico);
          const nVis = iTec > 0 ? iTec : headers.length;
          const visHeaders = headers.slice(0, nVis);

          // 2) Filas de deuda del panel VISIBLE (excluye encabezado y form).
          const filas: string[][] = [];
          const seen = new Set<string>();
          for (const tr of Array.from(document.querySelectorAll("tr"))) {
            if (!visible(tr)) continue;
            const tds = Array.from(tr.querySelectorAll("td")).map((td) => norm(td.textContent));
            if (tds.filter((c) => c).length < 2) continue;
            const joined = tds.join(" ");
            if (esJunk(joined) || !esDeuda(tds)) continue;
            const fila = tds.slice(0, nVis);
            const key = fila.join("|");
            if (seen.has(key)) continue;
            seen.add(key);
            filas.push(fila);
          }
          return { headers: visHeaders, filas };
        })
        .catch(() => null);
      if (t && t.headers.length) return t;
    }
  }
  return null;
}

export async function extraerDeudasF36(params: FraccParams): Promise<FraccResultado> {
  const { ruc, solUser, solPass } = params;
  if (!/^\d{11}$/.test(ruc)) return { ok: false, error: "RUC inválido." };
  if (!solUser || !solPass) return { ok: false, error: "Ingresa el Usuario y la Clave SOL." };
  const diagnostico = params.diagnostico === true;
  const pasos: any[] = [];
  let browser: any = null;
  try {
    const s = await loginSol(params, pasos);
    browser = s.browser;
    if (s.loginError) return { ok: false, error: MSG_LOGIN_ERROR, diag: { pasos } };
    await cerrarPantallas(s.ctx, s.page);

    const tieneTexto = async (re: RegExp) => {
      for (const pg of s.ctx.pages())
        for (const fr of pg.frames()) {
          const ok = await fr.evaluate((src: string) => new RegExp(src, "i").test(document.body?.innerText || ""), re.source).catch(() => false);
          if (ok) return true;
        }
      return false;
    };

    // Navega el árbol del menú: Mi fraccionamiento → Solicito art.36 → Fracc Art 36.
    await irAFraccArt36(s.ctx, s.page, pasos);
    // Clic POR TEXTO en "Consulta estado de pedido de deuda" (abre ventana/pestaña
    // nueva con la tabla de pedidos). El menú nuevo no usa onclick=ejecuta.
    const ce = await clicNativoEspera(
      s.ctx, s.page,
      ["Consulta estado de pedido de deuda", "Consulta estado de pedido"],
      6, 1500
    );
    pasos.push({ paso: "abrir-consulta", clico: ce });

    // "Elaborar Solicitud" solo existe cuando la tabla de pedidos ya cargó, así
    // que reintentar clicarlo SIRVE de espera y de acción a la vez (fila 1).
    const elab = await clicNativoEspera(s.ctx, s.page, ["Elaborar Solicitud", "Elaborar solicitud"], 14, 2500);
    await s.page.waitForTimeout(5000);
    await cerrarPantallas(s.ctx, s.page);
    pasos.push({ paso: "elaborar-solicitud", clico: elab });

    // Diagnóstico COMPACTO: URLs de pestañas + el elemento real del menú.
    if (diagnostico) {
      const urls = s.ctx.pages().map((p: any) => p.url().slice(0, 95));
      const insp = await inspeccionar(s.ctx, [
        "Mi fraccionamiento",
        "Solicito fraccionamiento art.36",
        "Fracc Art 36",
        "Consulta estado de pedido de deuda",
        "Elaborar Solicitud",
      ]);
      pasos.push({ paso: "inspeccion", urls, elementos: insp });

      // Inspección de los TABS (estructura real para clicarlos).
      const tabsInfo: any[] = [];
      for (const pg of s.ctx.pages()) {
        for (const fr of pg.frames()) {
          const f = await fr
            .evaluate((labels: string[]) => {
              const norm = (s: any) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
              const res: any[] = [];
              for (const t of labels) {
                const el = (Array.from(document.querySelectorAll("*")) as HTMLElement[]).find(
                  (e) => e.children.length === 0 && norm(e.textContent) === norm(t)
                );
                if (el) {
                  res.push({
                    t,
                    tag: el.tagName,
                    cls: (el.className || "").toString().slice(0, 50),
                    role: el.getAttribute("role") || el.parentElement?.getAttribute("role") || "",
                    pTag: el.parentElement?.tagName || "",
                    pCls: (el.parentElement?.className || "").toString().slice(0, 50),
                  });
                }
              }
              return res;
            }, ["Valores", "Deudas Autoliquidadas/Reliquidadas", "Otras Deudas", "Deudas no Acogibles"])
            .catch(() => []);
          if ((f as any[]).length) tabsInfo.push({ url: fr.url().slice(0, 60), tabs: f });
        }
      }
      pasos.push({ paso: "tabs", info: tabsInfo });
    }

    // ¿SUNAT mostró un mensaje de bloqueo? (p.ej. "Tiene deuda pendiente por Perdida").
    const msgApp = await detectarMensajeApp(s.ctx);
    if (msgApp) {
      return {
        ok: true,
        tablas: [],
        nota: msgApp.mensaje,
        mensaje: `⚠ SUNAT: ${msgApp.mensaje}${msgApp.accion ? " — " + msgApp.accion : ""}`,
        diag: { pasos },
      };
    }

    if (!(await tieneTexto(/valores|acogibles/i))) {
      // ¿Llegamos a la consulta pero NO hay solicitud pendiente? = sin deudas.
      const consultaOk = await tieneTexto(/pedidos efectuados|acci[oó]n a seguir|estado actual/i);
      const hayPendiente = await tieneTexto(/pendiente de elaborar/i);
      if (consultaOk && !hayPendiente) {
        return {
          ok: true,
          tablas: [],
          mensaje: "Esta empresa no cuenta con deudas pendientes de acoger al fraccionamiento (no hay solicitud pendiente de elaborar).",
          diag: { pasos },
        };
      }
      return {
        ok: false,
        error:
          "No se pudo abrir el formulario de deudas. Si la empresa no tiene un pedido “Pendiente de Elaborar Solicitud”, no hay deudas que mostrar; si lo tiene, reintenta en unos minutos. (Revisa el diagnóstico.)",
        diag: { pasos },
      };
    }

    // Leer cada pestaña: clicarla y esperar a que el cuadro CAMBIE antes de leer.
    const tablas: TablaDeuda[] = [];
    let prevSig = "__inicio__";
    const firma = (t: any) => (t?.filas ?? []).map((f: string[]) => f.join("|")).join("§");
    for (let idx = 0; idx < PESTANAS_DEF.length; idx++) {
      const pd = PESTANAS_DEF[idx];
      // Cambia de panel por la API de dojo (lo más confiable); si no, clic.
      const porApi = await seleccionarPaneDijit(s.ctx, idx);
      const clicado = porApi || (await clicPestana(s.ctx, pd.match));
      let t: any = null;
      for (let i = 0; i < 12; i++) {
        await s.page.waitForTimeout(1500);
        t = await leerTablaVisible(s.ctx);
        if (firma(t) !== prevSig) break; // el grid ya se actualizó (o quedó vacío)
      }
      prevSig = firma(t);
      tablas.push({ pestana: pd.label, headers: t?.headers ?? [], filas: t?.filas ?? [] });
      pasos.push({ paso: "pestana", nombre: pd.label, via: porApi ? "dojo" : clicado ? "clic" : "no", filas: t?.filas?.length ?? 0 });
    }

    return {
      ok: tablas.some((t) => t.filas.length > 0),
      tablas,
      mensaje: `Extraídas ${tablas.reduce((a, t) => a + t.filas.length, 0)} fila(s) en ${tablas.length} pestaña(s).`,
      diag: { pasos },
    };
  } catch (err) {
    pasos.push({ paso: "error", respuesta: err instanceof Error ? err.message : String(err) });
    return { ok: false, error: err instanceof Error ? err.message : String(err), diag: { pasos } };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}
