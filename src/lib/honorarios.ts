// ============================================================
//  Honorarios (RxH) — Consulta Receptor (SEE): extrae los Recibos por Honorarios
//  Electrónicos que la empresa RECIBIÓ (como receptor/pagador) para armar la
//  plantilla de importación a Contasis.
// ============================================================
// Reusa el MISMO scraping ya probado del buzón/RTT: login SOL + cerrar la
// campaña "valida tus datos" + entrar por el MENÚ. Ruta en el menú:
//   Empresas → Comprobantes de pago → SEE-SOL → Recibo por Honorarios
//   Electrónicos → "Consulta Receptor".
// El formulario "Consulta al SEE - Receptor" filtra por RANGO DE FECHAS
// (dd/mm/aaaa). Aquí SIEMPRE se consulta por MES(ES) COMPLETO(S): del día 1 del
// mes inicial al último día del mes final. Trae un REGISTRADOR de peticiones para
// capturar el endpoint de datos (sin DevTools).

import ExcelJS from "exceljs";
import { lanzarNavegador, bloquearRecursos } from "./navegador";

const LOGIN_URL =
  process.env.BUZON_LOGIN_URL ??
  "https://e-menu.sunat.gob.pe/cl-ti-itmenu/MenuInternet.htm?exe=01.04.00.00.000000";

export interface HonorariosParams {
  ruc: string;
  solUser: string;
  solPass: string;
  /** Mes inicial y final del rango, en "YYYYMM" (meses completos). Si falta
   *  `hasta`, se consulta solo el mes `desde`. */
  desde?: string;
  hasta?: string;
  diagnostico?: boolean;
}

export interface Recibo {
  fecha: string;        // fecha de emisión (dd/mm/aaaa)
  td: string;           // tipo doc (RH, NC, …)
  nro: string;          // serie-número (E001-72)
  estado: string;       // NO ANULADO / ANULADO / …
  tipoDocEmisor: string; // RUC / DNI
  nroDocEmisor: string;  // 10407428540
  nombre: string;        // apellidos y nombres / denominación
  tipoRenta: string;     // A / …
  gratuito: string;      // SI / NO
  moneda: string;        // SOLES / DÓLARES
  rentaBruta: string;
  impRenta: string;
  rentaNeta: string;
  pendiente: string;
  /** "Por concepto de …" del detalle del recibo (se usa como GLOSA). */
  concepto?: string;
}

export interface HonorariosResultado {
  ok: boolean;
  loginError?: boolean;
  error?: string;
  recibos?: Recibo[];
  total?: number;
  archivoBase64?: string;
  nombreArchivo?: string;
  diag?: { pasos: any[]; requests?: any[]; rango?: { fi: string; ff: string } };
}

/** Rango de fechas (dd/mm/aaaa) para MES(ES) COMPLETO(S) a partir de YYYYMM.
 *  La fecha FIN se topa a HOY: si el mes final está en curso, sus días futuros
 *  aún no existen en SUNAT y la consulta no devolvería nada. Por eso fecha fin =
 *  mínimo(último día del mes, hoy). */
export function rangoMeses(desde?: string, hasta?: string): { fi: string; ff: string } {
  const norm = (s?: string) => String(s || "").replace(/\D/g, "");
  const hoy = new Date();
  const d = norm(desde) || `${hoy.getFullYear()}${String(hoy.getMonth() + 1).padStart(2, "0")}`;
  const h = norm(hasta) || d;
  const y1 = +d.slice(0, 4), m1 = +d.slice(4, 6) || 1;
  const y2 = +h.slice(0, 4), m2 = +h.slice(4, 6) || 12;
  const p2 = (n: number) => String(n).padStart(2, "0");
  const fmt = (dt: Date) => `${p2(dt.getDate())}/${p2(dt.getMonth() + 1)}/${dt.getFullYear()}`;
  const finMes = new Date(y2, m2, 0); // último día del mes final
  const ffDate = finMes.getTime() > hoy.getTime() ? hoy : finMes; // topar a hoy
  return { fi: `01/${p2(m1)}/${y1}`, ff: fmt(ffDate) };
}

// ---- Helpers (copiados del flujo probado del RTT/buzón) ----
async function rellenar(page: any, selectores: string[], valor: string) {
  for (const sel of selectores) {
    try { const el = await page.$(sel); if (el) { await el.fill(valor); return true; } } catch { /* */ }
  }
  return false;
}
async function clickAny(page: any, selectores: string[]) {
  for (const sel of selectores) {
    try { const el = await page.$(sel); if (el) { await el.click(); return true; } } catch { /* */ }
  }
  return false;
}
function autoAceptarDialogos(ctx: any) {
  const enganchar = (pg: any) => pg.on("dialog", (d: any) => d.accept().catch(() => {}));
  ctx.pages().forEach(enganchar);
  ctx.on("page", enganchar);
}
function todosLosFrames(ctx: any): any[] {
  const out: any[] = [];
  for (const pg of ctx.pages()) for (const fr of pg.frames()) out.push(fr);
  return out;
}
async function clickEnFrame(frame: any, textos: string[]): Promise<string | null> {
  return frame.evaluate((textos: string[]) => {
    const norm = (s: any) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
    const els = Array.from(document.querySelectorAll('a, button, input[type="button"], input[type="submit"], [role="button"]')) as HTMLElement[];
    for (const t of textos) {
      const tl = norm(t);
      const el = els.find((e) => norm((e.textContent || "") + " " + ((e as HTMLInputElement).value || "")).includes(tl));
      if (el) { el.click(); return t; }
    }
    return null;
  }, textos).catch(() => null);
}
async function cerrarPantallas(ctx: any, page: any) {
  for (let i = 0; i < 6; i++) {
    const camp = ctx.pages().flatMap((p: any) => p.frames()).find((f: any) => /itadminforuc-modifdatos|campanha/i.test(f.url()));
    if (!camp) break;
    await clickEnFrame(camp, ["Finalizar"]); await page.waitForTimeout(1000);
    await clickEnFrame(camp, ["Continuar sin confirmar", "Continuar"]); await page.waitForTimeout(1200);
  }
}
/** Clic en el ENLACE REAL del menú por su texto; devuelve TODOS los onclick que
 *  coinciden (para saber cuál es la opción correcta cuando hay duplicados). */
async function clicMenu(ctx: any, textos: string[]): Promise<{ clico: string | null; candidatos: string[] }> {
  for (const pg of ctx.pages()) {
    for (const fr of pg.frames()) {
      const r = await fr.evaluate((textos: string[]) => {
        const norm = (s: any) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
        const els = Array.from(document.querySelectorAll("a,[onclick]")) as HTMLElement[];
        const candidatos: string[] = [];
        let clicado: string | null = null;
        for (const t of textos) {
          for (const e of els) {
            const oc = e.getAttribute("onclick") || "";
            if (/ejecuta\(|iconexecute/i.test(oc) && norm(e.textContent).includes(norm(t))) {
              candidatos.push(oc.slice(0, 160));
              if (!clicado) { e.click(); clicado = oc.slice(0, 160); }
            }
          }
          if (clicado) break;
        }
        return { clicado, candidatos };
      }, textos).catch(() => null as any);
      if (r && (r.clicado || (r.candidatos && r.candidatos.length))) return { clico: r.clicado, candidatos: r.candidatos };
    }
  }
  return { clico: null, candidatos: [] };
}

/** ¿Es el frame del formulario "Consulta SEE - Receptor"? (por su contenido). */
async function esFrameReceptor(fr: any): Promise<boolean> {
  return fr.evaluate(() => /Fecha De Inicio|RUC del Emisor|Emisi[oó]n Electr[oó]nica.*Receptor|Tipo de Comprobante/i.test(document.body?.innerText || "")).catch(() => false);
}

/** Rellena Fecha Inicio / Fecha Fin ubicando el input por su etiqueta. Devuelve
 *  los id/name hallados (para calibrar). */
async function llenarFechas(frame: any, fi: string, ff: string): Promise<any> {
  return frame.evaluate(({ fi, ff }: { fi: string; ff: string }) => {
    const norm = (s: any) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
    const inputsTxt = () => Array.from(document.querySelectorAll('input[type="text"], input:not([type])')) as HTMLInputElement[];
    const setByLabel = (needle: string, val: string) => {
      const labs = Array.from(document.querySelectorAll("td,label,th,div,span,b")) as HTMLElement[];
      const lab = labs.find((e) => norm(e.textContent).includes(needle) && norm(e.textContent).length < 60);
      if (!lab) return null;
      // input de texto en la misma fila; si no, el primer input de texto que sigue al label.
      const fila = lab.closest("tr") || lab.parentElement || document.body;
      let inp = fila.querySelector('input[type="text"], input:not([type])') as HTMLInputElement | null;
      if (!inp) inp = inputsTxt().find((i) => lab.compareDocumentPosition(i) & Node.DOCUMENT_POSITION_FOLLOWING) || null;
      if (inp) {
        inp.value = val;
        inp.dispatchEvent(new Event("input", { bubbles: true }));
        inp.dispatchEvent(new Event("change", { bubbles: true }));
        inp.dispatchEvent(new Event("blur", { bubbles: true }));
        return { id: inp.id || "", name: inp.name || "" };
      }
      return null;
    };
    return { inicio: setByLabel("fecha de inicio", fi), fin: setByLabel("fecha de fin", ff) };
  }, { fi, ff }).catch(() => null);
}

/** Vuelca la estructura visible de todos los frames (inputs/links/tabla). */
async function volcar(ctx: any): Promise<any> {
  const frames: any[] = [];
  for (const pg of ctx.pages()) {
    for (const fr of pg.frames()) {
      const info = await fr.evaluate(() => {
        const norm = (s: any) => String(s || "").replace(/\s+/g, " ").trim();
        const inputs = (Array.from(document.querySelectorAll("input,select,textarea,button")) as HTMLElement[])
          .map((e) => ({ t: e.tagName.toLowerCase(), tipo: (e as HTMLInputElement).type || "", id: (e as any).id || "", name: (e as any).name || "", ph: e.getAttribute("placeholder") || "", txt: norm(e.textContent).slice(0, 30) }))
          .slice(0, 70);
        const tablaCols = (Array.from(document.querySelectorAll("table th")) as HTMLElement[]).map((e) => norm(e.textContent)).filter(Boolean).slice(0, 30);
        const filas = (Array.from(document.querySelectorAll("table tbody tr")).slice(0, 3) as HTMLElement[])
          .map((tr) => Array.from(tr.querySelectorAll("td")).map((td) => norm(td.textContent).slice(0, 24)));
        return { titulo: norm(document.title), textoTop: norm((document.body?.innerText || "").slice(0, 180)), inputs, tablaCols, filas };
      }).catch(() => null);
      if (info && (info.inputs?.length || info.tablaCols?.length)) frames.push({ url: fr.url().slice(0, 130), ...info });
    }
  }
  return { frames };
}

/** Parsea las filas de recibos de la página actual (tabla HTML) + el rango
 *  "X a Y de N" para saber cuándo terminar la paginación. */
async function parsearPagina(frame: any): Promise<{ rows: Recibo[]; hasta: number; total: number }> {
  return frame.evaluate(() => {
    const norm = (s: any) => String(s || "").replace(/\s+/g, " ").trim();
    const esFecha = (s: string) => /^\d{2}\/\d{2}\/\d{4}$/.test(s);
    const rows: any[] = [];
    for (const tr of Array.from(document.querySelectorAll("tr"))) {
      const tds = Array.from(tr.querySelectorAll("td")).map((td) => norm(td.textContent));
      const di = tds.findIndex(esFecha);
      if (di < 0) continue;
      const c = tds.slice(di);
      // Fila de recibo: fecha + tipo doc (RH/NC/…) + serie-número + estado + …
      if (c.length >= 16 && /^(RH|NC|NR|OI)/i.test(c[1] || "") && /\d/.test(c[2] || "")) {
        rows.push({
          fecha: c[0], td: c[1], nro: c[2], estado: c[3],
          tipoDocEmisor: c[4], nroDocEmisor: c[5], nombre: c[6],
          tipoRenta: c[7], gratuito: c[8], moneda: c[9],
          rentaBruta: c[10], impRenta: c[11], rentaNeta: c[16] || c[10], pendiente: c[17] || "",
        });
      }
    }
    const m = /(\d+)\s*a\s*(\d+)\s*de\s*(\d+)/i.exec(norm(document.body?.innerText || ""));
    return { rows, hasta: m ? +m[2] : rows.length, total: m ? +m[3] : rows.length };
  }).catch(() => ({ rows: [], hasta: 0, total: 0 }));
}

/** Para cada recibo entra a su DETALLE (clic en el N° azul), lee el texto de
 *  "Por concepto de …" y vuelve a la lista con "Anterior". Con presupuesto de
 *  tiempo (deadline) para no exceder el máximo de la petición. */
async function extraerConceptos(ctx: any, page: any, frApp: () => any, rows: Recibo[], deadline: number) {
  const esLista = async () => (await frApp().evaluate(() => {
    const t = document.body?.innerText || "";
    return /\bde\s+\d+\b/i.test(t) && /FECHA\s+DESDE|Consulta al Sistema/i.test(t);
  }).catch(() => false)) as boolean;
  for (const r of rows) {
    if (Date.now() > deadline) break;
    // Clic EXACTO en el enlace del número de recibo (E001-…).
    const clico = await frApp().evaluate((nro: string) => {
      const as = Array.from(document.querySelectorAll("a")) as HTMLElement[];
      const el = as.find((a) => (a.textContent || "").replace(/\s+/g, " ").trim() === nro);
      if (el) { el.click(); return true; }
      return false;
    }, r.nro).catch(() => false);
    if (!clico) continue;
    // Esperar el detalle y leer el concepto.
    for (let i = 0; i < 12; i++) {
      await page.waitForTimeout(700).catch(() => {});
      const txt = (await frApp().evaluate(() => document.body?.innerText || "").catch(() => "")) as string;
      if (/Por concepto de/i.test(txt)) {
        const m = /Por concepto de\s*[:\-]?\s*(.+?)\s*(Observaci[oó]n\b|Inciso\b|Fecha de emisi|Total por honorarios|Lista de Pagos)/is.exec(txt);
        r.concepto = m ? m[1].replace(/\s+/g, " ").trim().slice(0, 300) : "";
        break;
      }
    }
    // Volver a la lista con "Anterior".
    await frApp().evaluate(() => {
      const els = Array.from(document.querySelectorAll('a,button,input[type="button"],input[type="submit"]')) as HTMLElement[];
      const b = els.find((e) => /anterior/i.test((e.textContent || "") + " " + ((e as HTMLInputElement).value || "")));
      if (b) b.click();
    }).catch(() => {});
    for (let i = 0; i < 12; i++) { await page.waitForTimeout(700).catch(() => {}); if (await esLista()) break; }
  }
}

const num = (s: string) => Number(String(s || "").replace(/[^\d.-]/g, "")) || 0;
const yyyymm = (fechaDMY: string) => {
  const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(fechaDMY || "");
  return m ? `${m[3]}${m[2]}` : "";
};
const ddmmyy = (fechaDMY: string) => {
  const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(fechaDMY || "");
  return m ? `${m[1]}/${m[2]}/${m[3].slice(2)}` : (fechaDMY || "");
};

/** Construye el Excel de importación a Contasis (21 columnas), replicando la
 *  plantilla real: CADA RECIBO = un asiento de 2 filas —
 *   • HABER (H): cuenta por PAGAR (42411001);
 *   • DEBE  (D): cuenta de GASTO (la asigna el contador → se deja VACÍA).
 *  El concepto ("Por concepto de …") va en GLOSA MOVIMIENTO. TIPO CAMBIO en
 *  blanco. Incluye recibos con RUC o DNI. Cuentas configurables por entorno. */
export async function construirExcelHonorarios(recibos: Recibo[], meta: { ruc: string; razonSocial?: string }): Promise<Buffer> {
  const D = (k: string, def = "") => (process.env[k] ?? def);
  const CTA_PAGAR = D("HONORARIOS_CTA_PAGAR");   // H (por pagar) — vacío por defecto
  const CTA_GASTO = D("HONORARIOS_CTA_GASTO");   // D (gasto) — vacío (contador)
  const SUBDIARIO = D("HONORARIOS_SUBDIARIO", "11");
  const DESTINO = D("HONORARIOS_DESTINO", "010");
  const CONV = D("HONORARIOS_CONV", "VTA");
  const CENTRO_D = D("HONORARIOS_CENTRO", "");   // centro de costos (D) — contador

  const HEADERS = [
    "CTA CONTABLE", "AÑO Y MES PROCESO", "SUBDIARIO", "COMPROBANTE", "FECHA DOCUMENTO",
    "TIPO ANEXO", "CODIGO DE ANEXO", "TIPO DOCUMENTO", "NRO DOCUMENTO", "FECHA VENCIMIENTO",
    "IMPORTE", "CONV", "FECHA REGISTRO", "TIPO CAMBIO", "GLOSA", "DESTINO DE COMPRA",
    "CENTRO DE COSTOS", "GLOSA MOVIMIENTO", "DOCUMENTO ANULADO", "DEBE / HABER", "NRO FILE",
  ];
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Honorarios");
  ws.addRow(HEADERS);
  ws.getRow(1).font = { bold: true };

  let corr = 0;
  for (const r of recibos) {
    corr++;
    const comprobante = String(corr).padStart(4, "0");
    const anioMes = yyyymm(r.fecha);
    const fecha = ddmmyy(r.fecha);
    const doc = (r.nroDocEmisor || "").replace(/\D/g, "");
    const tipoAnexo = doc.length === 8 ? "01" : "08"; // DNI=01, RUC=08 (ajustable)
    const nroDoc = (r.nro || "").replace(/-/g, "");    // E001-72 → E00172
    const importe = num(r.rentaBruta);
    const glosa = `HO  ${r.nro}        /`;
    const glosaMov = (r.concepto || r.nombre || "").trim();
    const anulado = /anulado/i.test(r.estado) && !/no\s*anulado/i.test(r.estado) ? "1" : "0";
    // Fila base del asiento (cambia CTA CONTABLE, CENTRO DE COSTOS y DEBE/HABER).
    const fila = (cta: string, centro: string, dh: string) => [
      cta, anioMes, SUBDIARIO, comprobante, fecha, tipoAnexo, r.nroDocEmisor, "HO", nroDoc, "",
      importe, CONV, fecha, "" /* TIPO CAMBIO en blanco */, glosa, DESTINO, centro, glosaMov, anulado, dh, "",
    ];
    ws.addRow(fila(CTA_PAGAR, "", "H"));       // por pagar (H)
    ws.addRow(fila(CTA_GASTO, CENTRO_D, "D")); // gasto (D) — cuenta vacía (contador)
  }
  return (await wb.xlsx.writeBuffer()) as Buffer;
}

// ============================================================
//  Bot
// ============================================================
export async function extraerHonorarios(params: HonorariosParams): Promise<HonorariosResultado> {
  const pasos: any[] = [];
  const requests: any[] = [];
  const rango = rangoMeses(params.desde, params.hasta);
  let browser: any = null;
  const tope = setTimeout(() => { if (browser) browser.close().catch(() => {}); }, 240000);
  try {
    browser = await lanzarNavegador();
    const ctx = await browser.newContext({
      acceptDownloads: true,
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    });
    await bloquearRecursos(ctx);
    autoAceptarDialogos(ctx);
    // REGISTRADOR de peticiones a SUNAT (para ver el endpoint de datos).
    ctx.on("request", (req: any) => {
      try {
        const url = req.url();
        const tipo = req.resourceType();
        if (!/sunat\.gob\.pe/i.test(url)) return;
        if (["xhr", "fetch", "document"].includes(tipo) && !/\.(js|css|png|jpg|gif|svg|woff2?|ico)(\?|$)/i.test(url)) {
          requests.push({ m: req.method(), t: tipo, url: url.slice(0, 220) });
          if (requests.length > 60) requests.shift();
        }
      } catch { /* */ }
    });
    const page = await ctx.newPage();

    // 1) Login SOL.
    let navOk = false;
    for (let i = 0; i < 3 && !navOk; i++) {
      try { await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 70000 }); navOk = true; }
      catch { await page.waitForTimeout(2000).catch(() => {}); }
    }
    await page.waitForTimeout(2500).catch(() => {});
    await rellenar(page, ["#txtRuc", 'input[name="ruc"]', "#ruc"], params.ruc);
    await rellenar(page, ["#txtUsuario", 'input[name="usuario"]', "#usuario"], params.solUser);
    await rellenar(page, ["#txtContrasena", 'input[type="password"]', "#password"], params.solPass);
    await clickAny(page, ["#btnAceptar", 'button[type="submit"]', 'input[type="submit"]']);
    await page.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(3000).catch(() => {});
    await cerrarPantallas(ctx, page);
    const url = page.url();
    const loginError = /oauth2\/error|autenticamenuinternet|problema en la aplicaci|no podemos atenderlo/i.test(url);
    pasos.push({ paso: "login", url, loginError });
    if (loginError) return { ok: false, loginError: true, error: "SUNAT rechazó el inicio de sesión (Usuario/Clave SOL o bloqueo temporal).", diag: { pasos, requests, rango } };

    // 2) Abrir "Consulta Receptor". La opción está muy anidada y duplicada, así
    //    que navegamos DIRECTO por su CÓDIGO de menú (capturado: 11.5.1.1.14),
    //    igual que hace ejecuta(): action=execute redirige al app cpelec001Alias.
    await cerrarPantallas(ctx, page);
    const MENU_CODE = process.env.HONORARIOS_MENU_CODE || "11.5.1.1.14";
    const EJECUTA_URL = `https://e-menu.sunat.gob.pe/cl-ti-itmenu/MenuInternet.htm?action=execute&code=${MENU_CODE}&s=ww1`;
    let via = "code";
    try { await page.goto(EJECUTA_URL, { waitUntil: "domcontentloaded", timeout: 60000 }); }
    catch { via = "code-err"; }
    await page.waitForTimeout(2500).catch(() => {});
    pasos.push({ paso: "menu-consulta-receptor", via, code: MENU_CODE, url: page.url().slice(0, 160) });

    // 3) Esperar el formulario "Consulta SEE - Receptor" (por contenido o URL).
    let appFrame: any = null;
    for (let i = 0; i < 15 && !appFrame; i++) {
      await page.waitForTimeout(1200).catch(() => {});
      await cerrarPantallas(ctx, page);
      for (const fr of todosLosFrames(ctx)) {
        const u = fr.url();
        if (/itreciboelectronico|cpelec001Alias/i.test(u) || await esFrameReceptor(fr)) { appFrame = fr; break; }
      }
      // Respaldo: si a mitad de camino no cargó, intentar por el menú (texto).
      if (!appFrame && i === 6) { await clicMenu(ctx, ["Consulta Receptor"]).catch(() => {}); }
    }
    pasos.push({ paso: "app-cargada", encontrada: !!appFrame, url: appFrame ? appFrame.url().slice(0, 160) : null });

    if (!appFrame) {
      return { ok: false, error: "No se abrió la Consulta Receptor. Revisa el acceso SOL / permisos del RUC.", diag: { pasos, requests, rango } };
    }

    // 4) Llenar el RANGO de fechas (meses completos, fin topada a hoy) y Buscar.
    const fechas = await llenarFechas(appFrame, rango.fi, rango.ff);
    pasos.push({ paso: "fechas", fi: rango.fi, ff: rango.ff, campos: fechas });
    await clickEnFrame(appFrame, ["Buscar", "Consultar"]).catch(() => {});
    await page.waitForTimeout(4000).catch(() => {});

    // 5) Leer la tabla y PAGINAR (Siguiente / número) hasta traer TODOS los
    //    recibos. Clave: tras pasar de página se ESPERA a que cambie el rango
    //    "X a Y de N" antes de leer (si no, se leía la página vieja/vacía).
    const frApp = () => todosLosFrames(ctx).find((f: any) => /itreciboelectronico|cpelec001Alias/i.test(f.url())) || appFrame;
    const rangoTxt = async (fr: any) => (await fr.evaluate(() => {
      const m = /(\d+)\s*a\s*(\d+)\s*de\s*(\d+)/i.exec(document.body?.innerText || "");
      return m ? m[0] : "";
    }).catch(() => "")) as string;
    // Clic EXACTO en el enlace de página siguiente ("Siguiente" o el número).
    const irSiguiente = async (fr: any, next: number): Promise<boolean> => (await fr.evaluate((next: number) => {
      const as = Array.from(document.querySelectorAll('a, input[type="button"], input[type="submit"]')) as HTMLElement[];
      const norm = (s: any) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
      let el = as.find((a) => /siguiente|>>|›|»/.test(norm(a.textContent) + " " + ((a as HTMLInputElement).value || "")));
      if (!el) el = as.find((a) => norm(a.textContent) === String(next));
      if (el) { el.click(); return true; }
      return false;
    }, next).catch(() => false)) as boolean;

    const recibos: Recibo[] = [];
    const vistos = new Set<string>();
    let total = 0;
    let pagina = 1;
    const deadlineConceptos = Date.now() + 235000; // presupuesto para leer conceptos
    for (let g = 0; g < 40; g++) {
      const fr = frApp();
      const { rows, hasta, total: t } = await parsearPagina(fr);
      if (t) total = t;
      const nuevos: Recibo[] = [];
      for (const r of rows) {
        const k = `${r.td}|${r.nro}|${r.nroDocEmisor}|${r.fecha}`;
        if (!vistos.has(k)) { vistos.add(k); recibos.push(r); nuevos.push(r); }
      }
      // Leer el "Por concepto de" de cada recibo de esta página (detalle → volver).
      await extraerConceptos(ctx, page, frApp, nuevos, deadlineConceptos).catch(() => {});
      if (total && hasta >= total) break;           // ya se leyó todo
      if (rows.length === 0 && g > 0) break;         // sin datos (no cortar en la 1ª)
      const antes = await rangoTxt(fr);
      const fue = await irSiguiente(fr, pagina + 1);
      if (!fue) break;
      // Esperar a que el rango cambie (la página nueva cargó) — hasta ~16s.
      let cambio = false;
      for (let i = 0; i < 16; i++) {
        await page.waitForTimeout(1000).catch(() => {});
        const ahora = await rangoTxt(frApp());
        if (ahora && ahora !== antes) { cambio = true; break; }
      }
      if (!cambio) break;
      pagina++;
    }
    pasos.push({ paso: "extraccion", total, leidos: recibos.length, paginas: pagina, muestra: recibos.slice(0, 3) });

    // 6) Diagnóstico: volcar estructura + muestra (no genera archivo).
    if (params.diagnostico) {
      const estructura = await volcar(ctx);
      pasos.push({ paso: "estructura", ...estructura });
      return { ok: recibos.length > 0, recibos, total, diag: { pasos, requests, rango } };
    }

    // 7) Real: construir el Excel con la plantilla de Contasis.
    if (recibos.length === 0) {
      return { ok: false, error: "No se encontraron recibos en ese rango (recuerda que la fecha fin se topa a hoy).", diag: { pasos, requests, rango } };
    }
    const buf = await construirExcelHonorarios(recibos, { ruc: params.ruc });
    const nombreArchivo = `Honorarios-${params.ruc}-${(params.desde || "").replace(/\D/g, "")}${params.hasta && params.hasta !== params.desde ? "_" + params.hasta.replace(/\D/g, "") : ""}.xlsx`;
    return { ok: true, recibos, total, archivoBase64: buf.toString("base64"), nombreArchivo, diag: { pasos, requests, rango } };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "Error extrayendo honorarios.", diag: { pasos, requests, rango } };
  } finally {
    clearTimeout(tope);
    if (browser) await browser.close().catch(() => {});
  }
}
