// ============================================================
//  Caja virtual (cajavirtualvip.com): reportes diarios por sede
// ============================================================
// Web propia del grupo (PHP + jQuery, sin captcha). Con UNA sola sesión se saca, de cada sede y
// cada día del periodo: el PDF y el Excel del reporte de ingresos y lo que hay en la carpeta
// pública de Google Drive de ese día (REPORTE, DEPÓSITO, YAPE…).
//
// Cómo funciona la web por dentro (leído de su propio JavaScript, sin datos):
//   1) Ingreso      GET  data/clsusuario.php?tarea=1&usuario=&pass=            → "true"
//   2) Selección    GET  data/clsusuario.php?tarea=2&empresa=&sede=&fecha=&tc=3.22&nomempresa=&nomsede=&rubro=  → "true"
//      (index2.php: #cboEmpresa → #cboRubro → #cboSede, combos dependientes; #txtFecha)
//   3) Consulta     POST data/clsingreso.php  tarea=5&cedula=3|2&idresponsable=&fechaini=&fechafinal=&idcorredor=&codempresa=&codrubro=
//        cedula=3 → "Totales por Mes": una fila por sede/responsable y mes (la de la lupa)
//        cedula=2 → detalle de esa lupa: una fila por DÍA (idcajingreso, estado, keygoogledrive…)
//   4) PDF          GET  pdf/pdf_reporteIngresoMatriculaResponsablertp.php?idingreso=&respon=&sede=&fechaing=&estadoing=&vempresa=&codrubro=
//   5) Excel        GET  caja_reporteingresomatricularesponsableexcelx.php?(mismos parámetros)
//   6) Drive        https://drive.google.com/drive/folders/{keygoogledrive}  (carpeta pública)
// Los combos de la selección se leen con un navegador (ejecuta el JavaScript de la web, así no
// hay que adivinar sus pedidos internos); todo lo demás son pedidos directos con la cookie.
//
// La clave NO se guarda: se usa para abrir la sesión y la cookie queda en memoria ~30 minutos.

import { randomBytes } from "crypto";
import { lanzarNavegador } from "./navegador";

const BASE = (process.env.CAJA_VIRTUAL_URL ?? "https://cajavirtualvip.com").replace(/\/+$/, "");
const TTL_MS = 30 * 60 * 1000;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

export interface Opcion { id: string; nombre: string }
export interface RubroCaja extends Opcion { sedes: Opcion[] }
export interface EmpresaCaja extends Opcion { rubros: RubroCaja[] }

export interface DiaCaja {
  idingreso: string; sede: string; dia: string; fecha: string; estado: string;
  responsable: string; codempresa: string; drive: string;
  totalCurso: number; totalDeuda: number; totalPromotor: number; totalDetraccion: number; totalPago: number; deudaActual: number;
}
export interface SedeCaja {
  sede: string; responsable: string; periodo: string;
  totalCurso: number; totalDeuda: number; totalPago: number; deudaActual: number;
  dias: DiaCaja[];
}
export interface ArchivoCaja { nombre: string; data: Buffer }

interface Rutas { web: string; rol: string; codempresa: string; codrubro: string; pdf: string; pdfAntiguo: string; excel: string; idresponsableVer: string; cortes: { resp: string; antes: number }[] }
interface Sesion {
  id: string; duenio: string; cookies: Map<string, string>; usada: number;
  arbol: EmpresaCaja[]; rutas?: Rutas; entrada?: string;
}

// Sesiones abiertas (en memoria; sobreviven a la recarga en caliente del desarrollo).
const g = globalThis as unknown as { __cajaVirtual?: Map<string, Sesion> };
const sesiones = (g.__cajaVirtual ??= new Map<string, Sesion>());
function limpiar() { const ahora = Date.now(); for (const [k, s] of Array.from(sesiones.entries())) if (ahora - s.usada > TTL_MS) sesiones.delete(k); }

/** La sesión de este usuario de Radar (o error claro si venció). */
function sesionDe(id: string, duenio: string): Sesion {
  limpiar();
  const s = sesiones.get(id);
  if (!s || s.duenio !== duenio) throw new Error("La sesión de la caja virtual venció. Vuelve a conectar con tu usuario y clave.");
  s.usada = Date.now();
  return s;
}
export function cerrarSesionCaja(id: string, duenio: string): void { const s = sesiones.get(id); if (s && s.duenio === duenio) sesiones.delete(id); }

// ---------------------------------------------------------------- pedidos HTTP con la cookie
async function pedir(s: Pick<Sesion, "cookies">, ruta: string, init: { method?: string; body?: string; tiempoMs?: number } = {}): Promise<Response> {
  const res = await fetch(/^https?:/.test(ruta) ? ruta : `${BASE}/${ruta.replace(/^\/+/, "")}`, {
    method: init.method ?? "GET",
    body: init.body,
    headers: {
      "User-Agent": UA,
      Cookie: Array.from(s.cookies.entries()).map(([k, v]) => `${k}=${v}`).join("; "),
      ...(init.body ? { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "X-Requested-With": "XMLHttpRequest" } : {}),
    },
    signal: AbortSignal.timeout(init.tiempoMs ?? 45000),
  });
  for (const c of res.headers.getSetCookie?.() ?? []) { const m = /^([^=;\s]+)=([^;]*)/.exec(c); if (m) s.cookies.set(m[1], m[2]); }
  return res;
}
const qs = (o: Record<string, string | number>) => new URLSearchParams(Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v)]))).toString();

// ---------------------------------------------------------------- 1) conectar
/** Abre la sesión y lee empresas → rubros → sedes de la pantalla de selección. */
export async function conectarCaja(usuario: string, clave: string, duenio: string): Promise<{ sid: string; empresas: EmpresaCaja[]; diag: string[] }> {
  usuario = usuario.trim();
  if (!usuario || !clave) throw new Error("Escribe el usuario y la clave de la caja virtual.");
  const diag: string[] = [];
  const browser = await lanzarNavegador();
  try {
    const ctx = await browser.newContext({ userAgent: UA });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/index.php`, { waitUntil: "domcontentloaded", timeout: 45000 });
    // Mismo pedido que hace el botón Ingresar de la web (comparte las cookies del navegador).
    const r = await ctx.request.get(`${BASE}/data/clsusuario.php?${qs({ tarea: 1, usuario, pass: clave })}`, { timeout: 45000 });
    const txt = (await r.text()).trim();
    diag.push(`ingreso: HTTP ${r.status()} → "${txt.slice(0, 40)}"`);
    if (txt === "definida") throw new Error("La caja virtual dice que ya hay una sesión abierta con este usuario. Ciérrala en el navegador donde esté y vuelve a intentar.");
    if (txt !== "true") throw new Error("Usuario o contraseña incorrectos en la caja virtual.");

    await page.goto(`${BASE}/index2.php`, { waitUntil: "networkidle", timeout: 45000 });
    const opciones = async (sel: string): Promise<Opcion[]> =>
      (await page.$$eval(`${sel} option`, (os: any[]) => os.map((o) => ({ id: String(o.value ?? ""), nombre: String(o.textContent ?? "").trim() }))).catch(() => [] as Opcion[]))
        .filter((o: Opcion) => o.id && o.id !== "0" && o.nombre && !/^\(/.test(o.nombre));
    const elegir = async (sel: string, id: string) => {
      await page.selectOption(sel, id).catch(() => null);
      await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => null);
      await page.waitForTimeout(250);
    };
    const empresas: EmpresaCaja[] = [];
    const lista = await opciones("#cboEmpresa");
    diag.push(`selección: ${page.url()} · empresas ${lista.length}`);
    if (!lista.length) {
      const html = (await page.content()).replace(/\s+/g, " ").slice(0, 1500);
      diag.push(`index2 sin #cboEmpresa: ${html}`);
      throw new Error("Se ingresó a la caja virtual, pero no apareció la lista de empresas. La pantalla de selección cambió: hay que recalibrar.");
    }
    for (const e of lista) {
      await elegir("#cboEmpresa", e.id);
      const rubros: RubroCaja[] = [];
      for (const rb of await opciones("#cboRubro")) {
        await elegir("#cboRubro", rb.id);
        rubros.push({ ...rb, sedes: await opciones("#cboSede") });
      }
      // Empresas sin rubro (si las hubiera): las sedes cuelgan directo de la empresa.
      if (!rubros.length) { const sedes = await opciones("#cboSede"); if (sedes.length) rubros.push({ id: "", nombre: "", sedes }); }
      empresas.push({ ...e, rubros });
      diag.push(`· ${e.nombre}: ${rubros.map((x) => `${x.nombre || "(sin rubro)"} [${x.sedes.length} sedes]`).join(", ") || "sin rubros"}`);
    }
    const cookies = new Map<string, string>();
    for (const c of await ctx.cookies(BASE)) cookies.set(c.name, c.value);
    if (!cookies.size) throw new Error("La caja virtual no entregó la cookie de sesión.");
    limpiar();
    const sid = randomBytes(18).toString("hex");
    sesiones.set(sid, { id: sid, duenio, cookies, usada: Date.now(), arbol: empresas });
    return { sid, empresas, diag };
  } finally {
    await browser.close().catch(() => null);
  }
}

// ---------------------------------------------------------------- 2) entrar a empresa / rubro / sede
const dmy = (iso: string) => iso.split("-").reverse().join("/");           // AAAA-MM-DD → DD/MM/AAAA
const isoDe = (f: string) => { const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(f); return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : ""; };

async function entrar(s: Sesion, empresaId: string, rubroId: string, fechaIso: string, diag: string[]): Promise<Rutas> {
  const e = s.arbol.find((x) => x.id === empresaId);
  if (!e) throw new Error("Empresa no disponible para este usuario.");
  const rb = e.rubros.find((x) => x.id === rubroId) ?? e.rubros[0];
  const sede = rb?.sedes[0];
  if (!rb || !sede) throw new Error(`${e.nombre}: no tiene sedes disponibles para este usuario.`);
  const clave = `${e.id}|${rb.id}`;
  if (s.entrada === clave && s.rutas) return s.rutas;
  const r = await pedir(s, `data/clsusuario.php?${qs({ tarea: 2, empresa: e.id, sede: sede.id, fecha: dmy(fechaIso), tc: 3.22, nomempresa: e.nombre, nomsede: sede.nombre, rubro: rb.id })}`);
  const txt = (await r.text()).trim();
  diag.push(`selección ${e.nombre} / ${rb.nombre} / ${sede.nombre}: HTTP ${r.status} → "${txt.slice(0, 40)}"`);
  if (txt !== "true") throw new Error(`La caja virtual no aceptó la selección de ${e.nombre} (respondió "${txt.slice(0, 60) || "vacío"}").`);

  // Pantalla principal → enlace de "Consulta Ingreso" (cambia por empresa: …ingresortp, …ingreso…).
  const caja = await (await pedir(s, "caja.php")).text();
  const web = /caja\.php\?web=(caja_consultaingreso\w*)/i.exec(caja)?.[1] ?? "caja_consultaingresortp";
  const html = await (await pedir(s, `caja.php?web=${web}`)).text();
  const js = html.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const cuerpo = (nombre: string) => { const i = js.search(new RegExp(`function\\s+${nombre}\\s*\\(`)); if (i < 0) return ""; const j = js.slice(i + 10).search(/\n\s*function\s+\w+\s*\(/); return js.slice(i, j < 0 ? i + 4000 : i + 10 + j); };
  const ver = cuerpo("ver"), exp = cuerpo("exportaringreso"), rec = cuerpo("recuperarlistadoingreso");
  const abre = (t: string) => Array.from(t.matchAll(/window\.open\(\s*"([\w./-]+\.php)\?idingreso=/g)).map((m) => m[1]);
  const pdfs = abre(ver);
  const rutas: Rutas = {
    web,
    rol: /var\s+rol\s*=\s*['"]([^'"]*)['"]/.exec(js)?.[1] ?? "",
    codempresa: /var\s+codempresa\s*=\s*"([^"]*)"/.exec(rec)?.[1] ?? "",
    codrubro: /var\s+codrubro\s*=\s*"([^"]*)"/.exec(rec)?.[1] ?? "",
    pdf: pdfs[pdfs.length - 1] ?? "pdf/pdf_reporteIngresoMatriculaResponsablertp.php",
    pdfAntiguo: pdfs[0] ?? "pdf/pdf_reporteIngresortp.php",
    excel: abre(exp)[0] ?? "caja_reporteingresomatricularesponsableexcelx.php",
    idresponsableVer: /\bidresponsable\s*=\s*"([^"]*)"/.exec(ver)?.[1] ?? "",
    cortes: Array.from(ver.matchAll(/idresponsable\s*==\s*"(\d+)"\s*\)\s*\{\s*if\s*\(\s*id\s*<\s*(\d+)/g)).map((m) => ({ resp: m[1], antes: Number(m[2]) })),
  };
  diag.push(`consulta: ${web} · rol "${rutas.rol}" · empresa "${rutas.codempresa}" · rubro "${rutas.codrubro}" · pdf ${rutas.pdf} · excel ${rutas.excel}${html.length < 3000 ? ` · ⚠ página corta (${html.length})` : ""}`);
  s.entrada = clave; s.rutas = rutas;
  return rutas;
}

// ---------------------------------------------------------------- 3) consulta de ingresos
/** La web devuelve un objeto JavaScript (lo abre con eval): JSON estricto o con llaves sin comillas. */
function leerLista(txt: string): any[] | null {
  const t = txt.trim().replace(/^\uFEFF/, "");
  if (!t || /^(null|false|0)$/i.test(t)) return [];
  const aLista = (v: any) => (Array.isArray(v) ? v : v && typeof v === "object" ? Object.values(v) : null);
  try { return aLista(JSON.parse(t)); } catch { /* formato JavaScript */ }
  try { return aLista(JSON.parse(t.replace(/([{,]\s*)([A-Za-z_]\w*)\s*:/g, '$1"$2":').replace(/'([^'\\]*)'/g, '"$1"'))); } catch { return null; }
}
const n = (v: unknown) => { const x = typeof v === "number" ? v : Number(String(v ?? "").replace(/,/g, "")); return Number.isFinite(x) ? Math.round(x * 100) / 100 : 0; };
const t = (v: unknown) => (v == null ? "" : String(v).trim());

async function consulta(s: Sesion, r: Rutas, cedula: 2 | 3, idresponsable: string | number, idcorredor: string | number, fini: string, ffin: string): Promise<any[]> {
  const res = await pedir(s, "data/clsingreso.php", { method: "POST", body: qs({ tarea: 5, cedula, idresponsable, fechaini: fini, fechafinal: ffin, idcorredor, codempresa: r.codempresa, codrubro: r.codrubro }) });
  const txt = await res.text();
  const lista = leerLista(txt);
  if (lista === null) throw new Error(`La caja virtual respondió algo que no se pudo leer (HTTP ${res.status}): ${txt.replace(/\s+/g, " ").slice(0, 160)}`);
  return lista;
}

/** Fechas del detalle de una lupa, igual que la web (`vertotalmes`): el mes de la fila, recortado al rango pedido. */
function rangoDeFila(periodo: string, fini: string, ffin: string): [string, string] {
  const [mm, yyyy] = periodo.split("/");
  const ult = new Date(Number(yyyy), Number(mm), 0).getDate();
  const pri = `01/${mm.padStart(2, "0")}/${yyyy}`, fin = `${String(ult).padStart(2, "0")}/${mm.padStart(2, "0")}/${yyyy}`;
  const per = (f: string) => f.slice(6, 10) + f.slice(3, 5), este = yyyy + mm.padStart(2, "0");
  if (per(fini) === per(ffin)) return [fini, ffin];
  if (este === per(fini)) return [fini, fin];
  if (este === per(ffin)) return [pri, ffin];
  return [pri, fin];
}

/** Todas las sedes (lupas) del rango y, de cada una, todos sus días. */
export async function listarCaja(sid: string, duenio: string, p: { empresa: string; rubro: string; desde: string; hasta: string }): Promise<{ sedes: SedeCaja[]; diag: string[] }> {
  const s = sesionDe(sid, duenio);
  const diag: string[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.desde) || !/^\d{4}-\d{2}-\d{2}$/.test(p.hasta) || p.desde > p.hasta) throw new Error("Rango de fechas inválido.");
  const r = await entrar(s, p.empresa, p.rubro, p.hasta, diag);
  const fini = dmy(p.desde), ffin = dmy(p.hasta);
  // "Totales por Mes" tal como lo arma el botón Buscar de la web según el rol del usuario.
  const todasLasSedes = ["A", "E", "C"].includes(r.rol);
  const totales = await consulta(s, r, 3, 0, todasLasSedes ? 0 : "", fini, ffin);
  diag.push(`totales por mes: ${totales.length} fila(s)`);
  const sedes: SedeCaja[] = [];
  for (const f of totales) {
    const periodo = t(f.fecha);
    if (!/^\d{1,2}\/\d{4}$/.test(periodo)) { diag.push(`fila sin periodo reconocible: ${JSON.stringify(f).slice(0, 160)}`); continue; }
    const [a, b] = rangoDeFila(periodo, fini, ffin);
    const filas = await consulta(s, r, 2, t(f.idresponsable) || 0, 0, a, b);
    const dias: DiaCaja[] = filas.map((d) => ({
      idingreso: t(d.idcajingreso), sede: t(d.nomcorredor), dia: t(d.nomdia), fecha: isoDe(t(d.fecha)) || t(d.fecha), estado: t(d.nomestado),
      responsable: [t(d.nomresponsable), t(d.aparesponsable), t(d.amaresponsable)].filter(Boolean).join(" "),
      codempresa: t(d.codempresa), drive: t(d.keygoogledrive),
      totalCurso: n(d.totalgeneral), totalDeuda: n(d.pendiente), totalPromotor: n(d.promotor), totalDetraccion: n(d.detraccionigv), totalPago: n(d.totalingreso), deudaActual: n(d.pendientereal),
    })).filter((d) => d.idingreso);
    sedes.push({
      sede: t(f.nomcorredor), responsable: t(f.nomresponsable), periodo,
      totalCurso: n(f.totalgeneral), totalDeuda: n(f.pendiente), totalPago: n(f.totalingreso), deudaActual: n(f.pendientereal), dias,
    });
  }
  return { sedes, diag };
}

// ---------------------------------------------------------------- 4–6) archivos de un día
const limpio = (x: string) => x.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w.() -]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 90) || "archivo";
const nombreDe = (res: Response) => { const cd = res.headers.get("content-disposition") ?? ""; const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd); try { return m ? decodeURIComponent(m[1]) : ""; } catch { return m?.[1] ?? ""; } };

/** Carpeta PÚBLICA de Drive: lista sus archivos sin cuenta de Google (vista incrustada). */
export async function listarDrive(key: string): Promise<{ archivos: { id: string; nombre: string }[]; publica: boolean }> {
  if (!/^[\w-]{10,}$/.test(key)) return { archivos: [], publica: false };
  const res = await fetch(`https://drive.google.com/embeddedfolderview?id=${key}`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(30000) });
  if (!res.ok || /accounts\.google\.com/.test(res.url)) return { archivos: [], publica: false };
  const html = await res.text();
  const archivos = Array.from(html.matchAll(/id="entry-([\w-]+)"[\s\S]*?href="([^"]+)"[\s\S]*?flip-entry-title">([^<]*)/g))
    .filter((m) => /\/file\/d\//.test(m[2]))   // solo archivos (las subcarpetas no se bajan)
    .map((m) => ({ id: m[1], nombre: m[3].replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim() }));
  return { archivos, publica: true };
}
async function bajarDrive(id: string): Promise<Buffer | null> {
  for (const url of [`https://drive.google.com/uc?export=download&id=${id}`, `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`]) {
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(60000) }).catch(() => null);
    if (!res?.ok) continue;
    const buf = Buffer.from(await res.arrayBuffer());
    // Una página HTML aquí es el aviso de Google (archivo grande / sin permiso), no el archivo.
    if (/text\/html/i.test(res.headers.get("content-type") ?? "") && /<html/i.test(buf.subarray(0, 300).toString("latin1"))) continue;
    if (buf.length) return buf;
  }
  return null;
}

/** PDF + Excel del reporte de ese día y los archivos de su carpeta de Drive. Nunca lanza por un archivo: deja nota. */
export async function archivosDelDia(sid: string, duenio: string, p: { empresa: string; rubro: string; dia: DiaCaja; pdf?: boolean; excel?: boolean; drive?: boolean }): Promise<{ archivos: ArchivoCaja[]; notas: string[] }> {
  const s = sesionDe(sid, duenio);
  const r = await entrar(s, p.empresa, p.rubro, /^\d{4}-\d{2}-\d{2}$/.test(p.dia.fecha) ? p.dia.fecha : new Date().toISOString().slice(0, 10), []);
  const d = p.dia;
  const archivos: ArchivoCaja[] = [], notas: string[] = [];
  const params = qs({ idingreso: d.idingreso, respon: d.responsable, sede: d.sede, fechaing: /^\d{4}-/.test(d.fecha) ? dmy(d.fecha) : d.fecha, estadoing: d.estado, vempresa: d.codempresa, codrubro: r.codrubro });
  const esHtml = (b: Buffer) => /^\s*<(!doctype|html|br|b>|div)/i.test(b.subarray(0, 200).toString("latin1"));
  if (p.pdf !== false) {
    try {
      const antiguo = r.cortes.some((c) => c.resp === r.idresponsableVer && Number(d.idingreso) < c.antes);
      const res = await pedir(s, `${antiguo ? r.pdfAntiguo : r.pdf}?${params}`, { tiempoMs: 90000 });
      const buf = Buffer.from(await res.arrayBuffer());
      if (res.ok && buf.subarray(0, 5).toString("latin1") === "%PDF-") archivos.push({ nombre: limpio(nombreDe(res) || `Reporte_Ingreso_${d.fecha}.pdf`), data: buf });
      else notas.push(`PDF: la caja virtual no entregó un PDF (HTTP ${res.status}, ${buf.length} bytes).`);
    } catch (e) { notas.push(`PDF: ${e instanceof Error ? e.message : "error"}`); }
  }
  if (p.excel !== false) {
    try {
      const res = await pedir(s, `${r.excel}?${params}`, { tiempoMs: 90000 });
      const buf = Buffer.from(await res.arrayBuffer());
      const zip = buf.subarray(0, 2).toString("latin1") === "PK", ole = buf.subarray(0, 4).toString("hex") === "d0cf11e0";
      // Muchas webs PHP entregan el "Excel" como una tabla HTML con extensión .xls: Excel la abre igual.
      const tabla = !zip && !ole && /<table/i.test(buf.subarray(0, 4000).toString("latin1"));
      if (res.ok && buf.length > 200 && (zip || ole || tabla)) {
        const base = (nombreDe(res) || `Reporte_Ingreso_${d.fecha}`).replace(/\.(xlsx?|html?)$/i, "");
        archivos.push({ nombre: limpio(`${base}.${zip ? "xlsx" : "xls"}`), data: buf });
      } else notas.push(`Excel: la caja virtual no entregó el archivo (HTTP ${res.status}, ${buf.length} bytes${esHtml(buf) ? ", respondió una página" : ""}).`);
    } catch (e) { notas.push(`Excel: ${e instanceof Error ? e.message : "error"}`); }
  }
  if (p.drive !== false) {
    if (!d.drive) notas.push("Drive: este día no tiene carpeta creada en Google Drive.");
    else {
      try {
        const lista = await listarDrive(d.drive);
        if (!lista.publica) notas.push(`Drive: la carpeta no es pública o ya no existe (https://drive.google.com/drive/folders/${d.drive}).`);
        else if (!lista.archivos.length) notas.push("Drive: la carpeta está vacía.");
        const usados = new Set<string>();
        for (const a of lista.archivos.slice(0, 40)) {
          const buf = await bajarDrive(a.id);
          if (!buf) { notas.push(`Drive: no se pudo bajar "${a.nombre}".`); continue; }
          let nombre = limpio(a.nombre);
          for (let i = 2; usados.has(nombre.toLowerCase()); i++) nombre = limpio(a.nombre.replace(/(\.\w+)?$/, ` (${i})$1`));
          usados.add(nombre.toLowerCase());
          archivos.push({ nombre: `drive/${nombre}`, data: buf });
        }
      } catch (e) { notas.push(`Drive: ${e instanceof Error ? e.message : "error"}`); }
    }
  }
  return { archivos, notas };
}
