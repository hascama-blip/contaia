import crypto from "crypto";
import path from "path";
import { promises as fs } from "fs";
import * as XLSX from "xlsx";
import { DATA_DIR } from "./db";

// ============================================================
//  ISSOSOMA — costo por proyecto, relación de gastos y costo/beneficio
// ============================================================
// Lee DOS carpetas de Google Drive por CUENTA DE SERVICIO (solo lectura):
//   - PROYECTOS (costos): cada subcarpeta es un proyecto "INF-####-26-.. CLIENTE".
//       Dentro: "3. BITACORA_RENDICION/BITACORA-RENDICION-####.xlsx" con los gastos.
//   - VENTAS (ingresos): subcarpetas por mes; dentro, facturas electrónicas PDF
//       "FE001-####-(####-26 CLIENTE)-% .pdf". El código #### vincula al proyecto.
// Config por entorno:
//   GOOGLE_SERVICE_ACCOUNT_JSON  — JSON de la cuenta de servicio.
//   ISSOSOMA_DRIVE_FOLDER_ID     — carpeta de PROYECTOS (bitácoras).
//   ISSOSOMA_VENTAS_FOLDER_ID    — carpeta de VENTAS (facturas).
// El resultado se cachea en DATA_DIR/issosoma-cache.json (recálculo bajo demanda).

const SCOPE = "https://www.googleapis.com/auth/drive.readonly";
const MIME_FOLDER = "application/vnd.google-apps.folder";
const CACHE_PATH = path.join(DATA_DIR, "issosoma-cache.json");

export interface IssosomaConfig { folderId: string; ventasId: string; configurado: boolean; faltan: string[] }
export function issosomaConfig(): IssosomaConfig {
  const faltan: string[] = [];
  if (!(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "").trim()) faltan.push("GOOGLE_SERVICE_ACCOUNT_JSON");
  const folderId = (process.env.ISSOSOMA_DRIVE_FOLDER_ID || "").trim();
  if (!folderId) faltan.push("ISSOSOMA_DRIVE_FOLDER_ID");
  const ventasId = (process.env.ISSOSOMA_VENTAS_FOLDER_ID || "").trim();
  return { folderId, ventasId, configurado: faltan.length === 0, faltan };
}

// --- Cuenta de servicio (JWT RS256 → access token) --------------------------
const b64url = (s: Buffer | string) => Buffer.from(s).toString("base64url");
async function tokenServicio(): Promise<{ token: string; email: string }> {
  const raw = (process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "").trim();
  if (!raw) throw new Error("Falta GOOGLE_SERVICE_ACCOUNT_JSON");
  let sa: any;
  try { sa = JSON.parse(raw); } catch { throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON no es un JSON válido"); }
  if (!sa.client_email || !sa.private_key) throw new Error("El JSON del service account no trae client_email/private_key");
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(`${header}.${claim}`);
  const assertion = `${header}.${claim}.${b64url(signer.sign(sa.private_key))}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  const j: any = await res.json().catch(() => ({}));
  if (!j.access_token) throw new Error(`No se pudo autenticar la cuenta de servicio (${res.status})`);
  return { token: j.access_token, email: sa.client_email };
}

// --- Drive ------------------------------------------------------------------
interface DFile { id: string; name: string; mimeType: string; modifiedTime?: string }
async function listar(folderId: string, token: string): Promise<DFile[]> {
  const out: DFile[] = [];
  let pageToken = "";
  do {
    const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
    const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=nextPageToken,files(id,name,mimeType,modifiedTime)&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=allDrives${pageToken ? `&pageToken=${pageToken}` : ""}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error(`No se pudo listar la carpeta (${r.status}). ¿La compartiste con la cuenta de servicio?`);
    const j: any = await r.json();
    for (const f of (j.files ?? [])) out.push(f);
    pageToken = j.nextPageToken || "";
  } while (pageToken);
  return out;
}
async function bajar(id: string, token: string): Promise<Buffer> {
  const url = `https://www.googleapis.com/drive/v3/files/${id}?alt=media&supportsAllDrives=true`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`descarga ${id} (${r.status})`);
  return Buffer.from(await r.arrayBuffer());
}
// Ejecuta tareas con concurrencia limitada (para no saturar Drive).
async function pool<T, R>(items: T[], limite: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limite, items.length) }, async () => {
    while (i < items.length) { const idx = i++; try { out[idx] = await fn(items[idx]); } catch { out[idx] = undefined as any; } }
  }));
  return out;
}

// --- Parseo de montos y etiquetas -------------------------------------------
function toNum(v: any): number {
  if (typeof v === "number") return isFinite(v) ? v : 0;
  let s = String(v ?? "").trim();
  if (!s) return 0;
  const neg = /^-|-\s*S\/|^\(/.test(s);
  s = s.replace(/[^\d.,-]/g, "");
  if (s.includes(",") && s.includes(".")) s = s.replace(/,/g, "");
  else if (s.includes(",")) s = /,\d{1,2}$/.test(s) ? s.replace(",", ".") : s.replace(/,/g, "");
  const n = parseFloat(s);
  if (!isFinite(n)) return 0;
  return neg && n > 0 ? -n : n;
}
const codigoInf = (s: string): string => { const m = String(s || "").match(/(\d{3,4})-\d{2}/) || String(s || "").match(/INF[- ]?(\d{3,4})/i); return m ? m[1] : ""; };

// --- Bitácora (costos) ------------------------------------------------------
export interface ProyectoCosto {
  codigo: string; carpeta: string; cliente: string; responsable: string;
  costoLogistica: number; costoTotal: number; montoDepositado: number; saldo: number;
  gastos: { fecha: string; descripcion: string; monto: number }[];
  archivo: string;
}
function parseBitacora(buf: Buffer, carpeta: string): Omit<ProyectoCosto, "archivo"> {
  const wb = XLSX.read(buf, { type: "buffer" });
  // raw:false → valores FORMATEADOS como texto (fechas "24-Oct-26", montos
  // "S/ 265.50"); así se reconocen las filas de gasto. Se conservan las hojas
  // por separado (la plantilla nueva pone los gastos en hojas aparte).
  const hojas = wb.SheetNames.map((nombre) => ({
    nombre,
    filas: (XLSX.utils.sheet_to_json(wb.Sheets[nombre], { header: 1, blankrows: false, defval: "", raw: false }) as any[][]).map((r) => r.map((c) => (c == null ? "" : c))),
  }));
  const filas: any[][] = hojas.flatMap((h) => h.filas);
  const texto = (r: any[]) => r.map((c) => String(c).trim());
  // Valor numérico a la derecha de la 1ª celda que casa el regex.
  const valorEtiqueta = (rx: RegExp): number => {
    for (const r of filas) {
      const t = texto(r);
      const idx = t.findIndex((c) => rx.test(c));
      if (idx >= 0) for (let j = idx + 1; j < t.length; j++) if (/\d/.test(t[j])) return toNum(t[j]);
    }
    return 0;
  };
  const textoEtiqueta = (rx: RegExp): string => {
    for (const r of filas) {
      const t = texto(r);
      const idx = t.findIndex((c) => rx.test(c));
      if (idx >= 0) for (let j = idx + 1; j < t.length; j++) if (t[j]) return t[j];
    }
    return "";
  };
  const costoLogistica = valorEtiqueta(/GASTOS?\s*TOTAL\s*LOGISTICA/i);
  // Gran total (logística + personal): un "TOTAL" cercano, con valor ≥ logística.
  let costoTotal = 0;
  const idxLog = filas.findIndex((r) => texto(r).some((c) => /GASTOS?\s*TOTAL\s*LOGISTICA/i.test(c)));
  if (idxLog >= 0) {
    for (let k = idxLog; k < Math.min(filas.length, idxLog + 8); k++) {
      const t = texto(filas[k]);
      if (t.some((c) => /^TOTAL$/i.test(c))) { const n = Math.max(...t.map(toNum)); if (n >= costoLogistica) costoTotal = n; }
    }
  }
  if (!costoTotal) {
    const personal = filas.filter((r) => texto(r).some((c) => /PAGO A PERSONAL/i.test(c))).reduce((a, r) => a + Math.max(...texto(r).map(toNum)), 0);
    costoTotal = costoLogistica + personal;
  }
  // Relación de gastos operativos: en la plantilla nueva van en hojas aparte
  // ("GASTOS OPERATIVOS"/"GASTOS INFORMES"); en la vieja, inline en la bitácora.
  const esFecha = (c: string) => /^\d{1,2}[-/][A-Za-z]{3}[-/]\d{2,4}$|^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(c);
  const gastos: { fecha: string; descripcion: string; monto: number }[] = [];
  const empujar = (t: string[], fi: number) => {
    const desc = (t[fi + 1] || "").trim();
    const monto = toNum(t[fi + 2] ?? "");
    if (desc && monto && !/^total/i.test(desc)) gastos.push({ fecha: t[fi], descripcion: desc, monto });
  };
  for (const h of hojas) if (/GASTOS?\s*(OPERATIV|INFORME)/i.test(h.nombre)) for (const r of h.filas) { const t = texto(r); const fi = t.findIndex(esFecha); if (fi >= 0) empujar(t, fi); }
  if (!gastos.length) {
    const iniG = filas.findIndex((r) => texto(r).some((c) => /GASTOS OPERATIVOS/i.test(c)));
    if (iniG >= 0) for (let k = iniG; k < filas.length; k++) {
      const t = texto(filas[k]);
      if (t.some((c) => /GASTOS?\s*TOTAL\s*LOGISTICA/i.test(c))) break;
      const fi = t.findIndex(esFecha);
      if (fi >= 0) empujar(t, fi);
    }
  }
  const cliente = textoEtiqueta(/^CLIENTE:?$/i) || carpeta.replace(/INF[- ]?\d{3,4}-\d{2}-?\w*/i, "").trim();
  const responsable = textoEtiqueta(/ENCARGAD[OA]\s*DE\s*RENDICI/i);
  return {
    codigo: codigoInf(carpeta),
    carpeta, cliente, responsable,
    costoLogistica, costoTotal,
    montoDepositado: valorEtiqueta(/MONTO\s*DEPOSITADO/i),
    saldo: valorEtiqueta(/^SALDO/i),
    gastos: gastos.slice(0, 200),
  };
}

// --- Factura de venta (ingresos) --------------------------------------------
export interface FacturaVenta { codigo: string; cliente: string; valorVenta: number; importeTotal: number; detalle: string; archivo: string }
async function parseFacturaPdf(id: string, nombre: string, token: string): Promise<FacturaVenta | null> {
  let texto = "";
  try {
    const buf = await bajar(id, token);
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const r = await extractText(pdf, { mergePages: true });
    texto = Array.isArray(r.text) ? r.text.join(" ") : String(r.text || "");
  } catch { return null; }
  // Código del proyecto: en el NOMBRE va entre paréntesis "(4173-26-..)"; en el
  // texto, tras "UNIDAD 4173-26". Evita confundir con la serie "FE001-...".
  const codigo = nombre.match(/\((\d{3,4})-\d{2}/)?.[1]
    || texto.match(/UNIDAD\s+(\d{3,4})-\d{2}/i)?.[1]
    || texto.match(/C[oó]digo[\s:]*(\d{3,4})-\d{2}/i)?.[1]
    || "";
  const mVV = texto.match(/Valor\s*Venta\s*:?\s*S\/\.?\s*([\d.,]+)/i) || texto.match(/Sub\s*Total\s*Ventas\s*:?\s*S\/\.?\s*([\d.,]+)/i);
  const mIT = texto.match(/Importe\s*Total\s*:?\s*S\/\.?\s*([\d.,]+)/i);
  const mCli = texto.match(/Se[ñn]or\(es\)\s*:?\s*(.+?)\s*RUC/i);
  const valorVenta = mVV ? toNum(mVV[1]) : 0;
  const importeTotal = mIT ? toNum(mIT[1]) : 0;
  if (!codigo && !valorVenta && !importeTotal) return null;
  return { codigo, cliente: (mCli ? mCli[1].trim() : "").slice(0, 80), valorVenta, importeTotal, detalle: nombre.replace(/\.pdf$/i, ""), archivo: nombre };
}

// --- Análisis completo (costo/beneficio por proyecto) -----------------------
export interface ProyectoAnalisis {
  codigo: string; cliente: string; carpeta: string; responsable: string;
  venta: number; importeFacturado: number; costo: number; costoLogistica: number;
  utilidad: number; margen: number; saldo: number; nFacturas: number;
}
export interface IssosomaAnalisis {
  configurado: boolean; faltan?: string[]; cuentaServicio?: string;
  kpis: { venta: number; costo: number; utilidad: number; margen: number; proyectos: number; proyectosConVenta: number };
  proyectos: ProyectoAnalisis[];
  facturas: FacturaVenta[];
  gastos: { codigo: string; cliente: string; fecha: string; descripcion: string; monto: number }[];
  avisos: string[];
  generadoAt: string;
  error?: string;
}

export async function leerCache(): Promise<IssosomaAnalisis | null> {
  try { return JSON.parse(await fs.readFile(CACHE_PATH, "utf-8")); } catch { return null; }
}
async function guardarCache(a: IssosomaAnalisis): Promise<void> {
  try { await fs.mkdir(DATA_DIR, { recursive: true }); await fs.writeFile(CACHE_PATH, JSON.stringify(a)); } catch { /* */ }
}

/** Recalcula TODO desde Drive (costoso): bitácoras + facturas. Cachea el resultado. */
export async function recalcularIssosoma(): Promise<IssosomaAnalisis> {
  const cfg = issosomaConfig();
  const avisos: string[] = [];
  const base: IssosomaAnalisis = {
    configurado: cfg.configurado, faltan: cfg.faltan,
    kpis: { venta: 0, costo: 0, utilidad: 0, margen: 0, proyectos: 0, proyectosConVenta: 0 },
    proyectos: [], facturas: [], gastos: [], avisos, generadoAt: new Date().toISOString(),
  };
  if (!cfg.configurado) return base;
  const { token, email } = await tokenServicio();
  base.cuentaServicio = email;

  // 1) COSTOS: carpetas de proyecto → bitácora.
  const raizTodo = await listar(cfg.folderId, token);
  const raiz = raizTodo.filter((f) => f.mimeType === MIME_FOLDER && /INF[- ]?\d{3,4}/i.test(f.name));
  avisos.push(`Proyectos: ${raizTodo.length} elemento(s) en la carpeta; ${raiz.length} con patrón INF.`);
  const costos = await pool(raiz, 6, async (proj): Promise<ProyectoCosto | null> => {
    const hijos = await listar(proj.id, token);
    const bitFolder = hijos.find((h) => h.mimeType === MIME_FOLDER && /bitacora|rendicion/i.test(h.name));
    const cont = bitFolder ? await listar(bitFolder.id, token) : hijos;
    const xlsx = cont.find((c) => /bitacora|rendicion/i.test(c.name) && /\.xlsx?$/i.test(c.name) && !/^BITACORA-RENDICION-XXXX/i.test(c.name))
      || cont.find((c) => /bitacora|rendicion/i.test(c.name) && /\.xlsx?$/i.test(c.name));
    if (!xlsx) return null;
    const buf = await bajar(xlsx.id, token);
    return { ...parseBitacora(buf, proj.name), archivo: xlsx.name };
  });
  const costosOk = costos.filter(Boolean) as ProyectoCosto[];
  avisos.push(`Bitácoras con datos leídas: ${costosOk.length}.`);

  // 2) VENTAS: meses → facturas PDF.
  const facturas: FacturaVenta[] = [];
  if (cfg.ventasId) {
    const ventasTodo = await listar(cfg.ventasId, token);
    const meses = ventasTodo.filter((f) => f.mimeType === MIME_FOLDER);
    let pdfTotal = 0;
    for (const mes of meses) {
      const archivos = (await listar(mes.id, token)).filter((f) => /\.pdf$/i.test(f.name) && /^FE|factura|\(\d{3,4}-\d{2}/i.test(f.name));
      pdfTotal += archivos.length;
      const fs2 = await pool(archivos, 6, (f) => parseFacturaPdf(f.id, f.name, token));
      for (const f of fs2) if (f) facturas.push(f);
    }
    avisos.push(`Ventas: ${ventasTodo.length} elemento(s), ${meses.length} carpeta(s) de mes, ${pdfTotal} PDF candidatos, ${facturas.length} factura(s) parseada(s).`);
  } else {
    avisos.push("No se configuró ISSOSOMA_VENTAS_FOLDER_ID: no se pudo calcular la venta/beneficio (solo costos).");
  }
  base.facturas = facturas;

  // 3) MATCH por código → costo/beneficio.
  const ventaPorCod = new Map<string, { venta: number; importe: number; n: number }>();
  for (const f of facturas) {
    if (!f.codigo) continue;
    const o = ventaPorCod.get(f.codigo) ?? { venta: 0, importe: 0, n: 0 };
    o.venta += f.valorVenta; o.importe += f.importeTotal; o.n++; ventaPorCod.set(f.codigo, o);
  }
  const proyectos: ProyectoAnalisis[] = [];
  const vistos = new Set<string>();
  for (const c of costosOk) {
    const v = ventaPorCod.get(c.codigo) ?? { venta: 0, importe: 0, n: 0 };
    vistos.add(c.codigo);
    const utilidad = v.venta - c.costoTotal;
    proyectos.push({
      codigo: c.codigo, cliente: c.cliente, carpeta: c.carpeta, responsable: c.responsable,
      venta: v.venta, importeFacturado: v.importe, costo: c.costoTotal, costoLogistica: c.costoLogistica,
      utilidad, margen: v.venta ? utilidad / v.venta : 0, saldo: c.saldo, nFacturas: v.n,
    });
    for (const g of c.gastos) base.gastos.push({ codigo: c.codigo, cliente: c.cliente, ...g });
  }
  // Facturas de proyectos sin bitácora (venta sin costo todavía).
  for (const [cod, v] of ventaPorCod) {
    if (vistos.has(cod)) continue;
    const f = facturas.find((x) => x.codigo === cod);
    proyectos.push({ codigo: cod, cliente: f?.cliente || "", carpeta: "", responsable: "", venta: v.venta, importeFacturado: v.importe, costo: 0, costoLogistica: 0, utilidad: v.venta, margen: v.venta ? 1 : 0, saldo: 0, nFacturas: v.n });
  }
  proyectos.sort((a, b) => b.venta - a.venta);
  base.proyectos = proyectos;

  const venta = proyectos.reduce((a, p) => a + p.venta, 0);
  const costo = proyectos.reduce((a, p) => a + p.costo, 0);
  base.kpis = {
    venta, costo, utilidad: venta - costo, margen: venta ? (venta - costo) / venta : 0,
    proyectos: proyectos.length, proyectosConVenta: proyectos.filter((p) => p.venta > 0).length,
  };
  base.gastos = base.gastos.slice(0, 1000);
  await guardarCache(base);
  return base;
}

/** Devuelve el análisis cacheado (rápido). Si no hay caché, intenta recalcular. */
export async function analizarIssosoma(opts?: { refrescar?: boolean }): Promise<IssosomaAnalisis> {
  const cfg = issosomaConfig();
  if (!cfg.configurado) {
    return { configurado: false, faltan: cfg.faltan, kpis: { venta: 0, costo: 0, utilidad: 0, margen: 0, proyectos: 0, proyectosConVenta: 0 }, proyectos: [], facturas: [], gastos: [], avisos: [], generadoAt: new Date().toISOString() };
  }
  if (!opts?.refrescar) {
    const c = await leerCache();
    if (c) return c;
  }
  return recalcularIssosoma();
}
