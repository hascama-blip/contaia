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
  errorRemoto?: string;   // por qué falló el remoto (si estaba configurado)
}

// Lanza el Chromium local (@sparticuz en Render; el instalado en local).
async function lanzarLocal(chromium: any) {
  try {
    const sparticuz = (await import("@sparticuz/chromium")).default as any;
    const executablePath = await sparticuz.executablePath();
    if (executablePath) {
      return chromium.launch({
        headless: true,
        executablePath,
        args: [...(sparticuz.args ?? []), ...ARGS_LIGEROS],
      });
    }
  } catch {
    /* fallback al Chromium local instalado */
  }
  return chromium.launch({ headless: true, args: ARGS_LIGEROS });
}

/** Conecta al navegador y dice si fue remoto (Browserless) o local. */
export async function conectarNavegador(): Promise<ConexionNavegador> {
  const { chromium } = await import("playwright-core");

  // NAVEGADOR REMOTO (Browserless / Browserbase): si está configurado, los
  // Chromium corren en OTRA máquina (no consumen RAM del servidor web) y ese
  // servicio maneja el pool, la cola y la concurrencia.
  const wsUrl = process.env.BROWSER_WS_URL;
  if (wsUrl) {
    try {
      const browser = await chromium.connectOverCDP(wsUrl);
      return { browser, remoto: true };
    } catch (e: any) {
      // Si el remoto está caído o mal configurado, NO rompemos la extracción:
      // caemos al Chromium local como respaldo (y lo reportamos).
      const errorRemoto = String(e?.message ?? e);
      console.error("[navegador] Falló la conexión a BROWSER_WS_URL, uso Chromium local:", errorRemoto);
      return { browser: await lanzarLocal(chromium), remoto: false, errorRemoto };
    }
  }
  return { browser: await lanzarLocal(chromium), remoto: false };
}

export async function lanzarNavegador() {
  return (await conectarNavegador()).browser;
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
