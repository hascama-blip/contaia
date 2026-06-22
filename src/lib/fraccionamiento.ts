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
    const hit = await clicTextoEspera(ctx, page, opciones, 5, 1200);
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
const PESTANAS = ["Valores", "Deudas Autoliquidadas/Reliquidadas", "Otras Deudas", "Deudas no Acogibles"];

/** Lee la tabla actualmente visible en cualquier frame (cabeceras + filas). */
async function leerTablaVisible(ctx: any): Promise<{ headers: string[]; filas: string[][] } | null> {
  for (const pg of ctx.pages()) {
    for (const fr of pg.frames()) {
      const t = await fr
        .evaluate(() => {
          const visible = (el: Element) => {
            const r = (el as HTMLElement).getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          };
          const tablas = Array.from(document.querySelectorAll("table")).filter(visible);
          // elige la tabla visible con más filas de datos
          let best: { headers: string[]; filas: string[][] } | null = null;
          for (const tb of tablas) {
            const ths = Array.from(tb.querySelectorAll("thead th, tr th")).map((x) => (x.textContent || "").replace(/\s+/g, " ").trim());
            const trs = Array.from(tb.querySelectorAll("tbody tr")).length
              ? Array.from(tb.querySelectorAll("tbody tr"))
              : Array.from(tb.querySelectorAll("tr"));
            const filas = trs
              .map((tr) => Array.from(tr.querySelectorAll("td")).map((td) => (td.textContent || "").replace(/\s+/g, " ").trim()))
              .filter((f) => f.length && f.some((c) => c));
            if (filas.length && (!best || filas.length > best.filas.length)) best = { headers: ths, filas };
          }
          return best;
        })
        .catch(() => null);
      if (t && t.filas.length) return t;
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
    const ce = await clicTextoEspera(
      s.ctx, s.page,
      ["Consulta estado de pedido de deuda", "Consulta estado de pedido"],
      6, 1500
    );
    pasos.push({ paso: "abrir-consulta", clico: ce });

    // Esperar la página de "Pedidos Efectuados" (tabla con "Elaborar Solicitud").
    for (let i = 0; i < 14; i++) {
      if (await tieneTexto(/elaborar|pedidos efectuados|estado actual|acci[oó]n a seguir/i)) break;
      await s.page.waitForTimeout(2000);
    }
    await cerrarPantallas(s.ctx, s.page);
    pasos.push({ paso: "consulta-cargada", ok: await tieneTexto(/elaborar|pedidos efectuados/i) });

    // Fila 1 → "Elaborar Solicitud" (abre el form con las 4 pestañas).
    if (await tieneTexto(/elaborar|estado actual|acci[oó]n a seguir/i)) {
      const elab = await clicTextoEspera(s.ctx, s.page, ["Elaborar Solicitud", "Elaborar solicitud"], 8, 2000);
      await s.page.waitForTimeout(5000);
      await cerrarPantallas(s.ctx, s.page);
      pasos.push({ paso: "elaborar-solicitud", clico: elab });
    }

    if (diagnostico) pasos.push({ paso: "fracc-pagina", ...(await dumpFracc(s.ctx)) });

    if (!(await tieneTexto(/valores|acogibles/i))) {
      return {
        ok: false,
        error:
          "Entré pero no veo el formulario con las pestañas de deudas. Revisa el diagnóstico (abrir-consulta/consulta-cargada/fracc-pagina).",
        diag: { pasos },
      };
    }

    // Leer cada pestaña.
    const tablas: TablaDeuda[] = [];
    for (const p of PESTANAS) {
      await clicTexto(s.ctx, [p]);
      await s.page.waitForTimeout(1800);
      const t = await leerTablaVisible(s.ctx);
      tablas.push({ pestana: p, headers: t?.headers ?? [], filas: t?.filas ?? [] });
      pasos.push({ paso: "pestana", nombre: p, filas: t?.filas.length ?? 0, headers: t?.headers ?? [] });
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
