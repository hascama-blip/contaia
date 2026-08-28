// ============================================================
//  Resolución de CAPTCHA (Cloudflare Turnstile) vía CapSolver
// ============================================================
// SUNAT puede mostrar un widget de Cloudflare Turnstile en el login. Aquí:
//   1) Detectamos el widget en cualquier frame (data-sitekey).
//   2) Pedimos un token a CapSolver (tarea AntiTurnstileTaskProxyLess: sin proxy).
//   3) Inyectamos el token en el campo oculto (cf-turnstile-response) y disparamos
//      el callback si existe, para que el formulario lo envíe.
//
// A PRUEBA DE FALLOS: si NO hay widget o NO hay CAPSOLVER_KEY configurada, esta
// función NO hace nada (no rompe el login que ya funciona). Se activa sola cuando
// SUNAT muestre el captcha y la clave esté puesta en el entorno.
//
// Variables de entorno:
//   CAPSOLVER_KEY       clientKey de CapSolver (si falta → captcha desactivado)
//   CAPSOLVER_API_URL   opcional, por defecto https://api.capsolver.com
//   CAPTCHA_MAX_MS      opcional, tiempo máx. de espera del token (def. 120000)

const API_URL = (process.env.CAPSOLVER_API_URL || "https://api.capsolver.com").replace(/\/+$/, "");
const MAX_MS = Number(process.env.CAPTCHA_MAX_MS || 120_000);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface CaptchaDetectado {
  sitekey: string;
  url: string;
  tipo: "turnstile";
  /** Hay widget Turnstile pero no se pudo extraer el sitekey (no se puede resolver). */
  sinSitekey?: boolean;
}

/** Busca un widget Turnstile en TODOS los frames. Devuelve sitekey + la URL del
 *  FRAME que lo contiene (Turnstile ata el token a esa URL, no a la del top). */
export async function detectarTurnstile(ctx: any, page: any): Promise<CaptchaDetectado | null> {
  for (const pg of ctx.pages()) {
    for (const fr of pg.frames()) {
      const r = await fr
        .evaluate(() => {
          const out: { sitekey: string | null; hayWidget: boolean } = { sitekey: null, hayWidget: false };
          // 0) sitekey capturado al vuelo desde turnstile.render (hookTurnstileSitekey).
          try {
            const sk = (window as any).__radarSitekey;
            if (sk && /^0x/i.test(String(sk))) { out.hayWidget = true; out.sitekey = String(sk); return out; }
          } catch (e) { /* */ }
          // ¿Hay Turnstile? Señales: input de respuesta, div.cf-turnstile o el iframe.
          const resp = document.querySelector('[name="cf-turnstile-response"], [id^="cf-chl-widget"]');
          const div = document.querySelector(".cf-turnstile, [data-sitekey]") as HTMLElement | null;
          const ifr = Array.from(document.querySelectorAll("iframe")).map((f) => (f as HTMLIFrameElement).src || "");
          const cfIfr = ifr.find((s) => /challenges\.cloudflare\.com/.test(s));
          out.hayWidget = Boolean(resp || div || cfIfr);
          // 1) data-sitekey en el div.
          if (div?.getAttribute("data-sitekey")) { out.sitekey = div.getAttribute("data-sitekey"); return out; }
          // 2) sitekey en el src del iframe de cloudflare.
          if (cfIfr) {
            const m = /\/(0x[a-zA-Z0-9_-]+)\//.exec(cfIfr) || /[?&]k=([^&]+)/.exec(cfIfr);
            if (m) { out.sitekey = decodeURIComponent(m[1]); return out; }
          }
          // 3) Fallback: sitekey Turnstile (0x4AAAAAAA…) en el HTML/JS de la página.
          const html = document.documentElement.outerHTML;
          const m2 = /(0x4[A-Za-z0-9_-]{20,})/.exec(html) || /sitekey["']?\s*[:=]\s*["']([^"']+)["']/i.exec(html);
          if (m2) out.sitekey = m2[1];
          return out;
        })
        .catch(() => null as any);
      if (r?.hayWidget) {
        let url = "";
        try { url = fr.url(); } catch { /* */ }
        if (!url || url === "about:blank") url = page.url();
        return { sitekey: r.sitekey || "", url, tipo: "turnstile", sinSitekey: !r.sitekey };
      }
    }
  }
  return null;
}

/** Engancha `turnstile.render` ANTES de que SUNAT lo llame, para capturar el
 *  sitekey (que va como parámetro JS, no como data-sitekey). Debe llamarse justo
 *  tras crear el contexto (aplica a todos los frames que se creen después). */
export async function hookTurnstileSitekey(ctx: any): Promise<void> {
  try {
    await ctx.addInitScript(() => {
      try {
        let _ts: any;
        const wrap = (ts: any) => {
          if (!ts || ts.__radarWrapped) return ts;
          const origRender = ts.render;
          if (typeof origRender === "function") {
            ts.render = function (this: any, ...args: any[]) {
              try {
                const p = args[1] || args[0];
                if (p && p.sitekey) (window as any).__radarSitekey = p.sitekey;
                // Capturar el callback: SUNAT lo usa para continuar el envío tras
                // verificar. Lo dispararemos con el token que resuelva CapSolver.
                if (p && typeof p.callback === "function") (window as any).__radarTsCallback = p.callback;
                if (p && (p.action || p.cData)) (window as any).__radarTsExtra = { action: p.action, cData: p.cData };
              } catch (e) { /* */ }
              return origRender.apply(this, args);
            };
          }
          // getResponse: si SUNAT lee el token por aquí, devolver el nuestro.
          const origGet = ts.getResponse;
          if (typeof origGet === "function") {
            ts.getResponse = function (this: any, ...args: any[]) {
              try { if ((window as any).__radarTsToken) return (window as any).__radarTsToken; } catch (e) { /* */ }
              return origGet.apply(this, args);
            };
          }
          ts.__radarWrapped = true;
          return ts;
        };
        Object.defineProperty(window, "turnstile", {
          configurable: true,
          get() { return _ts; },
          set(v) { _ts = wrap(v); },
        });
      } catch (e) { /* */ }
    });
  } catch (e) { /* addInitScript no disponible en este runtime */ }
}

/** Fija el token de Turnstile y dispara el callback capturado en TODOS los frames
 *  (así SUNAT, que espera la verificación, continúa el POST del reporte). */
async function dispararTurnstileCallback(ctx: any, token: string): Promise<number> {
  let n = 0;
  for (const pg of ctx.pages()) {
    for (const fr of pg.frames()) {
      const hit = await fr
        .evaluate((tok: string) => {
          try {
            (window as any).__radarTsToken = tok;
            if (typeof (window as any).__radarTsCallback === "function") { (window as any).__radarTsCallback(tok); return 1; }
          } catch (e) { /* */ }
          return 0;
        }, token)
        .catch(() => 0);
      n += Number(hit) || 0;
    }
  }
  return n;
}

// ============================================================
//  reCAPTCHA v3 (invisible, por PUNTAJE) — el que bloquea el RTT
// ============================================================
// SUNAT corre reCAPTCHA v3 al Enviar: su JS llama grecaptcha.execute(sitekey,
// {action}) DESDE EL NAVEGADOR → el token se puntúa por la reputación de NUESTRA
// IP. Con IP de datacenter/proxy el puntaje es bajo y SUNAT no manda el reporte.
// SOLUCIÓN: que el token lo GENERE CapSolver (desde SU infraestructura de buena
// reputación) y lo INYECTAMOS. El puntaje queda alto sin depender de nuestra IP,
// así corremos el RTT como el buzón (sin proxy).

export interface RecaptchaV3Info { sitekey: string; action: string | null; url: string; hayCampo: boolean }

/** Engancha grecaptcha.execute para (a) capturar sitekey+action que usa SUNAT y
 *  (b) devolver NUESTRO token (window.__radarV3Token) cuando esté listo, en vez
 *  del que Google generaría con nuestra IP. No-op si algo falla. */
export async function hookRecaptchaV3(ctx: any): Promise<void> {
  try {
    await ctx.addInitScript(() => {
      try {
        const record = (args: any[]) => {
          try {
            const w = window as any;
            w.__radarRc = w.__radarRc || {};
            const sk = args && args[0];
            const opt = args && args[1];
            if (typeof sk === "string" && /^6L/i.test(sk)) w.__radarRc.sitekey = sk;
            if (opt && opt.action) w.__radarRc.action = String(opt.action);
          } catch (e) { /* */ }
        };
        const wrapExec = (orig: any) =>
          function (this: any, ...args: any[]) {
            record(args);
            const w = window as any;
            if (w.__radarV3Token) return Promise.resolve(w.__radarV3Token);
            return orig.apply(this, args);
          };
        const wrapGre = (g: any) => {
          if (!g || g.__radarV3) return g;
          try {
            if (typeof g.execute === "function") g.execute = wrapExec(g.execute);
            if (g.enterprise && typeof g.enterprise.execute === "function") g.enterprise.execute = wrapExec(g.enterprise.execute);
            g.__radarV3 = true;
          } catch (e) { /* */ }
          return g;
        };
        let _g: any;
        Object.defineProperty(window, "grecaptcha", {
          configurable: true,
          get() { return _g; },
          set(v) { _g = wrapGre(v); },
        });
      } catch (e) { /* */ }
    });
  } catch (e) { /* addInitScript no disponible */ }
}

/** Detecta reCAPTCHA v3 en el frame CORRECTO (el del RTT, que tiene el campo
 *  tokenCaptchaV3). El sitekey de reCAPTCHA es EXACTO de 40 chars (6L+38): se
 *  extrae del ?render= del script o de una coincidencia acotada — un regex
 *  codicioso agarra base64 de otros frames (p. ej. el JWT de la campaña). */
export async function detectarRecaptchaV3(ctx: any): Promise<RecaptchaV3Info | null> {
  let fallback: RecaptchaV3Info | null = null;
  for (const pg of ctx.pages()) {
    for (const fr of pg.frames()) {
      const r = await fr
        .evaluate(() => {
          const w = window as any;
          const cap = w.__radarRc || {};
          const hayCampo = !!document.querySelector('input[name="tokenCaptchaV3"], #tokenCaptchaV3, textarea[name="g-recaptcha-response"], [name="g-recaptcha-response"]');
          const esRtt = /reportetri|itreportetri/i.test(location.href);
          // Sitekey EXACTO (40 chars). 1) render= del script (lo más fiable).
          let sitekey: string | null = cap.sitekey && /^6L[0-9A-Za-z_-]{38}$/.test(cap.sitekey) ? cap.sitekey : null;
          const scripts = Array.from(document.querySelectorAll("script")) as HTMLScriptElement[];
          if (!sitekey) {
            const src = scripts.map((s) => s.src || "").find((u) => /recaptcha\/(api|enterprise)\.js/i.test(u)) || "";
            const m = /[?&]render=(6L[0-9A-Za-z_-]{38})(?![0-9A-Za-z_-])/.exec(src);
            if (m) sitekey = m[1];
          }
          const inline = scripts.map((s) => s.textContent || "").join("\n");
          if (!sitekey) {
            const m2 = /6L[0-9A-Za-z_-]{38}(?![0-9A-Za-z_-])/.exec(inline)
              || /6L[0-9A-Za-z_-]{38}(?![0-9A-Za-z_-])/.exec(document.documentElement.outerHTML);
            if (m2) sitekey = m2[0];
          }
          // Action: del hook, o rascada del JS inline (grecaptcha.execute(k,{action:'x'})).
          let action: string | null = cap.action || null;
          if (!action) {
            const ma = /execute\s*\([^,]+,\s*\{[^}]*action\s*:\s*['"]([A-Za-z0-9_\/-]+)['"]/.exec(inline)
              || /['"]action['"]\s*:\s*['"]([A-Za-z0-9_\/-]+)['"]/.exec(inline);
            if (ma) action = ma[1];
          }
          return sitekey ? { sitekey, action, hayCampo, esRtt } : null;
        })
        .catch(() => null as any);
      if (r?.sitekey) {
        let url = "";
        try { url = fr.url(); } catch { /* */ }
        if (!url || url === "about:blank") url = pg.url();
        const info: RecaptchaV3Info = { sitekey: r.sitekey, action: r.action, url, hayCampo: !!r.hayCampo };
        // El frame del RTT (con el campo o URL reportetri) es el bueno → devuélvelo.
        if (r.hayCampo || r.esRtt) return info;
        if (!fallback) fallback = info; // otro frame: solo si no aparece el del RTT
      }
    }
  }
  return fallback;
}

/** Pide a CapSolver un token de reCAPTCHA v3 (sin proxy: usa la IP de CapSolver,
 *  que tiene buena reputación → buen puntaje). Devuelve el token y, si falla, el
 *  motivo de CapSolver (sitekey inválido, saldo, key, etc.) para diagnóstico. */
async function capsolverRecaptchaV3(
  clientKey: string, sitekey: string, url: string, action: string | null
): Promise<{ token: string | null; error?: string; tipo?: string }> {
  let ultimoError = "";
  const pedir = async (type: string): Promise<string | null> => {
    const crear = await fetch(`${API_URL}/createTask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientKey,
        task: { type, websiteURL: url, websiteKey: sitekey, pageAction: action || "submit" },
      }),
    })
      .then((r) => r.json())
      .catch(() => null);
    if (!crear || crear.errorId || !crear.taskId) {
      ultimoError = crear ? `${crear.errorCode || ""} ${crear.errorDescription || ""}`.trim() || "createTask sin taskId" : "createTask sin respuesta";
      return null;
    }
    const hasta = Date.now() + MAX_MS;
    while (Date.now() < hasta) {
      await sleep(3000);
      const res = await fetch(`${API_URL}/getTaskResult`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientKey, taskId: crear.taskId }),
      })
        .then((r) => r.json())
        .catch(() => null);
      if (!res) continue;
      if (res.errorId) { ultimoError = `${res.errorCode || ""} ${res.errorDescription || ""}`.trim() || "getTaskResult errorId"; return null; }
      if (res.status === "ready") return res.solution?.gRecaptchaResponse ?? res.solution?.token ?? null;
    }
    ultimoError = "timeout esperando el token";
    return null;
  };
  // Primero v3 normal; si SUNAT usa Enterprise, reintenta con esa tarea.
  let token = await pedir("ReCaptchaV3TaskProxyLess");
  if (token) return { token, tipo: "v3" };
  token = await pedir("ReCaptchaV3EnterpriseTaskProxyLess");
  if (token) return { token, tipo: "v3-enterprise" };
  return { token: null, error: ultimoError.slice(0, 140) };
}

/** Resuelve el reCAPTCHA v3 (si lo hay y hay clave) e inyecta el token en el
 *  frame indicado: fija window.__radarV3Token (para que el hook lo devuelva) y
 *  los campos ocultos. Devuelve true si inyectó un token. No-op seguro. */
export async function resolverRecaptchaV3(ctx: any, frame: any, pasos: any[] = []): Promise<boolean> {
  let clientKey = (process.env.CAPSOLVER_KEY || "").trim();
  if (!clientKey) {
    try {
      const { getIntegraciones } = await import("./db");
      clientKey = (await getIntegraciones()).capsolverKey;
    } catch { /* */ }
  }
  const info = await detectarRecaptchaV3(ctx);
  if (!info) { pasos.push({ paso: "recaptchaV3", detectado: false, nota: "no se vio reCAPTCHA v3" }); return false; }
  if (!clientKey) {
    pasos.push({ paso: "recaptchaV3", detectado: true, sitekey: info.sitekey, action: info.action, resuelto: false, nota: "falta CAPSOLVER_KEY" });
    return false;
  }
  const sol = await capsolverRecaptchaV3(clientKey, info.sitekey, info.url, info.action);
  const token = sol.token;
  if (!token) {
    pasos.push({ paso: "recaptchaV3", detectado: true, sitekey: info.sitekey, action: info.action, url: info.url, resuelto: false, nota: "CapSolver no devolvió token v3", capsolverError: sol.error });
    return false;
  }
  const destino = frame || (ctx.pages()[0] && ctx.pages()[0].mainFrame());
  const inyecciones = await destino
    .evaluate((tok: string) => {
      const w = window as any;
      w.__radarV3Token = tok; // el hook de grecaptcha.execute lo devolverá
      let puestos = 0;
      const sel = ['input[name="tokenCaptchaV3"]', "#tokenCaptchaV3", 'textarea[name="g-recaptcha-response"]', 'input[name="g-recaptcha-response"]', "#g-recaptcha-response"];
      for (const s of sel) document.querySelectorAll(s).forEach((el) => { (el as HTMLInputElement).value = tok; puestos++; });
      // Envuelve execute AHORA (ya existe con seguridad) para devolver nuestro token.
      try {
        const g = (window as any).grecaptcha;
        const wrap = () => () => Promise.resolve(tok);
        if (g && typeof g.execute === "function") g.execute = wrap();
        if (g && g.enterprise && typeof g.enterprise.execute === "function") g.enterprise.execute = wrap();
      } catch (e) { /* */ }
      return puestos;
    }, token)
    .catch(() => 0);
  pasos.push({ paso: "recaptchaV3", detectado: true, sitekey: info.sitekey, action: info.action, resuelto: true, proveedor: "capsolver", tipo: sol.tipo, inyecciones });
  return true;
}

// ============================================================
//  reCAPTCHA que APARECE al Enviar (SUNAT RTT): invisible/v2 con desafío
// ============================================================
// El RTT muestra el captcha DESPUÉS de dar Enviar (una capa translúcida con el
// desafío de imágenes). Antes de Enviar no hay sitekey en el DOM. Aquí:
//  - volcarCaptcha: vuelca la estructura (para diagnóstico: iframes, sitekeys…).
//  - detectarRecaptchaPost: halla el sitekey (del iframe anchor ?k=, del div
//    data-sitekey o del render=), y si es v2 (hay anchor/bframe/campo) o v3.
//  - resolverRecaptchaAparecido: lo resuelve con CapSolver, inyecta el token y
//    dispara el callback de grecaptcha para que SUNAT continúe el envío.

/** Vuelca todo lo relacionado a captcha en cada frame (solo diagnóstico). */
export async function volcarCaptcha(ctx: any): Promise<any[]> {
  const out: any[] = [];
  for (const pg of ctx.pages()) {
    for (const fr of pg.frames()) {
      const info = await fr
        .evaluate(() => {
          const srcIframes = (Array.from(document.querySelectorAll("iframe")) as HTMLIFrameElement[])
            .map((f) => f.src || "")
            .filter((s) => /recaptcha|challenges\.cloudflare/i.test(s))
            .map((s) => s.slice(0, 160));
          const divs = (Array.from(document.querySelectorAll("[data-sitekey]")) as HTMLElement[])
            .map((d) => d.getAttribute("data-sitekey") || "");
          const scripts = (Array.from(document.querySelectorAll("script[src]")) as HTMLScriptElement[])
            .map((s) => s.src || "")
            .filter((u) => /recaptcha\/(api|enterprise)\.js/i.test(u))
            .map((s) => s.slice(0, 160));
          const hayCampoV3 = !!document.querySelector('#tokenCaptchaV3, [name="tokenCaptchaV3"]');
          const hayCampoV2 = !!document.querySelector('[name="g-recaptcha-response"], #g-recaptcha-response');
          const cfg = !!(window as any).___grecaptcha_cfg;
          if (!srcIframes.length && !divs.length && !scripts.length && !hayCampoV3 && !hayCampoV2) return null;
          return { iframes: srcIframes, divs, scripts, hayCampoV3, hayCampoV2, cfg };
        })
        .catch(() => null);
      if (info) {
        let url = "";
        try { url = fr.url(); } catch { /* */ }
        out.push({ url: (url || "").slice(0, 90), ...info });
      }
    }
  }
  return out;
}

export interface RecaptchaPost { sitekey: string; url: string; tipo: "v2" | "v3"; invisible: boolean; enterprise: boolean; hayBframe: boolean }

/** Halla el reCAPTCHA presente (tras Enviar): sitekey exacto y si es v2/v3. */
export async function detectarRecaptchaPost(ctx: any): Promise<RecaptchaPost | null> {
  let fallback: RecaptchaPost | null = null;
  for (const pg of ctx.pages()) {
    for (const fr of pg.frames()) {
      const r = await fr
        .evaluate(() => {
          const w = window as any;
          const ifr = (Array.from(document.querySelectorAll("iframe")) as HTMLIFrameElement[]).map((f) => f.src || "");
          const anchor = ifr.find((s) => /recaptcha\/(api2|enterprise)\/anchor/i.test(s)) || "";
          const bframe = ifr.find((s) => /recaptcha\/(api2|enterprise)\/bframe/i.test(s)) || "";
          const div = document.querySelector(".g-recaptcha[data-sitekey], [data-sitekey]") as HTMLElement | null;
          const scriptEnt = (Array.from(document.querySelectorAll("script[src]")) as HTMLScriptElement[])
            .map((s) => s.src || "").find((u) => /recaptcha\/enterprise\.js/i.test(u));
          let sitekey: string | null = null;
          let enterprise = !!scriptEnt || /enterprise/i.test(anchor + bframe);
          let invisible = true;
          let tipo: "v2" | "v3" = "v3";
          const from = anchor || bframe;
          if (from) { const m = /[?&]k=(6L[0-9A-Za-z_-]{38})(?![0-9A-Za-z_-])/.exec(from); if (m) { sitekey = m[1]; tipo = "v2"; } }
          if (!sitekey && div) {
            const dk = div.getAttribute("data-sitekey") || "";
            if (/^6L[0-9A-Za-z_-]{38}$/.test(dk)) {
              sitekey = dk; tipo = "v2";
              try { const rc = div.getBoundingClientRect(); if (div.offsetParent !== null && rc.width > 10 && rc.height > 10) invisible = false; } catch (e) { /* */ }
            }
          }
          if (!sitekey) {
            const sc = (Array.from(document.querySelectorAll("script[src]")) as HTMLScriptElement[])
              .map((s) => s.src || "").find((u) => /recaptcha\/(api|enterprise)\.js/i.test(u)) || "";
            const m = /[?&]render=(6L[0-9A-Za-z_-]{38})(?![0-9A-Za-z_-])/.exec(sc);
            if (m && m[1] !== "explicit") { sitekey = m[1]; tipo = (anchor || bframe || div) ? "v2" : "v3"; }
          }
          if (!sitekey && w.__radarRc && /^6L[0-9A-Za-z_-]{38}$/.test(w.__radarRc.sitekey || "")) sitekey = w.__radarRc.sitekey;
          const hayCampoV2 = !!document.querySelector('[name="g-recaptcha-response"], #g-recaptcha-response');
          const hayCampoV3 = !!document.querySelector('#tokenCaptchaV3, [name="tokenCaptchaV3"]');
          if (sitekey && (anchor || bframe || hayCampoV2)) tipo = "v2";
          return sitekey ? { sitekey, tipo, invisible, enterprise, hayBframe: !!bframe, hayCampoV2, hayCampoV3 } : null;
        })
        .catch(() => null as any);
      if (r?.sitekey) {
        let url = "";
        try { url = fr.url(); } catch { /* */ }
        if (!url || url === "about:blank") url = pg.url();
        const info: RecaptchaPost = { sitekey: r.sitekey, url, tipo: r.tipo, invisible: r.invisible, enterprise: r.enterprise, hayBframe: r.hayBframe };
        if (r.hayCampoV2 || r.hayCampoV3 || r.hayBframe || /reportetri|itreportetri/i.test(url)) return info;
        if (!fallback) fallback = info;
      }
    }
  }
  return fallback;
}

/** Pide a CapSolver un token de reCAPTCHA v2 (checkbox o invisible). */
async function capsolverRecaptchaV2(
  clientKey: string, sitekey: string, url: string, invisible: boolean, enterprise: boolean
): Promise<{ token: string | null; error?: string; tipo?: string }> {
  let ultimoError = "";
  const pedir = async (type: string): Promise<string | null> => {
    const crear = await fetch(`${API_URL}/createTask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientKey,
        task: { type, websiteURL: url, websiteKey: sitekey, isInvisible: !!invisible },
      }),
    })
      .then((r) => r.json())
      .catch(() => null);
    if (!crear || crear.errorId || !crear.taskId) {
      ultimoError = crear ? `${crear.errorCode || ""} ${crear.errorDescription || ""}`.trim() || "createTask sin taskId" : "createTask sin respuesta";
      return null;
    }
    const hasta = Date.now() + MAX_MS;
    while (Date.now() < hasta) {
      await sleep(3000);
      const res = await fetch(`${API_URL}/getTaskResult`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientKey, taskId: crear.taskId }),
      })
        .then((r) => r.json())
        .catch(() => null);
      if (!res) continue;
      if (res.errorId) { ultimoError = `${res.errorCode || ""} ${res.errorDescription || ""}`.trim() || "getTaskResult errorId"; return null; }
      if (res.status === "ready") return res.solution?.gRecaptchaResponse ?? res.solution?.token ?? null;
    }
    ultimoError = "timeout esperando el token";
    return null;
  };
  const tipos = enterprise
    ? ["ReCaptchaV2EnterpriseTaskProxyLess", "ReCaptchaV2TaskProxyLess"]
    : ["ReCaptchaV2TaskProxyLess", "ReCaptchaV2EnterpriseTaskProxyLess"];
  for (const t of tipos) {
    const token = await pedir(t);
    if (token) return { token, tipo: t };
  }
  return { token: null, error: ultimoError.slice(0, 140) };
}

/** Inyecta un token de reCAPTCHA v2 en g-recaptcha-response de todos los frames y
 *  dispara el callback registrado en ___grecaptcha_cfg (así SUNAT continúa). */
async function inyectarV2YDisparar(ctx: any, token: string): Promise<number> {
  let total = 0;
  for (const pg of ctx.pages()) {
    for (const fr of pg.frames()) {
      const n = await fr
        .evaluate((tok: string) => {
          let puestos = 0;
          document.querySelectorAll('textarea[name="g-recaptcha-response"], #g-recaptcha-response, [name="g-recaptcha-response"]').forEach((el) => {
            (el as HTMLInputElement).value = tok;
            try { (el as HTMLElement).innerHTML = tok; } catch (e) { /* */ }
            puestos++;
          });
          // Disparar el callback de grecaptcha (invisible: es quien envía el form).
          try {
            const cfg = (window as any).___grecaptcha_cfg;
            if (cfg && cfg.clients) {
              const seen = new Set<any>();
              const visit = (o: any, d: number) => {
                if (!o || d > 7 || typeof o !== "object" || seen.has(o)) return;
                seen.add(o);
                for (const k of Object.keys(o)) {
                  let v: any;
                  try { v = o[k]; } catch (e) { continue; }
                  if (typeof v === "function" && (k === "callback" || k.toLowerCase().includes("callback"))) {
                    try { v(tok); puestos++; } catch (e) { /* */ }
                  } else if (v && typeof v === "object") visit(v, d + 1);
                }
              };
              Object.values(cfg.clients).forEach((c: any) => visit(c, 0));
            }
          } catch (e) { /* */ }
          return puestos;
        }, token)
        .catch(() => 0);
      total += Number(n) || 0;
    }
  }
  return total;
}

/** Resuelve el reCAPTCHA que APARECIÓ tras Enviar (v2 invisible/checkbox, o v3).
 *  Devuelve true si inyectó un token. Reporta pasos de diagnóstico. */
export async function resolverRecaptchaAparecido(ctx: any, pasos: any[] = []): Promise<boolean> {
  let clientKey = (process.env.CAPSOLVER_KEY || "").trim();
  if (!clientKey) {
    try { const { getIntegraciones } = await import("./db"); clientKey = (await getIntegraciones()).capsolverKey; } catch { /* */ }
  }
  const info = await detectarRecaptchaPost(ctx);
  if (!info) { pasos.push({ paso: "recaptcha-post", detectado: false, nota: "no apareció reCAPTCHA tras Enviar" }); return false; }
  if (!clientKey) {
    pasos.push({ paso: "recaptcha-post", detectado: true, tipo: info.tipo, sitekey: info.sitekey, resuelto: false, nota: "falta CAPSOLVER_KEY" });
    return false;
  }
  if (info.tipo === "v2" || info.hayBframe) {
    const sol = await capsolverRecaptchaV2(clientKey, info.sitekey, info.url, info.invisible, info.enterprise);
    if (!sol.token) {
      pasos.push({ paso: "recaptcha-post", detectado: true, tipo: "v2", sitekey: info.sitekey, url: info.url, invisible: info.invisible, enterprise: info.enterprise, resuelto: false, nota: "CapSolver no resolvió v2", capsolverError: sol.error });
      return false;
    }
    const inyecciones = await inyectarV2YDisparar(ctx, sol.token);
    pasos.push({ paso: "recaptcha-post", detectado: true, tipo: "v2", sitekey: info.sitekey, invisible: info.invisible, enterprise: info.enterprise, resuelto: true, proveedor: "capsolver", tarea: sol.tipo, inyecciones });
    return true;
  }
  // v3 puro (sin desafío visible): igual que resolverRecaptchaV3 pero con el
  // sitekey ya presente en el frame.
  const dest = ctx.pages()[0] && ctx.pages()[0].mainFrame();
  const okV3 = await resolverRecaptchaV3(ctx, dest, pasos).catch(() => false);
  return okV3;
}

/** ¿Se ve OTRO tipo de captcha (reCAPTCHA/hCaptcha)? Solo para diagnóstico. */
export async function detectarOtroCaptcha(ctx: any): Promise<string | null> {
  for (const pg of ctx.pages()) {
    for (const fr of pg.frames()) {
      const t = await fr
        .evaluate(() => {
          const html = document.documentElement.outerHTML;
          if (/g-recaptcha|recaptcha\/api|grecaptcha/.test(html)) return "recaptcha";
          if (/hcaptcha\.com|h-captcha/.test(html)) return "hcaptcha";
          return null;
        })
        .catch(() => null);
      if (t) return t;
    }
  }
  return null;
}

/** Pide a CapSolver un token de Turnstile (tarea sin proxy). null si falla. */
async function capsolverTurnstile(clientKey: string, sitekey: string, url: string): Promise<string | null> {
  // Crear tarea.
  const crear = await fetch(`${API_URL}/createTask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientKey,
      task: { type: "AntiTurnstileTaskProxyLess", websiteURL: url, websiteKey: sitekey },
    }),
  })
    .then((r) => r.json())
    .catch(() => null);
  if (!crear || crear.errorId || !crear.taskId) return null;

  // Sondear el resultado.
  const hasta = Date.now() + MAX_MS;
  while (Date.now() < hasta) {
    await sleep(3000);
    const res = await fetch(`${API_URL}/getTaskResult`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientKey, taskId: crear.taskId }),
    })
      .then((r) => r.json())
      .catch(() => null);
    if (!res) continue;
    if (res.errorId) return null;
    if (res.status === "ready") return res.solution?.token ?? res.solution?.gRecaptchaResponse ?? null;
    // status "processing" → seguir sondeando
  }
  return null;
}

/** Inyecta el token en los campos de respuesta de todos los frames.
 *  Devuelve cuántos campos llenó (para diagnóstico). */
async function inyectarToken(ctx: any, token: string): Promise<number> {
  let total = 0;
  for (const pg of ctx.pages()) {
    for (const fr of pg.frames()) {
      const n = await fr
        .evaluate((tok: string) => {
          const sel = [
            'input[name="cf-turnstile-response"]',
            'textarea[name="cf-turnstile-response"]',
            'input[name="g-recaptcha-response"]',
            'textarea[name="g-recaptcha-response"]',
            '[id^="cf-chl-widget"][id$="_response"]',
          ];
          let puestos = 0;
          for (const s of sel) {
            document.querySelectorAll(s).forEach((el) => {
              (el as HTMLInputElement).value = tok;
              puestos++;
            });
          }
          return puestos;
        }, token)
        .catch(() => 0);
      total += Number(n) || 0;
    }
  }
  return total;
}

/**
 * Resuelve el captcha si hay uno (y hay clave). No-op en caso contrario.
 * Empuja un paso al array de diagnóstico. Devuelve true si inyectó un token.
 */
export async function resolverCaptchaSiHay(ctx: any, page: any, pasos: any[] = [], disparar = true): Promise<boolean> {
  // Key: variable de entorno o la guardada por el supremo en la app.
  let clientKey = (process.env.CAPSOLVER_KEY || "").trim();
  if (!clientKey) {
    try {
      const { getIntegraciones } = await import("./db");
      clientKey = (await getIntegraciones()).capsolverKey;
    } catch { /* */ }
  }
  const tieneKey = !!clientKey;
  let info = await detectarTurnstile(ctx, page);
  // El sitekey se captura al correr turnstile.render; si aún no está, reintenta.
  for (let i = 0; i < 5 && info && info.sinSitekey; i++) {
    await page.waitForTimeout(1500).catch(() => {});
    info = await detectarTurnstile(ctx, page);
  }

  if (!info) {
    // Reporta si hay OTRO captcha (para saber que hay que adaptar el proveedor).
    const otro = await detectarOtroCaptcha(ctx);
    pasos.push(otro
      ? { paso: "captcha", detectado: otro, resuelto: false, tieneKey, nota: "tipo no soportado aún" }
      : { paso: "captcha", detectado: "ninguno", resuelto: false, tieneKey, nota: "no se vio widget" });
    return false;
  }

  if (info.sinSitekey) {
    pasos.push({ paso: "captcha", detectado: "turnstile", resuelto: false, tieneKey, nota: "widget presente pero no se pudo leer el sitekey", url: info.url });
    return false;
  }

  if (!clientKey) {
    pasos.push({ paso: "captcha", detectado: "turnstile", sitekey: info.sitekey, resuelto: false, nota: "falta CAPSOLVER_KEY" });
    return false;
  }

  const token = await capsolverTurnstile(clientKey, info.sitekey, info.url);
  if (!token) {
    pasos.push({ paso: "captcha", detectado: "turnstile", resuelto: false, nota: "CapSolver no devolvió token" });
    return false;
  }

  const inyecciones = await inyectarToken(ctx, token);
  // Disparar el callback de Turnstile (SUNAT espera la verificación para hacer el
  // POST del reporte). En diagnóstico (disparar=false) NO se dispara, para no enviar.
  let callbacks = 0;
  if (disparar) callbacks = await dispararTurnstileCallback(ctx, token);
  pasos.push({ paso: "captcha", detectado: "turnstile", sitekey: info.sitekey, resuelto: true, proveedor: "capsolver", inyecciones, callbacks, disparado: disparar });
  return true;
}

// ============================================================
//  Turnstile del RTT — usando las funciones PROPIAS de SUNAT
// ============================================================
// El RTT (sunatturnstile.js) expone globales: `turnstileSitekey` (la clave),
// `getTokenTurnstile()` (lo que enviarCorreo() lee para el POST) e `initTurnstile`.
// En vez de renderizar el widget (que un bot no pasa), leemos el sitekey, lo
// resolvemos con CapSolver y SOBRESCRIBIMOS getTokenTurnstile() para devolver
// NUESTRO token. Así enviarCorreo() manda el token válido y sale el cuadro verde.

/** Lee el sitekey de Turnstile del RTT (global de SUNAT o del HTML). "" si no. */
async function leerTurnstileSitekey(frame: any): Promise<string> {
  return (await frame
    .evaluate(() => {
      const w = window as any;
      const cand = [w.turnstileSitekey, w.__radarSitekey, w.sitekey].filter((s: any) => typeof s === "string");
      for (const s of cand) if (/^0x[A-Za-z0-9_-]{8,}$/.test(s)) return s;
      // Buscar en el JS inline / HTML: turnstileSitekey = '0x...' o data-sitekey.
      const html = document.documentElement.outerHTML;
      const m = /turnstileSitekey\s*[=:]\s*['"](0x[A-Za-z0-9_-]{8,})['"]/.exec(html)
        || /data-sitekey=['"](0x[A-Za-z0-9_-]{8,})['"]/.exec(html)
        || /(0x4[A-Za-z0-9_-]{8,})/.exec(html);
      return m ? m[1] : "";
    })
    .catch(() => "")) as string;
}

/** Resuelve el Turnstile del RTT y sobrescribe getTokenTurnstile() de SUNAT con
 *  el token de CapSolver. Devuelve true si lo aplicó. */
export async function resolverTurnstileSunat(ctx: any, frame: any, pasos: any[] = []): Promise<boolean> {
  let clientKey = (process.env.CAPSOLVER_KEY || "").trim();
  if (!clientKey) {
    try { const { getIntegraciones } = await import("./db"); clientKey = (await getIntegraciones()).capsolverKey; } catch { /* */ }
  }
  const sitekey = await leerTurnstileSitekey(frame);
  if (!sitekey) { pasos.push({ paso: "turnstile-sunat", detectado: false, nota: "no se halló turnstileSitekey" }); return false; }
  if (!clientKey) { pasos.push({ paso: "turnstile-sunat", detectado: true, sitekey, resuelto: false, nota: "falta CAPSOLVER_KEY" }); return false; }
  let url = "";
  try { url = frame.url(); } catch { /* */ }
  const token = await capsolverTurnstile(clientKey, sitekey, url);
  if (!token) { pasos.push({ paso: "turnstile-sunat", detectado: true, sitekey, resuelto: false, nota: "CapSolver no devolvió token" }); return false; }
  const aplicado = await frame
    .evaluate((tok: string) => {
      try {
        (window as any).__radarTsToken = tok;
        // Sobrescribir el accesor de SUNAT: enviarCorreo() lee getTokenTurnstile().
        (window as any).getTokenTurnstile = function () { return tok; };
        // Y rellenar cualquier campo de respuesta de Turnstile por si acaso.
        document.querySelectorAll('[name="cf-turnstile-response"], textarea[name="cf-turnstile-response"], #tokenCaptchaTurnstile').forEach((el) => { (el as HTMLInputElement).value = tok; });
        return { ok: true, tipoGetToken: typeof (window as any).getTokenTurnstile };
      } catch (e: any) { return { ok: false, err: String(e).slice(0, 80) }; }
    }, token)
    .catch(() => ({ ok: false }));
  pasos.push({ paso: "turnstile-sunat", detectado: true, sitekey, resuelto: true, proveedor: "capsolver", ...aplicado });
  return true;
}
