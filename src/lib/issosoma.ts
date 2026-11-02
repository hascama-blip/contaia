import crypto from "crypto";
import * as XLSX from "xlsx";

// ============================================================
//  ISSOSOMA — rendición de viáticos + ingresos/egresos/utilidad
// ============================================================
// Se conecta a una carpeta de Google Drive por CUENTA DE SERVICIO (lectura),
// lee las hojas (Google Sheets y Excel .xlsx) y arma el análisis financiero
// para el dashboard. Config por entorno:
//   - GOOGLE_SERVICE_ACCOUNT_JSON : el JSON de la cuenta de servicio (una línea).
//   - ISSOSOMA_DRIVE_FOLDER_ID    : el ID de la carpeta de Drive de ISSOSOMA.
// La carpeta debe estar COMPARTIDA (lector) con el client_email del service
// account. No se guarda nada: se lee en vivo y se agrega en memoria.

const SCOPE = "https://www.googleapis.com/auth/drive.readonly";
const MIME_SHEET_GOOGLE = "application/vnd.google-apps.spreadsheet";
const MIME_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export interface IssosomaConfig {
  folderId: string;
  configurado: boolean;   // hay credenciales + carpeta
  faltan: string[];       // qué variables de entorno faltan
}

export function issosomaConfig(): IssosomaConfig {
  const faltan: string[] = [];
  if (!(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "").trim()) faltan.push("GOOGLE_SERVICE_ACCOUNT_JSON");
  const folderId = (process.env.ISSOSOMA_DRIVE_FOLDER_ID || "").trim();
  if (!folderId) faltan.push("ISSOSOMA_DRIVE_FOLDER_ID");
  return { folderId, configurado: faltan.length === 0, faltan };
}

// --- Autenticación de la cuenta de servicio (JWT RS256 → access token) -------
const b64url = (s: Buffer | string) => Buffer.from(s).toString("base64url");

async function tokenServicio(): Promise<{ token: string; email: string }> {
  const raw = (process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "").trim();
  if (!raw) throw new Error("Falta GOOGLE_SERVICE_ACCOUNT_JSON");
  let sa: any;
  try { sa = JSON.parse(raw); } catch { throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON no es un JSON válido"); }
  if (!sa.client_email || !sa.private_key) throw new Error("El JSON del service account no trae client_email/private_key");
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({
    iss: sa.client_email, scope: SCOPE,
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
  }));
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(`${header}.${claim}`);
  const sig = b64url(signer.sign(sa.private_key));
  const assertion = `${header}.${claim}.${sig}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  const j: any = await res.json().catch(() => ({}));
  if (!j.access_token) throw new Error(`No se pudo autenticar la cuenta de servicio (${res.status}): ${JSON.stringify(j).slice(0, 180)}`);
  return { token: j.access_token, email: sa.client_email };
}

// --- Drive: listar carpeta y bajar bytes ------------------------------------
export interface DriveFile { id: string; name: string; mimeType: string; modifiedTime?: string; size?: string }

async function listarCarpeta(folderId: string, token: string): Promise<DriveFile[]> {
  const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
  const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,mimeType,modifiedTime,size)&pageSize=1000&orderBy=name&supportsAllDrives=true&includeItemsFromAllDrives=true`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`No se pudo listar la carpeta Drive (${r.status}). ¿La compartiste con la cuenta de servicio?`);
  const j: any = await r.json();
  return (j.files ?? []) as DriveFile[];
}

async function bajarBytes(file: DriveFile, token: string): Promise<Buffer> {
  const esGoogle = file.mimeType === MIME_SHEET_GOOGLE;
  const url = esGoogle
    ? `https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=${encodeURIComponent(MIME_XLSX)}`
    : `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media&supportsAllDrives=true`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`No se pudo bajar ${file.name} (${r.status})`);
  return Buffer.from(await r.arrayBuffer());
}

// --- Lectura de un libro (Google Sheet exportado o .xlsx) → filas ------------
interface HojaLeida { hoja: string; headers: string[]; filas: Record<string, any>[] }

function leerLibro(buf: Buffer): HojaLeida[] {
  const wb = XLSX.read(buf, { type: "buffer" });
  const out: HojaLeida[] = [];
  for (const nombre of wb.SheetNames) {
    const ws = wb.Sheets[nombre];
    const matriz: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: "" });
    if (!matriz.length) continue;
    // Fila de encabezados = primera fila con ≥2 celdas de texto no vacías.
    let hIdx = matriz.findIndex((f) => f.filter((c) => String(c).trim()).length >= 2);
    if (hIdx < 0) hIdx = 0;
    const headers = (matriz[hIdx] ?? []).map((c) => String(c).trim());
    const filas: Record<string, any>[] = [];
    for (let i = hIdx + 1; i < matriz.length; i++) {
      const fila = matriz[i];
      if (!fila || !fila.some((c) => String(c).trim())) continue;
      const obj: Record<string, any> = {};
      headers.forEach((h, j) => { if (h) obj[h] = fila[j]; });
      filas.push(obj);
    }
    out.push({ hoja: nombre, headers, filas });
  }
  return out;
}

// --- Detección flexible de columnas (se calibra con los datos reales) --------
const RX = {
  fecha: /fecha|date|d[ií]a|periodo|mes/i,
  concepto: /concepto|detalle|descrip|glosa|motivo|rubro/i,
  monto: /monto|importe|total|valor|s\/|soles|monto\s*total/i,
  ingreso: /ingreso|abono|entrada|venta|cobro|dep[oó]sito|haber/i,
  egreso: /egreso|gasto|salida|pago|compra|debe|desembolso/i,
  categoria: /categor|rubro|tipo|partida|clasif|cuenta/i,
  sede: /sede|proyecto|obra|centro|área|area|unidad/i,
  persona: /persona|responsable|colaborador|empleado|nombre|solicitante|rendidor/i,
  estado: /estado|situaci|status/i,
};
const hallar = (headers: string[], rx: RegExp) => headers.find((h) => rx.test(h)) || "";
const num = (v: any): number => {
  if (typeof v === "number") return v;
  const s = String(v ?? "").replace(/[^\d,.\-]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
  const n = parseFloat(s);
  return isFinite(n) ? n : 0;
};
const esViatico = (s: string) => /vi[aá]tico|rendici[oó]n|movilidad|per\s*diem/i.test(s || "");
const mesDe = (v: any): string => {
  if (v instanceof Date) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}`;
  const s = String(v ?? "");
  let m = s.match(/(\d{4})[-/](\d{1,2})/);                 // 2026-09 / 2026/9
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}`;
  m = s.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);      // dd/mm/aaaa
  if (m) { const a = m[3].length === 2 ? "20" + m[3] : m[3]; return `${a}-${m[2].padStart(2, "0")}`; }
  return "";
};

export interface Movimiento {
  fecha: string; mes: string; concepto: string; categoria: string; sede: string; persona: string;
  ingreso: number; egreso: number; viatico: boolean; estado: string; fuente: string;
}
export interface IssosomaAnalisis {
  configurado: boolean;
  faltan?: string[];
  cuentaServicio?: string;
  folderId?: string;
  archivos: { name: string; mimeType: string; modifiedTime?: string; filas?: number; leido: boolean; nota?: string }[];
  kpis: { ingresos: number; egresos: number; utilidad: number; margen: number; viaticos: number; movimientos: number };
  porMes: { mes: string; ingresos: number; egresos: number; utilidad: number }[];
  porCategoria: { categoria: string; egresos: number; ingresos: number }[];
  porSede: { sede: string; ingresos: number; egresos: number; utilidad: number }[];
  porPersona: { persona: string; viaticos: number; movimientos: number }[];
  viaticos: Movimiento[];
  error?: string;
  generadoAt: string;
}

/** Lee la carpeta Drive de ISSOSOMA y arma el análisis financiero. */
export async function analizarIssosoma(): Promise<IssosomaAnalisis> {
  const cfg = issosomaConfig();
  const base: IssosomaAnalisis = {
    configurado: cfg.configurado, faltan: cfg.faltan, folderId: cfg.folderId,
    archivos: [], viaticos: [], porMes: [], porCategoria: [], porSede: [], porPersona: [],
    kpis: { ingresos: 0, egresos: 0, utilidad: 0, margen: 0, viaticos: 0, movimientos: 0 },
    generadoAt: new Date().toISOString(),
  };
  if (!cfg.configurado) return base;

  const { token, email } = await tokenServicio();
  base.cuentaServicio = email;
  const files = await listarCarpeta(cfg.folderId, token);

  const movimientos: Movimiento[] = [];
  for (const f of files) {
    const esLibro = f.mimeType === MIME_SHEET_GOOGLE || f.mimeType === MIME_XLSX || /\.xlsx?$/i.test(f.name);
    if (!esLibro) {
      base.archivos.push({ name: f.name, mimeType: f.mimeType, modifiedTime: f.modifiedTime, leido: false, nota: /pdf/i.test(f.mimeType) ? "PDF (rendición) — pendiente de parseo" : "no es hoja de cálculo" });
      continue;
    }
    try {
      const buf = await bajarBytes(f, token);
      const hojas = leerLibro(buf);
      let filasLeidas = 0;
      for (const h of hojas) {
        const cFecha = hallar(h.headers, RX.fecha);
        const cConcepto = hallar(h.headers, RX.concepto);
        const cIngreso = hallar(h.headers, RX.ingreso);
        const cEgreso = hallar(h.headers, RX.egreso);
        const cMonto = hallar(h.headers, RX.monto);
        const cCat = hallar(h.headers, RX.categoria);
        const cSede = hallar(h.headers, RX.sede);
        const cPersona = hallar(h.headers, RX.persona);
        const cEstado = hallar(h.headers, RX.estado);
        const hojaEsViatico = esViatico(f.name) || esViatico(h.hoja);
        for (const r of h.filas) {
          const concepto = String(cConcepto ? r[cConcepto] : "").trim();
          const categoria = String(cCat ? r[cCat] : "").trim();
          let ingreso = cIngreso ? num(r[cIngreso]) : 0;
          let egreso = cEgreso ? num(r[cEgreso]) : 0;
          // Sin columnas ingreso/egreso separadas: usar monto + categoría/signo.
          if (!cIngreso && !cEgreso && cMonto) {
            const m = num(r[cMonto]);
            const esIng = RX.ingreso.test(categoria) || RX.ingreso.test(concepto);
            if (esIng && m > 0) ingreso = m; else egreso = Math.abs(m);
          }
          if (!ingreso && !egreso) continue;
          const viatico = hojaEsViatico || esViatico(categoria) || esViatico(concepto);
          movimientos.push({
            fecha: String(cFecha ? r[cFecha] : "").trim(),
            mes: mesDe(cFecha ? r[cFecha] : ""),
            concepto, categoria: categoria || (viatico ? "Viáticos" : ""),
            sede: String(cSede ? r[cSede] : "").trim(),
            persona: String(cPersona ? r[cPersona] : "").trim(),
            ingreso, egreso, viatico, estado: String(cEstado ? r[cEstado] : "").trim(),
            fuente: f.name,
          });
          filasLeidas++;
        }
      }
      base.archivos.push({ name: f.name, mimeType: f.mimeType, modifiedTime: f.modifiedTime, filas: filasLeidas, leido: true });
    } catch (e: any) {
      base.archivos.push({ name: f.name, mimeType: f.mimeType, modifiedTime: f.modifiedTime, leido: false, nota: String(e?.message ?? e).slice(0, 120) });
    }
  }

  // --- Agregaciones ----------------------------------------------------------
  const ingresos = movimientos.reduce((a, m) => a + m.ingreso, 0);
  const egresos = movimientos.reduce((a, m) => a + m.egreso, 0);
  const viaticosTot = movimientos.filter((m) => m.viatico).reduce((a, m) => a + m.egreso, 0);
  base.kpis = {
    ingresos, egresos, utilidad: ingresos - egresos,
    margen: ingresos ? (ingresos - egresos) / ingresos : 0,
    viaticos: viaticosTot, movimientos: movimientos.length,
  };

  const agr = <T extends string>(key: (m: Movimiento) => T) => {
    const map = new Map<T, { ingresos: number; egresos: number; n: number }>();
    for (const m of movimientos) {
      const k = key(m); if (!k) continue;
      const o = map.get(k) ?? { ingresos: 0, egresos: 0, n: 0 };
      o.ingresos += m.ingreso; o.egresos += m.egreso; o.n++;
      map.set(k, o);
    }
    return map;
  };

  base.porMes = Array.from(agr((m) => m.mes).entries())
    .filter(([k]) => k)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([mes, o]) => ({ mes, ingresos: o.ingresos, egresos: o.egresos, utilidad: o.ingresos - o.egresos }));

  base.porCategoria = Array.from(agr((m) => m.categoria || "Sin categoría").entries())
    .map(([categoria, o]) => ({ categoria, egresos: o.egresos, ingresos: o.ingresos }))
    .sort((a, b) => b.egresos - a.egresos).slice(0, 20);

  base.porSede = Array.from(agr((m) => m.sede).entries())
    .filter(([k]) => k)
    .map(([sede, o]) => ({ sede, ingresos: o.ingresos, egresos: o.egresos, utilidad: o.ingresos - o.egresos }))
    .sort((a, b) => b.utilidad - a.utilidad).slice(0, 20);

  const perMap = new Map<string, { viaticos: number; n: number }>();
  for (const m of movimientos) {
    if (!m.viatico || !m.persona) continue;
    const o = perMap.get(m.persona) ?? { viaticos: 0, n: 0 };
    o.viaticos += m.egreso; o.n++; perMap.set(m.persona, o);
  }
  base.porPersona = Array.from(perMap.entries())
    .map(([persona, o]) => ({ persona, viaticos: o.viaticos, movimientos: o.n }))
    .sort((a, b) => b.viaticos - a.viaticos).slice(0, 30);

  base.viaticos = movimientos.filter((m) => m.viatico).slice(0, 500);
  return base;
}
