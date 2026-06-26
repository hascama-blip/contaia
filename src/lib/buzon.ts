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
  /** Asunto del mensaje (para ubicarlo y abrirlo en el visor). */
  asunto?: string;
  /** Fecha y hora del mensaje (clave única para seleccionar la fila correcta). */
  fecha?: string;
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
    acceptDownloads: true,
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

/** Descompone una fecha del buzón en partes para ubicar la fila exacta del
 *  mensaje en el visor (la fecha+hora es única). Acepta "DD/MM/YYYY HH:MM:SS"
 *  o ISO "YYYY-MM-DD HH:MM:SS". */
function partesFecha(f: string): { dmy: string; hm: string; hms: string } | null {
  const s = String(f || "").trim();
  const p2 = (x: any) => String(x).padStart(2, "0");
  let d: any, mo: any, y: any, h: any, mi: any, se: any;
  let m = s.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) { y = m[1]; mo = m[2]; d = m[3]; h = m[4]; mi = m[5]; se = m[6]; }
  else {
    m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (m) { d = m[1]; mo = m[2]; y = m[3]; h = m[4]; mi = m[5]; se = m[6]; }
  }
  if (!y) return null;
  return {
    dmy: `${p2(d)}/${p2(mo)}/${y}`,
    hm: `${p2(h)}:${p2(mi)}`,
    hms: se ? `${p2(h)}:${p2(mi)}:${p2(se)}` : `${p2(h)}:${p2(mi)}`,
  };
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

    // El detalle del mensaje (con el enlace del adjunto) lo renderiza el visor
    // al hacer CLIC en el mensaje (server-side, master.do). Así que lo abrimos
    // como un humano y leemos el href del adjunto.
    let asunto = params.asunto || "";
    if (!asunto) {
      const listUrl =
        (/[?&]page=\d+/.test(LIST_URL) ? LIST_URL.replace(/([?&]page=)\d+/, "$11") : LIST_URL) +
        `&_=${Date.now()}`;
      const lr = (await ejecutor.evaluate(async (u: string) => {
        try { const r = await fetch(u, { credentials: "include" }); return await r.text(); } catch { return ""; }
      }, listUrl)) as string;
      try {
        const data = JSON.parse(lr);
        const arr: any[] = Array.isArray(data)
          ? data
          : data?.rows ?? data?.lista ?? data?.mensajes ?? data?.registros ?? data?.data ?? [];
        const row = arr.find((m) => String(m?.codMensaje ?? m?.id ?? "") === String(codMensaje));
        if (row) asunto = String(row.desAsunto || "");
      } catch { /* */ }
    }

    // Diagnóstico: vuelca las filas del visor (onclick/texto) y si el codMensaje
    // aparece en ellas, para calibrar la selección si fuese necesario.
    if (diagnostico) {
      const filas = (await ejecutor.evaluate((cod: string) => {
        const out: any[] = [];
        const els = Array.from(document.querySelectorAll("a,tr,li,[onclick]")) as HTMLElement[];
        for (const e of els) {
          const oc = e.getAttribute("onclick") || "";
          const txt = (e.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60);
          if (!oc && !txt) continue;
          out.push({ tag: e.tagName, id: (e.id || "").slice(0, 40), oc: oc.slice(0, 140), txt, tieneCod: (oc + " " + (e.id || "")).includes(cod) });
          if (out.length >= 30) break;
        }
        return out;
      }, String(codMensaje))) as any[];
      pasos.push({ paso: "filas-visor", codMensaje, filas });
    }

    // Selección del mensaje. PRIORIDAD: la FECHA+HORA (única por mensaje) → así
    // se clica la fila correcta de la lista y el detalle de la derecha cambia.
    // Respaldos: codMensaje en atributos, luego asunto completo.
    const idM = String(params.idMensaje || codMensaje);
    const fp = partesFecha(params.fecha || "");
    const sel = (await ejecutor.evaluate(
      (arg: { cod: string; idm: string; asuntoTxt: string; dmy: string; hm: string; hms: string }) => {
        const { cod, idm, asuntoTxt, dmy, hm, hms } = arg;
        const norm = (s: any) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
        const codes = Array.from(new Set([cod, idm].map(String).filter((c) => c && c.length >= 4)));
        const attrsBlob = (e: Element) => {
          const a = e as HTMLElement;
          let s = (a.getAttribute("onclick") || "") + " " + (a.getAttribute("href") || "") + " " + (a.id || "");
          for (const at of Array.from(a.attributes || [])) s += " " + at.value;
          return s;
        };
        const clickAncestro = (start: HTMLElement, via: string) => {
          let n: HTMLElement | null = start;
          for (let i = 0; i < 6 && n; i++) {
            if (n.tagName === "A" || (n.getAttribute && n.getAttribute("onclick"))) {
              n.click();
              return { ok: true, via, html: (n.outerHTML || "").replace(/\s+/g, " ").slice(0, 180) };
            }
            n = n.parentElement;
          }
          try { start.click(); return { ok: true, via: via + "-raw", html: (start.outerHTML || "").replace(/\s+/g, " ").slice(0, 180) }; }
          catch { return { ok: false, via, html: "" }; }
        };
        const all = Array.from(document.querySelectorAll("a,tr,li,div,span,td,p,[onclick],[id]")) as HTMLElement[];

        // 0) por FECHA+HORA: ubica la fila cuyo texto contiene la fecha y la hora,
        //    sube al contenedor de la fila y clica su enlace de asunto.
        if (dmy && hm) {
          const filaTs = all.find((e) => {
            if (e.children.length > 4) return false;
            const tx = norm(e.textContent);
            return tx.includes(dmy.toLowerCase()) && (tx.includes(hms.toLowerCase()) || tx.includes(hm.toLowerCase()));
          });
          if (filaTs) {
            let row: HTMLElement | null = filaTs;
            for (let i = 0; i < 6 && row; i++) {
              const link = row.querySelector ? (row.querySelector("a") as HTMLElement | null) : null;
              if (link && (row.textContent || "").length < 600) {
                link.click();
                return { ok: true, via: "fecha", html: (link.outerHTML || "").replace(/\s+/g, " ").slice(0, 180) };
              }
              row = row.parentElement;
            }
            return clickAncestro(filaTs, "fecha");
          }
        }

        // 1) por codMensaje / idMensaje en atributos u onclick
        for (const c of codes) {
          const byCode = all.find((e) => attrsBlob(e).includes(c));
          if (byCode) return clickAncestro(byCode, "codMensaje");
        }
        // 2) por asunto COMPLETO en una celda/fila concreta (no un contenedor grande)
        const t = norm(asuntoTxt).replace(/^asunto:\s*/, "");
        if (t) {
          const byAsunto = all.find((e) => e.children.length <= 4 && norm(e.textContent).includes(t));
          if (byAsunto) return clickAncestro(byAsunto, "asunto");
        }
        return { ok: false, via: "none", html: "" };
      },
      { cod: String(codMensaje), idm: idM, asuntoTxt: asunto, dmy: fp?.dmy ?? "", hm: fp?.hm ?? "", hms: fp?.hms ?? "" }
    )) as { ok: boolean; via: string; html: string };
    pasos.push({ paso: "click-mensaje", codMensaje, idMensaje: idM, fecha: params.fecha ?? "", asunto: asunto.slice(0, 60), seleccion: sel });

    // Dar tiempo a que el detalle (panel derecho) se actualice por AJAX antes de
    // leer el adjunto, para no tomar el enlace del mensaje anterior.
    await sesion.page.waitForTimeout(3000);

    // Esperar a que cargue el detalle (que aparezca el número azul del documento
    // o algún enlace de archivo). No filtramos solo por bajarArchivo/gendoc
    // porque el enlace azul suele ser un onclick tipo goArchivoDescarga.
    let enlaces: string[] = [];
    for (let i = 0; i < 8 && enlaces.length === 0; i++) {
      await sesion.page.waitForTimeout(1500);
      enlaces = (await ejecutor.evaluate(() => {
        const out = new Set<string>();
        document.querySelectorAll("a").forEach((a) => {
          const t = (a.textContent || "").trim();
          const acc = (a.getAttribute("onclick") || "") + " " + (a.getAttribute("href") || "");
          if (/^[\d][\d\s.\-]{5,}$/.test(t) || /bajararchivo|gendoc|goarchivo|valor|reporte|descarga|\.pdf|unloadfile/i.test(acc)) {
            out.add((t + " | " + acc).slice(0, 120));
          }
        });
        return Array.from(out);
      })) as string[];
    }
    pasos.push({ paso: "enlaces-adjunto", cantidad: enlaces.length, enlaces: enlaces.slice(0, 5) });

    if (enlaces.length === 0) {
      if (diagnostico) {
        const dump = (await ejecutor.evaluate(() => {
          const cont = document.querySelector("#listArchivosAdjuntos");
          const anchors = (Array.from(document.querySelectorAll("a")) as HTMLAnchorElement[])
            .map((a) => ({
              href: (a.getAttribute("href") || "").slice(0, 200),
              onclick: (a.getAttribute("onclick") || "").slice(0, 200),
              txt: (a.textContent || "").trim().slice(0, 60),
            }))
            .filter((a) => /archivo|gendoc|bajar|constancia|adjun|\.pdf/i.test(a.href + a.onclick + a.txt))
            .slice(0, 20);
          return { listAdj: cont ? (cont as HTMLElement).outerHTML.slice(0, 2500) : null, anchors };
        })) as any;
        pasos.push({ paso: "detalle-dom", ...dump });
        return { ok: false, diag: { pasos } };
      }
      return {
        ok: false,
        error: "No pude ubicar el enlace del adjunto tras abrir el mensaje. Usa Modo diagnóstico y compárteme el resultado.",
        diag: { pasos },
      };
    }

    // baja binario por fetch en el contexto de una página (con cookies).
    const fetchPdf = async (pg: any, u: string) =>
      (await pg.evaluate(async (url: string) => {
        try {
          const r = await fetch(url, { credentials: "include" });
          const ct = r.headers.get("content-type") || "";
          const b = await r.arrayBuffer();
          const by = new Uint8Array(b);
          let s = "";
          for (let i = 0; i < by.length; i++) s += String.fromCharCode(by[i]);
          return { status: r.status, ct, b64: btoa(s), firma: s.slice(0, 5) };
        } catch {
          return { status: 0, ct: "", b64: "", firma: "" };
        }
      }, u)) as { status: number; ct: string; b64: string; firma: string };

    // Helper: busca el enlace de DOCUMENTO (número azul = la resolución) en una
    // lista de frames (incluye sub-iframes / otras pestañas), hace clic y captura
    // lo que SUNAT descargue/abra. ownerPage = página donde escuchar la descarga.
    const intentarDescarga = async (frames: any[], ownerPage: any, label: string) => {
      const espDl = ownerPage.waitForEvent("download", { timeout: 25000 }).catch(() => null);
      const espPg = sesion.ctx.waitForEvent("page", { timeout: 25000 }).catch(() => null);
      let clicked: string | null = null;
      const framesDump: any[] = [];
      for (const fr of frames) {
        const res = (await fr
          .evaluate(() => {
            const anchors = Array.from(document.querySelectorAll("a")) as HTMLAnchorElement[];
            const txt = (x: HTMLAnchorElement) => (x.textContent || "").trim();
            const acc = (x: HTMLAnchorElement) => ((x.getAttribute("onclick") || "") + " " + (x.getAttribute("href") || "")).toLowerCase();
            const noCons = (x: HTMLAnchorElement) => !/constancia|bajararchivo|menuinternet|iconexecute/.test((txt(x) + " " + acc(x)).toLowerCase());
            const cands = anchors
              .map((x) => ({ t: txt(x).slice(0, 50), a: acc(x).slice(0, 140) }))
              .filter((c) => c.t || c.a.trim())
              .slice(0, 15);
            const a =
              // 1) el número del documento en azul (texto = dígitos/guiones)
              anchors.find((x) => /^[\d][\d\s.\-]{5,}$/.test(txt(x)) && noCons(x)) ||
              // 2) handlers de descarga reales del visor (no la constancia ni el menú)
              anchors.find((x) => /visorpdfdescarga|goarchivodescarga|descargaarchivoalias|gendocs01alias|unloadfile/.test(acc(x)) && noCons(x));
            if (a) {
              (a as HTMLElement).click();
              return { clicked: (txt(a) + " || " + acc(a)).slice(0, 200), cands };
            }
            return { clicked: null, cands };
          })
          .catch(() => ({ clicked: null, cands: [] }))) as { clicked: string | null; cands: any[] };
        framesDump.push({ url: (fr.url() || "").slice(0, 90), cands: res.cands });
        if (res.clicked) { clicked = res.clicked; break; }
      }
      pasos.push({ paso: "clic-" + label, anchor: clicked, frames: framesDump });
      if (!clicked) return { b64: "", nombre: "", popup: null as any };
      const dl = await espDl;
      if (dl) {
        const p = await dl.path().catch(() => null);
        const nom = (dl.suggestedFilename && dl.suggestedFilename()) || "";
        if (p) { const fs = await import("fs"); return { b64: fs.readFileSync(p).toString("base64"), nombre: nom, popup: null as any }; }
      }
      const pg = await espPg;
      return { b64: "", nombre: "", popup: pg };
    };

    let pdfB64 = "";
    let nombreArch = "";

    // La página real del visor (donde vive el detalle y los sub-iframes).
    const visorPage = sesion.visor ? sesion.visor.page() : sesion.page;
    const todasFrames = () => sesion.ctx.pages().flatMap((p: any) => p.frames());

    // Nivel 1: el número azul está en el detalle o en un sub-iframe del visor.
    const r = await intentarDescarga(todasFrames(), visorPage, "detalle");
    if (r.b64) { pdfB64 = r.b64; nombreArch = r.nombre || ""; }

    // Nivel 2: si abrió una página nueva (la constancia), buscar el número azul ahí.
    if (!pdfB64 && r.popup) {
      const pg2 = r.popup;
      await pg2.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
      pasos.push({ paso: "constancia-url", url: pg2.url() });
      const r2 = await intentarDescarga(pg2.frames(), pg2, "constancia");
      if (r2.b64) { pdfB64 = r2.b64; nombreArch = r2.nombre || nombreArch; }

      if (!pdfB64 && r2.popup) {
        const pg3 = r2.popup;
        await pg3.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
        pasos.push({ paso: "doc-url", url: pg3.url() });
        const bin = await fetchPdf(pg3, pg3.url());
        if (bin.b64 && (bin.firma.startsWith("%PDF") || /pdf/i.test(bin.ct))) pdfB64 = bin.b64;
        else { const buf = await pg3.pdf({ format: "A4", printBackground: true }).catch(() => null); if (buf) pdfB64 = Buffer.from(buf).toString("base64"); }
        await pg3.close().catch(() => {});
      }

      if (!pdfB64) {
        const buf = await pg2.pdf({ format: "A4", printBackground: true }).catch(() => null);
        if (buf) { pdfB64 = Buffer.from(buf).toString("base64"); nombreArch = nombreArch || `constancia-${codMensaje}.pdf`; }
      }
      await pg2.close().catch(() => {});
    }

    if (diagnostico) return { ok: false, diag: { pasos } };
    if (pdfB64) return { ok: true, pdfBase64: pdfB64, filename: nombreArch || `resolucion-${codMensaje}.pdf` };
    return {
      ok: false,
      error: "No pude capturar la descarga de la resolución. Usa Modo diagnóstico y compárteme el resultado.",
      diag: { pasos },
    };
  } catch (err) {
    pasos.push({ paso: "error", respuesta: err instanceof Error ? err.message : String(err) });
    return { ok: false, error: err instanceof Error ? err.message : String(err), diag: { pasos } };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}
