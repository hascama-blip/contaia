import crypto from "crypto";
import path from "path";
import { promises as fs } from "fs";
import * as XLSX from "xlsx";
import { DATA_DIR } from "./db";
import { consultarSunat, rucValido } from "./sunat";

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
// Caché POR ARCHIVO (incremental): fileId → lo ya leído (parse/OCR). En cada
// recálculo se reutiliza y solo se leen los archivos NUEVOS o modificados.
const ARCH_PATH = path.join(DATA_DIR, "issosoma-archivos.json");
type ArchivoCache = Record<string, { mt: string; tipo: string; data: any }>;
async function leerArchCache(): Promise<ArchivoCache> { try { return JSON.parse(await fs.readFile(ARCH_PATH, "utf-8")); } catch { return {}; } }
async function guardarArchCache(c: ArchivoCache): Promise<void> { try { await fs.mkdir(DATA_DIR, { recursive: true }); await fs.writeFile(ARCH_PATH, JSON.stringify(c)); } catch { /* */ } }
// Caché RUC → razón social (para nombrar proveedores de forma UNIFORME aunque la
// foto/OCR no traiga el nombre). Se resuelve una sola vez por RUC vía SUNAT.
const RUC_PATH = path.join(DATA_DIR, "issosoma-rucs.json");
async function leerRucCache(): Promise<Record<string, string>> { try { return JSON.parse(await fs.readFile(RUC_PATH, "utf-8")); } catch { return {}; } }
async function guardarRucCache(c: Record<string, string>): Promise<void> { try { await fs.mkdir(DATA_DIR, { recursive: true }); await fs.writeFile(RUC_PATH, JSON.stringify(c)); } catch { /* */ } }

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
export interface FacturaVenta { codigo: string; cliente: string; proyecto: string; valorVenta: number; importeTotal: number; detalle: string; archivo: string; tipo: "FE" | "NC"; mes: string }
/** Factura/boleta/comprobante de COMPRA recibido (egreso general de la empresa).
 *  Campos UNIFORMES para el Excel: proveedor (razón social, resuelta por RUC),
 *  RUC, tipo de comprobante, número, fecha, importe. */
export interface EgresoRecibido {
  emisor: string; ruc: string; importe: number; fecha: string; archivo: string; mes: string;
  tipoComprobante: string; numero: string;
}
async function parseFacturaPdf(id: string, nombre: string, token: string, mes = ""): Promise<FacturaVenta | null> {
  let texto = "";
  try {
    const buf = await bajar(id, token);
    const { extractText, getDocumentProxy } = await import("./pdfTexto");
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
  // Nombre del proyecto: la DESCRIPCIÓN de la línea de la factura (tras "UNIDAD
  // <codigo>-<yy>", hasta los totales). Se limpia el valor unitario/ICBPER final.
  const mDesc = texto.match(/UNIDAD\s+\d{3,4}-\d{2}\s+([\s\S]+?)\s+(?:Valor de Venta de Operaciones|Sub\s*Total\s*Ventas)/i);
  const proyecto = mDesc ? mDesc[1].replace(/\s+/g, " ").replace(/\s+[\d.,]+\s+[\d.,]+\s*$/, "").trim().slice(0, 160) : "";
  if (!codigo && !valorVenta && !importeTotal) return null;
  const tipo: "FE" | "NC" = /^NC|nota.?de.?cr[eé]dito/i.test(nombre) ? "NC" : "FE";
  return { codigo, cliente: (mCli ? mCli[1].trim() : "").slice(0, 80), proyecto, valorVenta, importeTotal, detalle: nombre.replace(/\.pdf$/i, ""), archivo: nombre, tipo, mes };
}

/** De un texto (de PDF o de OCR) arma el egreso. `permitirMax`: para fotos/Yape
 *  sin "Importe Total" explícito, toma el mayor monto con decimales. */
function egresoDeTexto(texto: string, nombre: string, mes: string, permitirMax: boolean): EgresoRecibido | null {
  const mImp = texto.match(/Importe\s*Total\s*:?\s*S?\/?\.?\s*([\d.,]+)/i)
    || texto.match(/\bTotal\s*(?:a\s*pagar)?\s*:?\s*S\/?\.?\s*([\d.,]+)/i)
    || texto.match(/\bMonto\s*:?\s*S\/?\.?\s*([\d.,]+)/i);
  let importe = mImp ? toNum(mImp[1]) : 0;
  if (!importe && permitirMax) {
    const montos = [...texto.matchAll(/S\/\s*([\d.,]+)|(\d{1,3}(?:[.,]\d{3})*[.,]\d{2})/g)]
      .map((m) => toNum(m[1] || m[2])).filter((n) => n > 0 && n < 1_000_000);
    importe = montos.length ? Math.max(...montos) : 0;
  }
  if (!importe) return null;
  // RUC del PROVEEDOR: cualquiera de 11 dígitos que no sea el de ISSOSOMA (cliente).
  const ruc = (texto.match(/\b(?:10|15|16|17|20)\d{9}\b/g) || []).find((r) => r !== "20600460812") || "";
  const mEmi = texto.match(/([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ0-9 .,&'-]{4,69}?)\s+(?:AV\.|CAL\.|CALLE|AVENIDA|JR\.|R\.?U\.?C)/);
  let emisor = (mEmi ? mEmi[1] : texto.trim().split(/\s{2,}|\n/)[0] || "").replace(/\s+/g, " ").trim().slice(0, 70);
  // Si capturó el nombre del CLIENTE (ISSOSOMA) o un trozo de dirección, no sirve
  // como proveedor: se deja vacío y lo resuelve el RUC → razón social (SUNAT).
  if (/ISO?SSOMA|ISOLUCION/i.test(emisor) || /^(CAL\.?|AV\.?|JR\.?|CALLE|AVENIDA|URB\.?|MZ\.?|LT\.?|PSJE\.?)\b/i.test(emisor)) emisor = "";
  const fecha = (texto.match(/\b\d{2}\/\d{2}\/\d{4}\b/) || texto.match(/\b\d{2}-\d{2}-\d{4}\b/) || [""])[0];
  // Tipo de comprobante y número (serie-número), uniformes para el Excel.
  const U = texto.toUpperCase();
  const tipoComprobante =
    /NOTA\s*DE\s*CR[EÉ]DITO/.test(U) ? "Nota de crédito" :
    /FACTURA/.test(U) ? "Factura" :
    /BOLETA/.test(U) ? "Boleta" :
    /YAPE|PLIN/.test(U) ? "Yape/Plin" :
    /TRANSFERENCIA|DEP[OÓ]SITO|CONSTANCIA/.test(U) ? "Transferencia/Depósito" :
    /TICKET|RECIBO/.test(U) ? "Ticket/Recibo" : "Otro";
  const mNum = texto.match(/\b([A-Z]{1,2}\d{2,3})\s*[- ]\s*(\d{4,8})\b/) || texto.match(/\b([A-Z]\d{3})\s+(\d{5,8})\b/);
  const numero = mNum ? `${mNum[1]}-${mNum[2]}` : "";
  return { emisor, ruc, importe, fecha, archivo: nombre, mes, tipoComprobante, numero };
}
const RX_IMG = /\.(png|jpe?g|webp|gif|bmp|tiff?)$/i;
/** OCR de un PDF ESCANEADO: extrae la imagen de cada página (unpdf), la codifica
 *  a PNG (fast-png) y la pasa por tesseract. Hasta 3 páginas (acota tiempo). */
async function ocrPdfBuffer(buf: Buffer): Promise<string> {
  try {
    const { getDocumentProxy, extractImages } = await import("./pdfTexto");
    const { encode } = await import("fast-png");
    const { ocrImagen } = await import("./ocr");
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const nPags = Math.min((pdf as any).numPages || 1, 3);
    let texto = "";
    for (let p = 1; p <= nPags; p++) {
      let imgs: any[] = [];
      try { imgs = (await extractImages(pdf, p)) as any[]; } catch { imgs = []; }
      const im = imgs.sort((a, b) => b.width * b.height - a.width * a.height)[0];
      if (!im?.data) continue;
      let data: Uint8Array = im.data;
      const n = im.width * im.height;
      if (im.channels === 3) { const o = new Uint8Array(n * 4); for (let i = 0; i < n; i++) { o[i * 4] = data[i * 3]; o[i * 4 + 1] = data[i * 3 + 1]; o[i * 4 + 2] = data[i * 3 + 2]; o[i * 4 + 3] = 255; } data = o; }
      else if (im.channels === 1) { const o = new Uint8Array(n * 4); for (let i = 0; i < n; i++) { const v = data[i]; o[i * 4] = v; o[i * 4 + 1] = v; o[i * 4 + 2] = v; o[i * 4 + 3] = 255; } data = o; }
      const png = encode({ width: im.width, height: im.height, data });
      texto += " " + await ocrImagen(Buffer.from(png), "image/png");
    }
    return texto.trim();
  } catch { return ""; }
}
/** Lee un egreso (compra) de un archivo. PDF con texto → directo; PDF escaneado o
 *  imagen (foto/boleta/captura Yape) → OCR (si `hacerOcr`). `deferido`=necesitaba
 *  OCR pero se superó el tope de la corrida (se reintenta en la próxima). */
async function leerEgreso(file: DFile, token: string, mes: string, hacerOcr: boolean): Promise<{ egreso: EgresoRecibido | null; ocr: boolean; deferido: boolean }> {
  const esImg = RX_IMG.test(file.name) || /^image\//i.test(file.mimeType);
  if (esImg && !hacerOcr) return { egreso: null, ocr: false, deferido: true };
  let buf: Buffer;
  try { buf = await bajar(file.id, token); } catch { return { egreso: null, ocr: false, deferido: false }; }
  if (esImg) {
    const { ocrImagen } = await import("./ocr");
    const texto = await ocrImagen(buf, file.mimeType || "image/png").catch(() => "");
    return { egreso: texto.trim() ? egresoDeTexto(texto, file.name, mes, true) : null, ocr: true, deferido: false };
  }
  let texto = "";
  try { const { extractText, getDocumentProxy } = await import("./pdfTexto"); const pdf = await getDocumentProxy(new Uint8Array(buf)); const r = await extractText(pdf, { mergePages: true }); texto = Array.isArray(r.text) ? r.text.join(" ") : String(r.text || ""); } catch { /* */ }
  if (texto.trim()) return { egreso: egresoDeTexto(texto, file.name, mes, false), ocr: false, deferido: false };
  if (!hacerOcr) return { egreso: null, ocr: false, deferido: true }; // escaneado, sin cupo OCR
  const t2 = await ocrPdfBuffer(buf);
  return { egreso: t2.trim() ? egresoDeTexto(t2, file.name, mes, true) : null, ocr: true, deferido: false };
}

// --- Análisis completo (costo/beneficio por proyecto) -----------------------
export interface ProyectoAnalisis {
  codigo: string; cliente: string; carpeta: string; responsable: string;
  venta: number; importeFacturado: number; costo: number; costoLogistica: number;
  utilidad: number; margen: number; saldo: number; nFacturas: number;
}
export interface IssosomaAnalisis {
  configurado: boolean; faltan?: string[]; cuentaServicio?: string;
  kpis: { venta: number; costo: number; utilidad: number; margen: number; egresosGenerales: number; resultado: number; proyectos: number; proyectosConVenta: number };
  proyectos: ProyectoAnalisis[];
  facturas: FacturaVenta[];
  egresosGenerales: EgresoRecibido[];
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

/** Recalcula desde Drive (bitácoras + facturas + egresos). INCREMENTAL: reutiliza
 *  lo ya leído (caché por archivo) y solo lee los NUEVOS/modificados. `completo`
 *  fuerza releer todo. Cachea el resultado. */
export async function recalcularIssosoma(opts?: { completo?: boolean }): Promise<IssosomaAnalisis> {
  const cfg = issosomaConfig();
  const avisos: string[] = [];
  const base: IssosomaAnalisis = {
    configurado: cfg.configurado, faltan: cfg.faltan,
    kpis: { venta: 0, costo: 0, utilidad: 0, margen: 0, egresosGenerales: 0, resultado: 0, proyectos: 0, proyectosConVenta: 0 },
    proyectos: [], facturas: [], egresosGenerales: [], gastos: [], avisos, generadoAt: new Date().toISOString(),
  };
  if (!cfg.configurado) return base;
  const { token, email } = await tokenServicio();
  base.cuentaServicio = email;

  // --- Caché incremental por archivo: solo se leen los NUEVOS/modificados. ---
  const arch: ArchivoCache = opts?.completo ? {} : await leerArchCache();
  let reusados = 0, leidos = 0;
  const memo = async <T>(file: DFile, tipo: string, fn: () => Promise<T>): Promise<T> => {
    const prev = arch[file.id];
    if (prev && prev.mt === (file.modifiedTime || "") && prev.tipo === tipo) { reusados++; return prev.data as T; }
    const data = await fn();
    arch[file.id] = { mt: file.modifiedTime || "", tipo, data };
    leidos++;
    return data;
  };

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
    return await memo(xlsx, "bitacora", async () => ({ ...parseBitacora(await bajar(xlsx.id, token), proj.name), archivo: xlsx.name }));
  });
  const costosOk = costos.filter(Boolean) as ProyectoCosto[];
  await guardarArchCache(arch);
  avisos.push(`Bitácoras con datos leídas: ${costosOk.length}.`);

  // 2) VENTAS (FE) + NOTAS DE CRÉDITO (NC) + EGRESOS recibidos (compras).
  const facturas: FacturaVenta[] = [];
  const egresos: EgresoRecibido[] = [];
  if (cfg.ventasId) {
    const ventasTodo = await listar(cfg.ventasId, token);
    const meses = ventasTodo.filter((f) => f.mimeType === MIME_FOLDER);
    let compTotal = 0, egresoTotal = 0, ocrNuevas = 0, ocrOmit = 0;
    // Tope de imágenes NUEVAS a OCR por corrida (las ya leídas se reutilizan y no
    // cuentan). Así cada recálculo termina a tiempo y el progreso se acumula:
    // volvé a pulsar Recalcular hasta que los avisos digan "0 nuevas".
    const OCR_MAX = Math.max(0, Number(process.env.ISSOSOMA_OCR_MAX || 300));
    for (const mes of meses) {
      const hijos = await listar(mes.id, token);
      // Comprobantes de VENTA (FE emitidas y NC notas de crédito).
      const comp = hijos.filter((f) => /\.pdf$/i.test(f.name) && /^FE|^NC|factura|\(\d{3,4}-\d{2}/i.test(f.name));
      compTotal += comp.length;
      const fs2 = await pool(comp, 6, (f) => memo(f, "factura", () => parseFacturaPdf(f.id, f.name, token, mes.name)));
      for (const f of fs2) if (f) facturas.push(f);
      // EGRESOS (compras): archivos de la(s) carpeta(s) "recibidas" + egresos
      // sueltos en la RAÍZ del mes (ej. "recibido restaurante.pdf", fotos de
      // boletas, capturas de Yape), excluyendo los comprobantes de venta (FE/NC).
      // PDF con texto → directo; escaneado/imagen → OCR (incremental, con tope).
      const egresoCands: DFile[] = [];
      for (const rf of hijos.filter((h) => h.mimeType === MIME_FOLDER && /recib/i.test(h.name))) {
        const recAll = await listar(rf.id, token);
        for (const f of recAll) if (f.mimeType !== MIME_FOLDER && (/\.pdf$/i.test(f.name) || RX_IMG.test(f.name) || /^image\//i.test(f.mimeType))) egresoCands.push(f);
      }
      const compIds = new Set(comp.map((c) => c.id));
      for (const f of hijos) {
        if (f.mimeType === MIME_FOLDER || compIds.has(f.id)) continue;
        const esImg = RX_IMG.test(f.name) || /^image\//i.test(f.mimeType);
        const nombreEgreso = /recib|boleta|recibo|ticket|gasto|egreso|compra|yape|dep[oó]sito|transferen/i.test(f.name);
        if (esImg || (/\.pdf$/i.test(f.name) && nombreEgreso)) egresoCands.push(f);
      }
      egresoTotal += egresoCands.length;
      for (const f of egresoCands) {
        const prev = arch[f.id];
        if (prev && prev.mt === (f.modifiedTime || "") && prev.tipo === "egreso") { reusados++; if (prev.data) egresos.push(prev.data); continue; }
        const res = await leerEgreso(f, token, mes.name, ocrNuevas < OCR_MAX);
        if (res.deferido) { ocrOmit++; continue; } // necesita OCR pero superó el tope: se reintenta la próxima corrida (no se cachea)
        if (res.ocr) ocrNuevas++;
        arch[f.id] = { mt: f.modifiedTime || "", tipo: "egreso", data: res.egreso };
        leidos++;
        if (res.egreso) egresos.push(res.egreso);
        if (leidos % 10 === 0) await guardarArchCache(arch);
      }
      await guardarArchCache(arch); // persiste al terminar cada mes
    }
    avisos.push(`Ventas: ${meses.length} mes(es), ${compTotal} comprobante(s) de venta (${facturas.length} leídos). Egresos candidatos: ${egresoTotal}; leídos: ${egresos.length}; OCR nuevas: ${ocrNuevas}${ocrOmit ? ` · pendientes para la próxima corrida: ${ocrOmit}` : ""}. Reutilizados de caché: ${reusados}; nuevos: ${leidos}.`);
  } else {
    avisos.push("No se configuró ISSOSOMA_VENTAS_FOLDER_ID: no se pudo calcular la venta/beneficio (solo costos).");
  }
  base.facturas = facturas;
  // Dedupe de egresos por (ruc|importe|fecha) para no contar dos veces el mismo.
  // (Rellena campos uniformes faltantes en egresos cacheados por versiones previas.)
  const vistosE = new Set<string>();
  base.egresosGenerales = egresos
    .map((e) => ({ ...e, tipoComprobante: e.tipoComprobante || "Otro", numero: e.numero || "" }))
    .filter((e) => { const k = `${e.ruc}|${e.importe}|${e.fecha}`; if (vistosE.has(k)) return false; vistosE.add(k); return true; });

  // PROVEEDOR UNIFORME: si hay RUC, el nombre se toma de SUNAT (razón social) y
  // se cachea; así todas las compras quedan con el mismo criterio para el Excel.
  const rucs = await leerRucCache();
  const RUC_MAX = Math.max(0, Number(process.env.ISSOSOMA_RUC_MAX || 60)); // consultas nuevas por corrida
  let rucNuevos = 0;
  const pendientesRuc = Array.from(new Set(base.egresosGenerales.map((e) => e.ruc).filter((r) => r && rucValido(r) && !rucs[r])));
  for (const r of pendientesRuc) {
    if (rucNuevos >= RUC_MAX) break;
    rucNuevos++;
    try { const info = await consultarSunat(r); if (info?.razonSocial) rucs[r] = String(info.razonSocial).trim(); } catch { /* se reintenta en otra corrida */ }
  }
  await guardarRucCache(rucs);
  for (const e of base.egresosGenerales) if (e.ruc && rucs[e.ruc]) e.emisor = rucs[e.ruc];
  const sinNombre = base.egresosGenerales.filter((e) => !e.emisor).length;
  avisos.push(`Proveedores: ${pendientesRuc.length} RUC nuevo(s) por resolver, ${rucNuevos} consultado(s) a SUNAT en esta corrida${pendientesRuc.length > rucNuevos ? ` (el resto en la próxima)` : ""}; ${sinNombre} egreso(s) aún sin nombre.`);
  const totalEgresos = base.egresosGenerales.reduce((a, e) => a + e.importe, 0);

  // 3) MATCH por código → costo/beneficio.
  const ventaPorCod = new Map<string, { venta: number; importe: number; n: number }>();
  for (const f of facturas) {
    if (!f.codigo) continue;
    const signo = f.tipo === "NC" ? -1 : 1; // la nota de crédito RESTA de la venta
    const o = ventaPorCod.get(f.codigo) ?? { venta: 0, importe: 0, n: 0 };
    o.venta += signo * f.valorVenta; o.importe += signo * f.importeTotal; if (f.tipo !== "NC") o.n++;
    ventaPorCod.set(f.codigo, o);
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
    const f = facturas.find((x) => x.codigo === cod && x.proyecto) || facturas.find((x) => x.codigo === cod);
    proyectos.push({ codigo: cod, cliente: f?.cliente || "", carpeta: f?.proyecto || "", responsable: "", venta: v.venta, importeFacturado: v.importe, costo: 0, costoLogistica: 0, utilidad: v.venta, margen: v.venta ? 1 : 0, saldo: 0, nFacturas: v.n });
  }
  proyectos.sort((a, b) => b.venta - a.venta);
  base.proyectos = proyectos;

  const venta = proyectos.reduce((a, p) => a + p.venta, 0);
  const costo = proyectos.reduce((a, p) => a + p.costo, 0);
  base.kpis = {
    venta, costo, utilidad: venta - costo, margen: venta ? (venta - costo) / venta : 0,
    egresosGenerales: totalEgresos, resultado: venta - costo - totalEgresos,
    proyectos: proyectos.length, proyectosConVenta: proyectos.filter((p) => p.venta > 0).length,
  };
  base.gastos = base.gastos.slice(0, 1000);
  await guardarArchCache(arch);
  await guardarCache(base);
  return base;
}

/** Devuelve el análisis cacheado (rápido). Si no hay caché, intenta recalcular. */
export async function analizarIssosoma(opts?: { refrescar?: boolean }): Promise<IssosomaAnalisis> {
  const cfg = issosomaConfig();
  if (!cfg.configurado) {
    return { configurado: false, faltan: cfg.faltan, kpis: { venta: 0, costo: 0, utilidad: 0, margen: 0, egresosGenerales: 0, resultado: 0, proyectos: 0, proyectosConVenta: 0 }, proyectos: [], facturas: [], egresosGenerales: [], gastos: [], avisos: [], generadoAt: new Date().toISOString() };
  }
  if (!opts?.refrescar) {
    const c = await leerCache();
    if (c) return c;
  }
  return recalcularIssosoma();
}

// --- Exportación a Excel (Ventas / Compras / Por proyecto / Mensual) ---------
const mesKey = (m: string) => parseInt(String(m).match(/\d+/)?.[0] || "99", 10);

// Nombre de pestaña ÚNICO y válido (≤31 chars, sin []:*?/\): "código + abreviatura del cliente".
function nombreHoja(codigo: string, cliente: string, carpeta: string, usados: Set<string>): string {
  let base = (cliente || carpeta || "PROYECTO")
    .replace(/\b(S\.?A\.?C\.?|S\.?A\.?|S\.?R\.?L\.?|E\.?I\.?R\.?L\.?|SAC|SRL|EIRL|LTDA|INC)\b/gi, "")
    .replace(/[\[\]:*?/\\]/g, " ").replace(/\s+/g, " ").trim().toUpperCase();
  base = base.split(" ").slice(0, 3).join(" ");
  let nombre = `${codigo || "SN"} ${base}`.trim().slice(0, 31);
  let i = 2;
  while (usados.has(nombre)) { const suf = ` (${i++})`; nombre = `${nombre.slice(0, 31 - suf.length)}${suf}`; }
  usados.add(nombre);
  return nombre;
}

/** Nombre de grupo por empresa (mismo criterio que el dashboard). */
export const nombreEmpresa = (cliente: string) => (cliente || "Sin cliente identificado").trim();

/** Recorta el análisis a UNA empresa: sus proyectos, sus facturas y sus gastos.
 *  Las compras generales (sin proyecto) no se pueden atribuir → quedan fuera. */
function filtrarEmpresa(a: IssosomaAnalisis, empresa: string): IssosomaAnalisis {
  const proyectos = a.proyectos.filter((p) => nombreEmpresa(p.cliente) === empresa);
  const codigos = new Set(proyectos.map((p) => p.codigo).filter(Boolean));
  const venta = proyectos.reduce((s, p) => s + p.venta, 0), costo = proyectos.reduce((s, p) => s + p.costo, 0);
  return {
    ...a, proyectos,
    facturas: a.facturas.filter((f) => codigos.has(f.codigo)),
    gastos: a.gastos.filter((g) => codigos.has(g.codigo)),
    egresosGenerales: [],
    kpis: { ...a.kpis, venta, costo, utilidad: venta - costo, margen: venta ? (venta - costo) / venta : 0, egresosGenerales: 0, resultado: venta - costo, proyectos: proyectos.length, proyectosConVenta: proyectos.filter((p) => p.venta > 0).length },
  };
}

export async function excelIssosoma(a0: IssosomaAnalisis, opts?: { empresa?: string }): Promise<Buffer> {
  const a = opts?.empresa ? filtrarEmpresa(a0, opts.empresa) : a0;
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const MONEY = "#,##0.00";
  const VERDE = "FF2F4A3B";
  const cabecera = (ws: any, fila = 1) => { const r = ws.getRow(fila); r.font = { bold: true, color: { argb: "FFFFFFFF" } }; r.fill = { type: "pattern", pattern: "solid", fgColor: { argb: VERDE } }; };
  const titulo = (ws: any, celda: string, texto: string, hasta: string) => { ws.mergeCells(`${celda}:${hasta}`); const c = ws.getCell(celda); c.value = texto; c.font = { bold: true, size: 14, color: { argb: VERDE } }; };
  const firmaVenta = (f: FacturaVenta) => (f.tipo === "NC" ? -1 : 1);

  // ---------- 1) INGRESO · EGRESO · UTILIDAD (una sola pestaña, por mes) ----------
  const ventaMes = new Map<string, number>(), comprasMes = new Map<string, number>(), costoMes = new Map<string, number>();
  const ventaCodMes = new Map<string, Map<string, number>>();
  const ventaProy = new Map<string, number>(), costoProy = new Map<string, number>();
  for (const p of a.proyectos) { ventaProy.set(p.codigo, p.venta); costoProy.set(p.codigo, p.costo); }
  for (const f of a.facturas) {
    const v = firmaVenta(f) * f.valorVenta; const m = f.mes || "(sin mes)";
    ventaMes.set(m, (ventaMes.get(m) || 0) + v);
    if (f.codigo) { const mm = ventaCodMes.get(f.codigo) || new Map<string, number>(); mm.set(m, (mm.get(m) || 0) + v); ventaCodMes.set(f.codigo, mm); }
  }
  for (const e of a.egresosGenerales) { const m = e.mes || "(sin mes)"; comprasMes.set(m, (comprasMes.get(m) || 0) + e.importe); }
  // El costo del proyecto se atribuye al mes de facturación, en proporción a la venta de ese mes.
  for (const [cod, mm] of ventaCodMes) { const tot = ventaProy.get(cod) || 0; const costo = costoProy.get(cod) || 0; if (!tot) continue; for (const [m, v] of mm) costoMes.set(m, (costoMes.get(m) || 0) + costo * (v / tot)); }
  const meses = Array.from(new Set([...ventaMes.keys(), ...comprasMes.keys(), ...costoMes.keys()])).sort((x, y) => mesKey(x) - mesKey(y));

  const wsR = wb.addWorksheet("Ingreso-Egreso-Utilidad");
  titulo(wsR, "A1", opts?.empresa ? `${opts.empresa} — Ingreso · Egreso · Utilidad por mes` : "ISSOSOMA — Ingreso · Egreso · Utilidad por mes", "G1");
  wsR.getCell("A2").value = `Generado: ${new Date(a.generadoAt).toLocaleString("es-PE")} · Ingreso = ventas netas (FE − NC) · Egreso = costo de proyectos (bitácoras)${opts?.empresa ? " · (compras generales sin proyecto no incluidas en el reporte por empresa)" : " + compras recibidas"}`;
  wsR.getCell("A2").font = { italic: true, color: { argb: "FF7A847D" } };
  const encR = ["Mes", "Ingreso (venta neta)", "Costo de proyectos", "Compras (egresos)", "Egreso total", "Utilidad", "Margen"];
  wsR.getRow(4).values = encR; cabecera(wsR, 4);
  wsR.columns = [{ width: 16 }, { width: 20 }, { width: 20 }, { width: 18 }, { width: 16 }, { width: 16 }, { width: 10 }] as any;
  let fila = 5;
  for (const m of meses) {
    const ing = ventaMes.get(m) || 0, costo = costoMes.get(m) || 0, comp = comprasMes.get(m) || 0, egr = costo + comp, util = ing - egr;
    wsR.getRow(fila++).values = [m, ing, costo, comp, egr, util, ing ? util / ing : 0];
  }
  const tI = a.kpis.venta, tC = a.kpis.costo, tP = a.kpis.egresosGenerales, tE = tC + tP;
  fila++;
  const rT = wsR.getRow(fila); rT.values = ["TOTAL", tI, tC, tP, tE, tI - tE, tI ? (tI - tE) / tI : 0]; rT.font = { bold: true };
  for (let r = 5; r <= fila; r++) { for (const c of [2, 3, 4, 5, 6]) wsR.getCell(r, c).numFmt = MONEY; wsR.getCell(r, 7).numFmt = "0.0%"; }
  wsR.views = [{ state: "frozen", ySplit: 4 }];

  // ---------- 2) ÍNDICE DE PROYECTOS (para navegar a cada pestaña) ----------
  const wsI = wb.addWorksheet("Proyectos");
  titulo(wsI, "A1", "Índice de proyectos (cada uno tiene su pestaña)", "I1");
  wsI.getRow(3).values = ["Pestaña", "Código", "Cliente", "Proyecto", "Responsable", "Venta", "Costo", "Utilidad", "Margen"]; cabecera(wsI, 3);
  wsI.columns = [{ width: 24 }, { width: 10 }, { width: 30 }, { width: 44 }, { width: 22 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 10 }] as any;
  wsI.views = [{ state: "frozen", ySplit: 3 }];

  // ---------- 3) UNA PESTAÑA POR PROYECTO (abreviatura de cliente) ----------
  const usados = new Set<string>(["Ingreso-Egreso-Utilidad", "Proyectos"]);
  const proyectosOrd = [...a.proyectos].sort((x, y) => (x.cliente || x.carpeta).localeCompare(y.cliente || y.carpeta) || x.codigo.localeCompare(y.codigo));
  let filaI = 4;
  for (const p of proyectosOrd) {
    const hoja = nombreHoja(p.codigo, p.cliente, p.carpeta, usados);
    wsI.getRow(filaI).values = [hoja, p.codigo, p.cliente, p.carpeta, p.responsable, p.venta, p.costo, p.utilidad, p.margen];
    for (const c of [6, 7, 8]) wsI.getCell(filaI, c).numFmt = MONEY; wsI.getCell(filaI, 9).numFmt = "0.0%";
    filaI++;

    const ws = wb.addWorksheet(hoja);
    ws.columns = [{ width: 16 }, { width: 12 }, { width: 18 }, { width: 46 }, { width: 16 }, { width: 16 }] as any;
    // Título en A1: a qué proyecto pertenece la pestaña.
    titulo(ws, "A1", `PROYECTO: ${p.carpeta || `INF-${p.codigo}`} — ${p.cliente || "(cliente sin identificar)"}`, "F1");
    ws.getCell("A2").value = `Código: ${p.codigo || "—"}   ·   Cliente: ${p.cliente || "—"}   ·   Responsable: ${p.responsable || "—"}`;
    ws.getCell("A2").font = { color: { argb: "FF4F5C55" } };

    // Bloque KPIs.
    ws.getRow(4).values = ["Venta neta", "Costo", "Utilidad", "Margen", "Saldo rendición", "N° facturas"]; cabecera(ws, 4);
    ws.getRow(5).values = [p.venta, p.costo, p.utilidad, p.margen, p.saldo, p.nFacturas];
    for (const c of [1, 2, 3, 5]) ws.getCell(5, c).numFmt = MONEY; ws.getCell(5, 4).numFmt = "0.0%";
    ws.getRow(5).font = { bold: true, size: 12 };

    // Bloque FACTURAS DE VENTA del proyecto.
    let r = 7;
    ws.getCell(r, 1).value = "FACTURAS DE VENTA (FE) Y NOTAS DE CRÉDITO (NC)"; ws.getCell(r, 1).font = { bold: true, color: { argb: VERDE } }; r++;
    ws.getRow(r).values = ["Mes", "Tipo", "Archivo", "Descripción", "Valor venta", "Importe total"]; cabecera(ws, r); r++;
    const fsP = a.facturas.filter((f) => f.codigo === p.codigo);
    let sumVV = 0, sumIT = 0;
    for (const f of fsP) {
      const s = firmaVenta(f);
      ws.getRow(r).values = [f.mes, f.tipo, f.detalle, f.proyecto, s * f.valorVenta, s * f.importeTotal];
      ws.getCell(r, 5).numFmt = MONEY; ws.getCell(r, 6).numFmt = MONEY; sumVV += s * f.valorVenta; sumIT += s * f.importeTotal; r++;
    }
    if (!fsP.length) { ws.getCell(r, 1).value = "(sin facturas registradas para este código)"; ws.getCell(r, 1).font = { italic: true, color: { argb: "FF7A847D" } }; r++; }
    else { ws.getRow(r).values = ["", "", "", "Total facturado", sumVV, sumIT]; ws.getRow(r).font = { bold: true }; ws.getCell(r, 5).numFmt = MONEY; ws.getCell(r, 6).numFmt = MONEY; r++; }

    // Bloque GASTOS del proyecto (bitácora).
    r++;
    ws.getCell(r, 1).value = "GASTOS DEL PROYECTO (bitácora de rendición)"; ws.getCell(r, 1).font = { bold: true, color: { argb: VERDE } }; r++;
    ws.getRow(r).values = ["Fecha", "", "", "Descripción", "Monto", ""]; cabecera(ws, r); r++;
    const gsP = a.gastos.filter((g) => g.codigo === p.codigo);
    let sumG = 0;
    for (const g of gsP) { ws.getRow(r).values = [g.fecha, "", "", g.descripcion, g.monto, ""]; ws.getCell(r, 5).numFmt = MONEY; sumG += g.monto; r++; }
    if (!gsP.length) { ws.getCell(r, 1).value = "(sin detalle de gastos; el costo total viene de la bitácora)"; ws.getCell(r, 1).font = { italic: true, color: { argb: "FF7A847D" } }; r++; }
    else { ws.getRow(r).values = ["", "", "", "Total gastos detallados", sumG, ""]; ws.getRow(r).font = { bold: true }; ws.getCell(r, 5).numFmt = MONEY; r++; }
    ws.getRow(r + 1).values = ["", "", "", "Costo total del proyecto (bitácora)", p.costo, ""]; ws.getRow(r + 1).font = { bold: true }; ws.getCell(r + 1, 5).numFmt = MONEY;
    ws.views = [{ state: "frozen", ySplit: 2 }];
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}
