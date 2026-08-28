// Lanzamiento de Chromium headless de BAJO CONSUMO + bloqueo de recursos.
// Reutilizado por el buzón y el fraccionamiento (scraping SOL). El objetivo es
// gastar la menor RAM/CPU posible SIN cambiar qué se extrae:
//  - flags de bajo consumo,
//  - bloqueo de imágenes/fuentes/media/tracking (no afectan el texto ni el PDF).

// Flags que bajan el uso de CPU/RAM sin romper el login de SUNAT. NO se usa
// --single-process (inestable). Se conserva CSS/JS para no romper la lógica.
const ARGS_LIGEROS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--disable-extensions",
  "--disable-background-networking",
  "--disable-background-timer-throttling",
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
  "--disable-features=TranslateUI,BackForwardCache,MediaRouter",
  "--mute-audio",
  "--no-first-run",
  "--no-default-browser-check",
  "--js-flags=--max-old-space-size=256",
];

/** Resultado de la conexión: el navegador + si de verdad conectó al remoto. */
export interface ConexionNavegador {
  browser: any;
  remoto: boolean;        // true = corrió en Browserless; false = Chromium local
  fuente?: "env" | "guardada"; // de dónde salió la URL del remoto
  errorRemoto?: string;   // por qué falló el remoto (si estaba configurado)
}

// ============================================================
//  COLA GLOBAL de navegadores LOCALES (protege la RAM del server)
// ============================================================
// Cada Chromium local pesa ~300–500 MB. Sin límite, varios usuarios extrayendo
// a la vez tumban el servidor (OOM) y la WEB ENTERA se cae. Con la cola, solo
// corren MAX_NAVEGADORES a la vez y el resto espera su turno; la web nunca se
// ve afectada. (El navegador remoto NO pasa por la cola: no gasta RAM local.)
const MAX_NAVEGADORES = Math.max(1, Number(process.env.MAX_NAVEGADORES ?? "2") || 2);
const MAX_EN_COLA = 12;            // más de esto = rechazo inmediato con mensaje claro
const ESPERA_MAX_MS = 120_000;     // máximo en cola antes de rendirse
const LIBERACION_FORZADA_MS = 6 * 60_000; // red de seguridad si nadie cierra el navegador

let navegadoresActivos = 0;
const turnosEnEspera: { resolve: () => void; reject: (e: Error) => void; timer: any }[] = [];

function adquirirTurno(): Promise<void> {
  if (navegadoresActivos < MAX_NAVEGADORES) {
    navegadoresActivos++;
    return Promise.resolve();
  }
  if (turnosEnEspera.length >= MAX_EN_COLA) {
    return Promise.reject(
      new Error("El sistema está procesando muchas extracciones a la vez. Intenta de nuevo en 1–2 minutos.")
    );
  }
  return new Promise<void>((resolve, reject) => {
    const item = {
      resolve: () => {
        clearTimeout(item.timer);
        navegadoresActivos++;
        resolve();
      },
      reject,
      timer: setTimeout(() => {
        const i = turnosEnEspera.indexOf(item);
        if (i >= 0) turnosEnEspera.splice(i, 1);
        reject(new Error("Hay muchas extracciones en cola y se agotó la espera. Intenta de nuevo en unos minutos."));
      }, ESPERA_MAX_MS),
    };
    item.timer?.unref?.();
    turnosEnEspera.push(item);
  });
}

function liberarTurno(): void {
  navegadoresActivos = Math.max(0, navegadoresActivos - 1);
  const siguiente = turnosEnEspera.shift();
  if (siguiente) siguiente.resolve();
}

/** Estado de la cola (para el diagnóstico del supremo). */
export function estadoNavegadores() {
  return { activos: navegadoresActivos, enCola: turnosEnEspera.length, maximo: MAX_NAVEGADORES };
}

// Proxy de salida (opcional). Para escalar a muchos usuarios sin que SUNAT
// bloquee la IP del servidor: se enruta cada sesión por un proxy ROTATIVO
// (idealmente residencial/móvil de Perú) → cada login sale con otra IP.
// Se configura con variables de entorno:
//   PROXY_SERVER   = "http://gateway.proveedor.com:7000"  (o socks5://…)
//   PROXY_USERNAME = usuario del proxy (con proveedor rotativo, cada conexión
//                    suele salir con IP distinta automáticamente)
//   PROXY_PASSWORD = clave del proxy
async function proxyConfig(): Promise<{ server: string; username?: string; password?: string } | undefined> {
  // Entorno primero; si no, lo que el supremo guardó en la app.
  let server = (process.env.PROXY_SERVER || "").trim();
  let username = (process.env.PROXY_USERNAME || "").trim();
  let password = (process.env.PROXY_PASSWORD || "").trim();
  if (!server) {
    try {
      const { getIntegraciones } = await import("./db");
      const g = await getIntegraciones();
      server = g.proxyServer;
      username = g.proxyUser;
      password = g.proxyPass;
    } catch { /* si no se puede leer el store, sin proxy */ }
  }
  if (!server) return undefined;
  // Normaliza el server: Playwright quiere "scheme://host:puerto" SIN credenciales
  // embebidas ni barra final. Si vienen dentro del URL (user:pass@host), se extraen.
  try {
    const conEsquema = /^[a-z0-9]+:\/\//i.test(server) ? server : `http://${server}`;
    const u = new URL(conEsquema);
    if (u.username && !username) username = decodeURIComponent(u.username);
    if (u.password && !password) password = decodeURIComponent(u.password);
    const puerto = u.port ? `:${u.port}` : "";
    server = `${u.protocol}//${u.hostname}${puerto}`;
  } catch {
    // Si no parsea como URL, al menos quita la barra final.
    server = server.replace(/\/+$/, "");
  }
  return { server, username: username || undefined, password: password || undefined };
}

// Lanza el Chromium local (@sparticuz en Render; el instalado en local).
async function lanzarLocal(chromium: any) {
  const proxy = await proxyConfig();
  try {
    const sparticuz = (await import("@sparticuz/chromium")).default as any;
    const executablePath = await sparticuz.executablePath();
    if (executablePath) {
      return chromium.launch({
        headless: true,
        executablePath,
        args: [...(sparticuz.args ?? []), ...ARGS_LIGEROS],
        ...(proxy ? { proxy } : {}),
      });
    }
  } catch {
    /* fallback al Chromium local instalado */
  }
  return chromium.launch({ headless: true, args: ARGS_LIGEROS, ...(proxy ? { proxy } : {}) });
}

// Lanza el Chromium local RESPETANDO la cola: espera turno, y libera el cupo
// cuando el navegador se cierra (o a los 6 min como red de seguridad).
async function lanzarLocalConTurno(chromium: any) {
  await adquirirTurno();
  let liberado = false;
  const liberar = () => {
    if (liberado) return;
    liberado = true;
    clearTimeout(seguro);
    liberarTurno();
  };
  const seguro: any = setTimeout(liberar, LIBERACION_FORZADA_MS);
  seguro?.unref?.();
  try {
    const browser = await lanzarLocal(chromium);
    // El cupo se devuelve al cerrar: TODOS los consumidores cierran con
    // browser.close() (buzón, F36, PDF, diagnóstico), así que basta envolverlo.
    const closeOriginal = browser.close.bind(browser);
    browser.close = async (...args: any[]) => {
      try {
        return await closeOriginal(...args);
      } finally {
        liberar();
      }
    };
    browser.on?.("disconnected", liberar);
    return browser;
  } catch (e) {
    liberar();
    throw e;
  }
}

/** Conecta al navegador y dice si fue remoto (Browserless) o local.
 *  opts.preferLocal: para flujos sensibles a captcha/IP (RTT, rentas) usa el
 *  Chromium LOCAL cuando hay proxy residencial, porque el proxy NO se aplica a
 *  Browserless (allí la IP sería la de datacenter y SUNAT la bloquea / baja el
 *  puntaje de reCAPTCHA v3). Sin proxy configurado no hay ventaja → flujo normal. */
export async function conectarNavegador(opts: { preferLocal?: boolean } = {}): Promise<ConexionNavegador> {
  const { chromium } = await import("playwright-core");

  if (opts.preferLocal) {
    const proxy = await proxyConfig();
    if (proxy) return { browser: await lanzarLocalConTurno(chromium), remoto: false };
    // sin proxy, el local correría con la IP del datacenter → sigue el flujo normal.
  }

  // NAVEGADOR REMOTO (Browserless / Browserbase): si está configurado, los
  // Chromium corren en OTRA máquina (no consumen RAM del servidor web) y ese
  // servicio maneja el pool, la cola y la concurrencia.
  // Prioridad: variable de entorno; si el hosting no la inyecta, se usa la URL
  // guardada en la app (la configura el supremo desde su panel).
  let wsUrl = process.env.BROWSER_WS_URL;
  let fuente: "env" | "guardada" | undefined = wsUrl ? "env" : undefined;
  if (!wsUrl) {
    try {
      const { getBrowserWsUrl } = await import("./db");
      const guardada = (await getBrowserWsUrl()) || undefined;
      if (guardada) {
        wsUrl = guardada;
        fuente = "guardada";
      }
    } catch {
      /* si no se puede leer el store, sigue con el navegador local */
    }
  }
  if (wsUrl) {
    try {
      const browser = await chromium.connectOverCDP(wsUrl);
      return { browser, remoto: true, fuente };
    } catch (e: any) {
      // Si el remoto está caído o mal configurado, NO rompemos la extracción:
      // caemos al Chromium local como respaldo (y lo reportamos).
      const errorRemoto = String(e?.message ?? e);
      console.error("[navegador] Falló la conexión al navegador remoto, uso Chromium local:", errorRemoto);
      return { browser: await lanzarLocalConTurno(chromium), remoto: false, fuente, errorRemoto };
    }
  }
  return { browser: await lanzarLocalConTurno(chromium), remoto: false };
}

export async function lanzarNavegador(opts: { preferLocal?: boolean } = {}) {
  return (await conectarNavegador(opts)).browser;
}

/** Prueba el proxy residencial SIN tocar SUNAT: abre Chromium local con el proxy
 *  (igual que la Opción A del RTT) y consulta la IP de salida. Sirve para validar
 *  que el proxy autentica desde el servidor antes de enrutar los logins por él. */
export async function probarProxy(): Promise<{ ok: boolean; ip?: string; ms?: number; error?: string; server?: string }> {
  const proxy = await proxyConfig();
  if (!proxy) return { ok: false, error: "No hay proxy configurado (PROXY_SERVER)." };
  const { chromium } = await import("playwright-core");
  let browser: any = null;
  const t0 = Date.now();
  try {
    browser = await lanzarLocal(chromium); // lanzarLocal aplica el proxyConfig()
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    // Los residenciales son más lentos: damos más tiempo y probamos por HTTP
    // (menos handshake) — si falla, reintenta por HTTPS.
    let body = "";
    try {
      await page.goto("http://api.ipify.org?format=json", { waitUntil: "domcontentloaded", timeout: 45000 });
      body = (await page.evaluate(() => document.body?.innerText || "").catch(() => "")) as string;
    } catch {
      await page.goto("https://api.ipify.org?format=json", { waitUntil: "domcontentloaded", timeout: 45000 });
      body = (await page.evaluate(() => document.body?.innerText || "").catch(() => "")) as string;
    }
    const ip = (body.match(/(\d{1,3}\.){3}\d{1,3}/) || [])[0] || "";
    return { ok: !!ip, ip, ms: Date.now() - t0, server: proxy.server };
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e).slice(0, 200), ms: Date.now() - t0, server: proxy.server };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

/** Bloquea recursos pesados que NO afectan la extracción (imágenes, fuentes,
 *  media y tracking). Se conservan CSS/JS/XHR/documento para no romper nada.
 *  Reduce RAM, CPU y ancho de banda — y suele ACELERAR la navegación. */
export async function bloquearRecursos(ctx: any): Promise<void> {
  await ctx
    .route("**/*", (route: any) => {
      try {
        const req = route.request();
        const tipo = req.resourceType();
        if (tipo === "image" || tipo === "font" || tipo === "media") return route.abort();
        // Bloquea trackers/analytics comunes (no son de SUNAT).
        const url = req.url();
        if (/google-analytics|googletagmanager|doubleclick|facebook\.net|hotjar/i.test(url)) return route.abort();
        return route.continue();
      } catch {
        return route.continue();
      }
    })
    .catch(() => {});
}
