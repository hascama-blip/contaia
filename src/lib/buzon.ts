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
  "https://ww1.sunat.gob.pe/ol-ti-itvisornoti/visor/listNotiMenPag?tipoMsj=2&codCarpeta=00&codEtiqueta=&page=1&des_asunto=&codMensaje=&tipoOrden=NADA";

// Endpoints para DESCARGAR el adjunto (PDF) de un mensaje. Son CALIBRABLES: el
// detalle del mensaje suele traer el/los archivo(s) o un id para bajarlos. Si
// SUNAT cambia la ruta, se ajusta por variable de entorno (igual que los demás).
// Endpoint REAL del visor para bajar el adjunto (confirmado por DevTools):
//   POST .../visor/bajarArchivo  con form: accion=archivo, idMensaje, idArchivo,
//   sistema=0, indMensaje=5.
const BAJAR_URL =
  process.env.BUZON_BAJAR_URL ??
  "https://ww1.sunat.gob.pe/ol-ti-itvisornoti/visor/bajarArchivo";
// Lista los adjuntos de un mensaje (de ahí sale idArchivo). Descubierto en el
// JS del visor: listArchivosAdjuntos.
const ARCHIVOS_URL =
  process.env.BUZON_ARCHIVOS_URL ??
  "https://ww1.sunat.gob.pe/ol-ti-itvisornoti/visor/listArchivosAdjuntos";
// Endpoint que devuelve el detalle del mensaje. CALIBRABLE.
const DETALLE_URL =
  process.env.BUZON_DETALLE_URL ??
  "https://ww1.sunat.gob.pe/ol-ti-itvisornoti/visor/detalleMensaje";

const URGENTES = [
  "cobranza coactiva", "ejecución coactiva", "ejecucion coactiva",
  "resolución coactiva", "resolucion coactiva", "coactiv",
  "resolución de ejecución", "resolucion de ejecucion", "orden de pago",
  "resolución de determinación", "resolucion de determinacion",
  "resolución de multa", "resolucion de multa", "valor", "embargo",
  "medida cautelar", "esquela", "requerimiento",
];

function esUrgente(texto: string): boolean {
  const t = (texto || "").toLowerCase();
  return URGENTES.some((k) => t.includes(k));
}

/** Clasifica el asunto en categoría y nivel de riesgo. */
function clasificar(asunto: string): { tipo: string; nivel: "peligroso" | "urgente" | "otro" } {
  const t = (asunto || "").toLowerCase();
  // MÁS PELIGROSO: fiscalización y no contenciosas.
  if (/fiscalizaci[oó]n|requerimiento|esquela|carta inductiva|carta n|auditor[ií]a|verificaci[oó]n/.test(t))
    return { tipo: "Fiscalización", nivel: "peligroso" };
  if (/no contenciosa|ingreso como recaudaci[oó]n|recaudaci[oó]n.*detracci|\brca\b|devoluci[oó]n|reintegro/.test(t))
    return { tipo: "No Contenciosa", nivel: "peligroso" };
  // URGENTE: cobranza y valores.
  if (/coactiv|ejecuci[oó]n|cobranza|embargo|medida cautelar/.test(t))
    return { tipo: "Resolución de Cobranza", nivel: "urgente" };
  if (/orden de pago|resoluci[oó]n de determinaci[oó]n|resoluci[oó]n de multa|valor/.test(t))
    return { tipo: "Valor", nivel: "urgente" };
  return { tipo: "", nivel: "otro" };
}

/** Parsea "dd/mm/yyyy [hh:mm:ss]" a Date. */
function parseFecha(s: string): Date | null {
  const m = (s || "").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
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

/** Clic por texto/valor SOLO en elementos clicables (evita contenedores). */
async function clickPorTextoEnContexto(
  contexto: any,
  textos: string[]
): Promise<string | null> {
  return await contexto
    .evaluate((textos: string[]) => {
      const clickables = Array.from(
        document.querySelectorAll(
          'button, a, input[type="button"], input[type="submit"], input[type="image"], [role="button"]'
        )
      ) as any[];
      for (const t of textos) {
        const tl = t.toLowerCase();
        const el = clickables.find((e) => {
          const partes = [
            e.textContent || "",
            e.value || "",
            e.getAttribute ? e.getAttribute("value") || "" : "",
            e.getAttribute ? e.getAttribute("title") || "" : "",
            e.getAttribute ? e.getAttribute("alt") || "" : "",
          ];
          return partes.join(" ").toLowerCase().includes(tl);
        });
        if (el) {
          (el as HTMLElement).click();
          return t;
        }
      }
      return null;
    }, textos)
    .catch(() => null);
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
    : data?.rows ?? data?.lista ?? data?.mensajes ?? data?.registros ?? data?.data ?? [];
  return arr.map((m, i) => {
    const asunto = String(m.desAsunto ?? m.asunto ?? m.txtAsunto ?? m.titulo ?? "")
      .replace(/^ASUNTO:\s*/i, "")
      .trim();
    // fecPublica/fecEnvio son la fecha de notificación; fecVigencia es a futuro.
    const fecha = String(m.fecPublica ?? m.fecEnvio ?? m.fecha ?? "");
    const { tipo, nivel } = clasificar(asunto);
    return {
      id: String(m.codMensaje ?? m.numMensaje ?? m.id ?? i),
      fecha,
      asunto,
      tipo,
      nivel,
      urgente: nivel !== "otro",
      leido: false,
    };
  });
}

async function lanzarNavegador() {
  const { chromium } = await import("playwright-core");
  // En Render (Node) usamos el Chromium de @sparticuz, que corre sin
  // dependencias del sistema. En local usa el Chromium instalado.
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
    /* fallback al Chromium local */
  }
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
  const dias = params.dias && params.dias > 0 ? params.dias : 15;
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

    // 1) Cerrar la campaña "VALIDA TUS DATOS DE CONTACTO" (clic JS dentro de su
    // iframe en los botones reales: "Finalizar" y "Continuar sin confirmar").
    let cerrarCampania = "";
    for (let intento = 0; intento < 5; intento++) {
      const camp = page
        .frames()
        .find((f: any) => /itadminforuc-modifdatos|campanha/i.test(f.url()));
      if (!camp) {
        cerrarCampania = intento === 0 ? "no-aparecio" : "cerrada";
        break;
      }
      const c1 = await clickPorTextoEnContexto(camp, ["Finalizar"]);
      await page.waitForTimeout(1500);
      const c2 = await clickPorTextoEnContexto(camp, [
        "Continuar sin confirmar",
        "Continuar",
      ]);
      await page.waitForTimeout(2200);
      cerrarCampania = `${c1 ?? "-"}/${c2 ?? "-"}`;
    }
    pasos.push({ paso: "cerrar-campania", resultado: cerrarCampania });

    // 2) Abrir el Buzón Electrónico — SOLO enlaces/botones (no contenedores).
    const clickBuzon = await page
      .evaluate(() => {
        const els = Array.from(
          document.querySelectorAll('a, button, [role="button"]')
        ) as HTMLElement[];
        const el = els.find((e) => {
          const txt = (e.textContent || "").trim().toLowerCase();
          const href = (e.getAttribute("href") || "").toLowerCase();
          const onclick = (e.getAttribute("onclick") || "").toLowerCase();
          return (
            /^buz[oó]n\s*electr/.test(txt) ||
            href.includes("visornoti") ||
            onclick.includes("visornoti") ||
            onclick.includes("buzon")
          );
        });
        if (el) {
          el.click();
          return (el.outerHTML || "").slice(0, 180);
        }
        return null;
      })
      .catch(() => null);

    // 3) Esperar a que aparezca el iframe/pestaña del visor (hasta ~24s).
    const buscarVisor = () => {
      for (const pg of ctx.pages())
        for (const fr of pg.frames())
          if (/ol-ti-itvisornoti/.test(fr.url())) return fr;
      return null;
    };
    let visor: any = null;
    for (let i = 0; i < 12 && !visor; i++) {
      await page.waitForTimeout(2000);
      visor = buscarVisor();
    }

    const contextos: string[] = [];
    for (const pg of ctx.pages()) for (const fr of pg.frames()) contextos.push(fr.url());
    pasos.push({ paso: "abrir-buzon", clickBuzon, contextos, visorEncontrado: Boolean(visor) });

    // Llamar al endpoint interno desde el contexto del visor (origin correcto).
    const ejecutor = visor ?? page;
    const fetchPagina = async (pag: number) => {
      const url =
        (/[?&]page=\d+/.test(LIST_URL)
          ? LIST_URL.replace(/([?&]page=)\d+/, `$1${pag}`)
          : `${LIST_URL}${LIST_URL.includes("?") ? "&" : "?"}page=${pag}`) +
        `&_=${Date.now()}`;
      return (await ejecutor.evaluate(async (u: string) => {
        try {
          const r = await fetch(u, { credentials: "include" });
          return { status: r.status, body: (await r.text()).slice(0, 60000) };
        } catch (e) {
          return { status: 0, body: String(e) };
        }
      }, url)) as { status: number; body: string };
    };

    const primera = await fetchPagina(1);
    pasos.push({ paso: "listNotiMenPag", status: primera.status, respuesta: primera.body.slice(0, 800) });
    if (diagnostico) {
      return { mensajes: [], peligrosos: [], urgentes: [], diag: { pasos } };
    }
    if (primera.status !== 200) {
      throw new Error(`No se pudo leer el buzón (estado ${primera.status}). Posible bloqueo o sesión.`);
    }

    // Solo el MES EN CURSO: corte = el más reciente entre (hoy - N días) y el
    // primer día del mes actual. Así no entran mensajes de meses anteriores.
    const ahora = new Date();
    const inicioMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1).getTime();
    const cutoff = Math.max(inicioMes, Date.now() - dias * 24 * 60 * 60 * 1000);
    const todas: BuzonMensaje[] = [];
    const agregar = (body: string) => {
      const ms = mapearMensajes(body);
      let seguir = true;
      for (const m of ms) {
        const f = parseFecha(m.fecha);
        if (f && f.getTime() < cutoff) { seguir = false; break; }
        todas.push(m);
      }
      return { seguir, count: ms.length };
    };
    let r = agregar(primera.body);
    for (let pag = 2; pag <= 20 && r.seguir && r.count > 0; pag++) {
      const p = await fetchPagina(pag);
      if (p.status !== 200) break;
      r = agregar(p.body);
    }

    const peligrosos = todas.filter((m) => m.nivel === "peligroso");
    const urgentes = todas.filter((m) => m.nivel === "urgente");
    return { mensajes: todas, peligrosos, urgentes };
  } catch (err) {
    if (diagnostico) {
      pasos.push({ paso: "error", respuesta: err instanceof Error ? err.message : String(err) });
      return { mensajes: [], peligrosos: [], urgentes: [], diag: { pasos } };
    }
    throw new Error(
      `Buzón: ${err instanceof Error ? err.message : String(err)} (usa Modo diagnóstico para más detalle)`
    );
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

// ============================================================
//  Descargar el ADJUNTO (PDF) de un mensaje del buzón
// ============================================================

export interface AdjuntoParams {
  ruc: string;
  solUser: string;
  solPass: string;
  codMensaje: string;
  /** idMensaje interno del visor (si difiere del codMensaje). */
  idMensaje?: string;
  /** idArchivo del adjunto (si ya se conoce; si no, se busca en el detalle). */
  idArchivo?: string;
  /** indMensaje del visor (por defecto "5"). */
  indMensaje?: string;
  diagnostico?: boolean;
}

export interface AdjuntoResultado {
  ok: boolean;
  /** PDF en base64 (cuando ok). */
  pdfBase64?: string;
  filename?: string;
  error?: string;
  diag?: { pasos: any[] };
}

/** Inicia sesión en SOL y abre el visor del buzón. Devuelve el frame del visor. */
async function abrirVisor(params: { ruc: string; solUser: string; solPass: string }, pasos: any[]) {
  const browser = await lanzarNavegador();
  const ctx = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  });
  const page = await ctx.newPage();

  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2500);
  await rellenar(page, ["#txtRuc", 'input[name="ruc"]', "#ruc"], params.ruc);
  await rellenar(page, ["#txtUsuario", 'input[name="usuario"]', "#usuario"], params.solUser);
  await rellenar(page, ["#txtContrasena", 'input[type="password"]', "#password"], params.solPass);
  await clickAny(page, ["#btnAceptar", 'button[type="submit"]', 'input[type="submit"]']);
  await page.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(3000);
  pasos.push({ paso: "post-login", url: page.url() });

  // Cerrar campaña "valida tus datos".
  for (let intento = 0; intento < 5; intento++) {
    const camp = page.frames().find((f: any) => /itadminforuc-modifdatos|campanha/i.test(f.url()));
    if (!camp) break;
    await clickPorTextoEnContexto(camp, ["Finalizar"]);
    await page.waitForTimeout(1500);
    await clickPorTextoEnContexto(camp, ["Continuar sin confirmar", "Continuar"]);
    await page.waitForTimeout(2200);
  }

  // Abrir Buzón Electrónico.
  await page
    .evaluate(() => {
      const els = Array.from(document.querySelectorAll('a, button, [role="button"]')) as HTMLElement[];
      const el = els.find((e) => {
        const txt = (e.textContent || "").trim().toLowerCase();
        const href = (e.getAttribute("href") || "").toLowerCase();
        const onclick = (e.getAttribute("onclick") || "").toLowerCase();
        return /^buz[oó]n\s*electr/.test(txt) || href.includes("visornoti") || onclick.includes("visornoti") || onclick.includes("buzon");
      });
      if (el) el.click();
    })
    .catch(() => {});

  const buscarVisor = () => {
    for (const pg of ctx.pages()) for (const fr of pg.frames()) if (/ol-ti-itvisornoti/.test(fr.url())) return fr;
    return null;
  };
  let visor: any = null;
  for (let i = 0; i < 12 && !visor; i++) {
    await page.waitForTimeout(2000);
    visor = buscarVisor();
  }
  pasos.push({ paso: "abrir-visor", visorEncontrado: Boolean(visor) });
  return { browser, ctx, page, visor };
}

/**
 * Descarga el adjunto (PDF) de un mensaje del buzón por su codMensaje.
 * En modo diagnóstico devuelve la respuesta cruda del detalle para calibrar la
 * ruta del archivo (igual que se hizo con SIRE/buzón).
 */
export async function descargarAdjuntoBuzon(params: AdjuntoParams): Promise<AdjuntoResultado> {
  const { ruc, solUser, solPass, codMensaje } = params;
  if (!/^\d{11}$/.test(ruc)) return { ok: false, error: "RUC inválido." };
  if (!solUser || !solPass) return { ok: false, error: "Ingresa el Usuario y la Clave SOL." };
  if (!codMensaje) return { ok: false, error: "Falta el código del mensaje." };

  const diagnostico = params.diagnostico === true;
  const pasos: any[] = [];
  let browser: any = null;

  try {
    const sesion = await abrirVisor({ ruc, solUser, solPass }, pasos);
    browser = sesion.browser;
    const ejecutor = sesion.visor ?? sesion.page;

    // DIAGNÓSTICO ÚTIL: vuelca la fila CRUDA del mensaje desde listNotiMenPag
    // (endpoint que SÍ funciona). Ahí suelen venir los campos del adjunto
    // (codArchivo / nombreArchivo / indAnexo, etc.) con sus nombres reales.
    if (diagnostico) {
      const listUrl =
        (/[?&]page=\d+/.test(LIST_URL) ? LIST_URL.replace(/([?&]page=)\d+/, "$11") : LIST_URL) +
        `&_=${Date.now()}`;
      const lista = (await ejecutor.evaluate(async (u: string) => {
        try {
          const r = await fetch(u, { credentials: "include" });
          return { status: r.status, body: (await r.text()).slice(0, 60000) };
        } catch (e) {
          return { status: 0, body: String(e) };
        }
      }, listUrl)) as { status: number; body: string };
      let filaCruda: any = null;
      let primeraFila: any = null;
      try {
        const data = JSON.parse(lista.body);
        const arr: any[] = Array.isArray(data)
          ? data
          : data?.rows ?? data?.lista ?? data?.mensajes ?? data?.registros ?? data?.data ?? [];
        primeraFila = arr[0] ?? null;
        filaCruda = arr.find((m) => String(m?.codMensaje ?? m?.numMensaje ?? m?.id ?? "") === String(codMensaje)) ?? null;
      } catch {
        /* no era JSON */
      }
      pasos.push({
        paso: "lista-cruda",
        status: lista.status,
        camposPrimeraFila: primeraFila ? Object.keys(primeraFila) : [],
        primeraFila,
        filaDelMensaje: filaCruda,
      });

      // Sonda: prueba varios endpoints de detalle para ver cuál trae el archivo
      // (idArchivo/nombreArchivo). Así calibramos en UNA sola corrida.
      const base = "https://ww1.sunat.gob.pe/ol-ti-itvisornoti/visor/";
      const candidatos = [
        "detalleMensaje", "detalleNotiMen", "listNotiAdjun", "listarArchivos",
        "listAdjuntos", "obtenerMensaje", "verMensaje", "leerMensaje", "detalleNotificacion",
      ];
      const idM = String((filaCruda?.codMensaje ?? filaCruda?.numMensaje ?? filaCruda?.id) ?? codMensaje);
      for (const c of candidatos) {
        const res = (await ejecutor.evaluate(
          async (a: { url: string; id: string }) => {
            try {
              const r = await fetch(a.url, {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: `idMensaje=${encodeURIComponent(a.id)}&sistema=0&indMensaje=5`,
              });
              const t = await r.text();
              return {
                status: r.status,
                len: t.length,
                tieneArchivo: /idArchivo|nombreArchivo|constancia|\.pdf/i.test(t),
                muestra: t.slice(0, 300),
              };
            } catch (e) {
              return { status: 0, len: 0, tieneArchivo: false, muestra: String(e).slice(0, 120) };
            }
          },
          { url: base + c, id: idM }
        )) as { status: number; len: number; tieneArchivo: boolean; muestra: string };
        pasos.push({ paso: "probe-detalle", endpoint: c, ...res });
      }

      // Lee el JS del visor para descubrir la URL REAL que usan las funciones
      // listArchivosAdjuntos / fGetDetalle (ahí está el endpoint del adjunto).
      const jsInfo = (await ejecutor.evaluate(async () => {
        const abs = (u: string) => {
          try { return new URL(u, location.href).href; } catch { return u; }
        };
        const srcs = Array.from(document.querySelectorAll("script[src]"))
          .map((s) => abs((s as HTMLScriptElement).getAttribute("src") || ""))
          .filter((u) => /sunat\.gob\.pe/.test(u));
        const urls = new Set<string>();
        const claves = ["listArchivosAdjuntos", "fGetDetalle", "obtenerDetalleValor", "descargaArchivoAlias", "bajarArchivo"];
        const ctx: Record<string, string> = {};
        for (const src of srcs.slice(0, 18)) {
          try {
            const r = await fetch(src, { credentials: "include" });
            const t = await r.text();
            // Cualquier ruta tipo .../algo.do o .../visor/algo o url:"..."
            (t.match(/["'`]([A-Za-z0-9_./?=&%-]*(?:\/visor\/|\.do|listArch|Detalle|Adjun|bajarArchivo|Mensaje)[A-Za-z0-9_./?=&%-]*)["'`]/g) || [])
              .forEach((x) => urls.add(x.replace(/["'`]/g, "")));
            for (const k of claves) {
              if (ctx[k]) continue;
              const i = t.indexOf(k);
              if (i >= 0) ctx[k] = t.slice(Math.max(0, i - 250), i + 450);
            }
          } catch { /* inaccesible */ }
        }
        return { srcs, urls: Array.from(urls), ctx };
      })) as { srcs: string[]; urls: string[]; ctx: Record<string, string> };
      pasos.push({
        paso: "js-visor",
        scripts: jsInfo.srcs,
        urls: jsInfo.urls.slice(0, 100),
        contextos: jsInfo.ctx,
      });
    }

    // idMensaje interno del visor (== codMensaje del listado).
    const idMensaje = params.idMensaje || codMensaje;
    let idArchivo = params.idArchivo || "";
    let sistema = "0";

    // Si no nos dieron idArchivo, lo sacamos de listArchivosAdjuntos(idMensaje).
    if (!idArchivo) {
      const arch = (await ejecutor.evaluate(
        async (a: { url: string; id: string }) => {
          const intentos: { url: string; opt: any }[] = [
            { url: `${a.url}?idMensaje=${encodeURIComponent(a.id)}`, opt: { credentials: "include" } },
            {
              url: a.url,
              opt: {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: `idMensaje=${encodeURIComponent(a.id)}`,
              },
            },
          ];
          const log: { url: string; metodo: string; status: number; len: number }[] = [];
          let elegido = { status: 0, body: "" };
          for (const it of intentos) {
            try {
              const r = await fetch(it.url, it.opt);
              const t = await r.text();
              log.push({ url: it.url, metodo: it.opt.method || "GET", status: r.status, len: t.length });
              if (r.status === 200 && t && !/Error 404/.test(t)) {
                elegido = { status: r.status, body: t.slice(0, 8000) };
                break;
              }
              if (!elegido.body) elegido = { status: r.status, body: t.slice(0, 2000) };
            } catch (e) {
              log.push({ url: it.url, metodo: it.opt.method || "GET", status: -1, len: 0 });
            }
          }
          return { ...elegido, log };
        },
        { url: ARCHIVOS_URL, id: idMensaje }
      )) as { status: number; body: string; log: any[] };
      pasos.push({ paso: "listArchivosAdjuntos", status: arch.status, intentos: arch.log, respuesta: arch.body.slice(0, 1200) });
      try {
        const j = JSON.parse(arch.body);
        const nodo = Array.isArray(j)
          ? j
          : j?.archivos ?? j?.lista ?? j?.rows ?? j?.data ?? j?.lisArchivos ?? j?.listArchivos ?? [];
        const arr = Array.isArray(nodo) ? nodo : [nodo];
        const a = arr.find((x: any) => x && (x.idArchivo ?? x.codArchivo ?? x.id));
        if (a) {
          idArchivo = String(a.idArchivo ?? a.codArchivo ?? a.id);
          if (a.sistema != null) sistema = String(a.sistema);
        }
      } catch {
        const m = arch.body.match(/idArchivo["'\s:=]+(\d+)/i);
        if (m) idArchivo = m[1];
      }
    }
    pasos.push({ paso: "ids", idMensaje, idArchivo, sistema });

    if (!idArchivo) {
      return {
        ok: false,
        error:
          "No encontré el idArchivo del adjunto. Usa Modo diagnóstico y compárteme el resultado para ajustar listArchivosAdjuntos.",
        diag: { pasos },
      };
    }

    // Descarga GET tal como la arma el propio visor (confirmado en su JS):
    //   bajarArchivo?accion=archivo&idMensaje=..&idArchivo=..&sistema=0&app=1
    const link =
      `${BAJAR_URL}?accion=archivo&idMensaje=${encodeURIComponent(idMensaje)}` +
      `&idArchivo=${encodeURIComponent(idArchivo)}&sistema=${encodeURIComponent(sistema)}&app=1`;
    const bin = (await ejecutor.evaluate(async (u: string) => {
      try {
        const r = await fetch(u, { credentials: "include" });
        const ct = r.headers.get("content-type") || "";
        const buf = await r.arrayBuffer();
        let s = "";
        const bytes = new Uint8Array(buf);
        for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
        return { status: r.status, ct, b64: btoa(s), firma: s.slice(0, 5) };
      } catch (e) {
        return { status: 0, ct: "", b64: "", firma: String(e).slice(0, 5) };
      }
    }, link)) as { status: number; ct: string; b64: string; firma: string };
    pasos.push({ paso: "bajarArchivo", url: link, status: bin.status, ct: bin.ct, firma: bin.firma, bytes: bin.b64.length });

    if (diagnostico) return { ok: false, diag: { pasos } };

    if (bin.status === 200 && (bin.firma.startsWith("%PDF") || /pdf/i.test(bin.ct)) && bin.b64) {
      return { ok: true, pdfBase64: bin.b64, filename: `mensaje-${codMensaje}.pdf` };
    }
    return {
      ok: false,
      error:
        "No se pudo descargar el adjunto. Usa Modo diagnóstico y comparte el resultado para terminar de calibrar.",
      diag: { pasos },
    };
  } catch (err) {
    pasos.push({ paso: "error", respuesta: err instanceof Error ? err.message : String(err) });
    return { ok: false, error: err instanceof Error ? err.message : String(err), diag: { pasos } };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}
