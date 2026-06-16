import type { BuzonMensaje, BuzonResultado } from "./types";

// ============================================================
//  Buzón electrónico SUNAT (vía portal SOL con navegador Playwright)
// ============================================================
// El buzón NO tiene API pública: vive en el portal web SOL (ww1.sunat.gob.pe)
// con sesión por cookies y anti-bot. Por eso se lee con un navegador headless:
//   1) login en SOL (RUC + usuario + clave)
//   2) fetch del endpoint interno listNotiMenPag (devuelve la lista en JSON)
//   3) se extrae asunto, fecha y categoría; se resaltan cobranza/valores.
//
// Todo es configurable por entorno y hay MODO DIAGNÓSTICO que registra cada paso
// (URL, título, estado, fragmento de respuesta) para calibrar selectores/rutas.

export interface BuzonParams {
  ruc: string;
  solUser: string;
  solPass: string;
  dias?: number;
  diagnostico?: boolean;
  // clientId/secret no se usan aquí (el scraping no usa OAuth), se aceptan y se ignoran.
  clientId?: string;
  clientSecret?: string;
}

const LOGIN_URL =
  process.env.BUZON_LOGIN_URL ??
  "https://e-menu.sunat.gob.pe/cl-ti-itmenu/MenuInternet.htm?exe=01.04.00.00.000000";
const VISOR_URL =
  process.env.BUZON_VISOR_URL ??
  "https://ww1.sunat.gob.pe/ol-ti-itvisornoti/visor/MenuVisorNotificacion.htm";
const LIST_URL =
  process.env.BUZON_LIST_URL ??
  "https://ww1.sunat.gob.pe/ol-ti-itvisornoti/visor/listNotiMenPag?tipoMsj=2&numpag=1&perpag=50";

const URGENTES = [
  "cobranza coactiva", "ejecución coactiva", "ejecucion coactiva",
  "resolución de ejecución", "resolucion de ejecucion", "orden de pago",
  "resolución de determinación", "resolucion de determinacion",
  "resolución de multa", "resolucion de multa", "valor", "embargo",
  "medida cautelar", "esquela", "requerimiento",
];

function esUrgente(texto: string): boolean {
  const t = (texto || "").toLowerCase();
  return URGENTES.some((k) => t.includes(k));
}

async function rellenar(page: any, selectores: string[], valor: string): Promise<boolean> {
  for (const sel of selectores) {
    try {
      const el = await page.$(sel);
      if (el) {
        await el.fill(valor);
        return true;
      }
    } catch {}
  }
  return false;
}

async function clickAny(page: any, selectores: string[]): Promise<boolean> {
  for (const sel of selectores) {
    try {
      const el = await page.$(sel);
      if (el) {
        await el.click();
        return true;
      }
    } catch {}
  }
  return false;
}

function mapearMensajes(body: string): BuzonMensaje[] {
  let data: any;
  try {
    data = JSON.parse(body);
  } catch {
    return [];
  }
  const arr: any[] = Array.isArray(data)
    ? data
    : data?.lista ?? data?.mensajes ?? data?.registros ?? data?.rows ?? data?.data ?? [];
  return arr.map((m, i) => {
    const asunto = String(m.asunto ?? m.txtAsunto ?? m.subject ?? m.titulo ?? m.descripcion ?? "");
    const fecha = String(m.fecVigencia ?? m.fechaEnvio ?? m.fecha ?? m.fecPublica ?? m.fecNotificacion ?? "");
    const tipo = String(m.tipoMensaje ?? m.desTipoMensaje ?? m.tipo ?? m.categoria ?? m.codCarpeta ?? "");
    return {
      id: String(m.codMensaje ?? m.numMensaje ?? m.id ?? i),
      fecha,
      asunto,
      tipo,
      urgente: esUrgente(`${asunto} ${tipo}`),
      leido: Boolean(m.indLeido ?? m.leido ?? false),
    };
  });
}

async function lanzarNavegador() {
  const { chromium } = await import("playwright-core");
  return chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });
}

export async function consultarBuzon(params: BuzonParams): Promise<BuzonResultado> {
  const { ruc, solUser, solPass } = params;
  if (!/^\d{11}$/.test(ruc)) throw new Error("RUC inválido.");
  if (!solUser || !solPass) throw new Error("Ingresa el Usuario SOL y la Clave SOL.");

  const pasos: any[] = [];
  const diagnostico = params.diagnostico === true;
  let browser: any = null;

  try {
    browser = await lanzarNavegador();
    const ctx = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    });
    const page = await ctx.newPage();

    await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(2500);
    pasos.push({ paso: "login-page", url: page.url(), title: await page.title().catch(() => "") });

    const okRuc = await rellenar(page, ["#txtRuc", 'input[name="ruc"]', 'input[formcontrolname="ruc"]', '#ruc'], ruc);
    const okUser = await rellenar(page, ["#txtUsuario", 'input[name="usuario"]', 'input[formcontrolname="usuario"]', '#usuario'], solUser);
    const okPass = await rellenar(page, ["#txtContrasena", 'input[type="password"]', 'input[formcontrolname="password"]', '#password'], solPass);
    pasos.push({ paso: "credenciales", rucOk: okRuc, userOk: okUser, passOk: okPass });

    await clickAny(page, ["#btnAceptar", 'button[type="submit"]', 'button:has-text("Iniciar")', 'button:has-text("Aceptar")', 'input[type="submit"]']);
    await page.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(3000);
    const cuerpoLogin = (await page.evaluate(() => document.body?.innerText ?? "").catch(() => "")) as string;
    pasos.push({
      paso: "post-login",
      url: page.url(),
      title: await page.title().catch(() => ""),
      textoVisible: cuerpoLogin.slice(0, 300),
    });

    // Abrir el visor de notificaciones para establecer su sesión.
    await page.goto(VISOR_URL, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(2000);
    pasos.push({ paso: "visor", url: page.url(), title: await page.title().catch(() => "") });

    // Llamar al endpoint interno de la lista (misma origin = sin CORS).
    const resp = (await page.evaluate(async (url: string) => {
      try {
        const r = await fetch(url, { credentials: "include" });
        return { status: r.status, body: (await r.text()).slice(0, 4000) };
      } catch (e) {
        return { status: 0, body: String(e) };
      }
    }, LIST_URL)) as { status: number; body: string };
    pasos.push({ paso: "listNotiMenPag", status: resp.status, respuesta: resp.body.slice(0, 800) });

    if (diagnostico) {
      return { mensajes: [], urgentes: [], diag: { pasos } };
    }

    if (resp.status !== 200) {
      throw new Error(`No se pudo leer el buzón (estado ${resp.status}). Posible bloqueo o sesión.`);
    }
    const mensajes = mapearMensajes(resp.body);
    const urgentes = mensajes.filter((m) => m.urgente);
    return { mensajes, urgentes };
  } catch (err) {
    if (diagnostico) {
      pasos.push({ paso: "error", respuesta: err instanceof Error ? err.message : String(err) });
      return { mensajes: [], urgentes: [], diag: { pasos } };
    }
    throw new Error(
      `Buzón: ${err instanceof Error ? err.message : String(err)} (usa Modo diagnóstico para más detalle)`
    );
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}
