import crypto from "crypto";
import { unzipSync, strFromU8 } from "fflate";
import type { SireBloque, SireResumen } from "./types";

// ============================================================
//  Integración SIRE de SUNAT (RVIE ventas + RCE compras)
// ============================================================
//
// El SIRE oficial es ASÍNCRONO: token -> solicitar reporte (devuelve ticket)
// -> consultar estado del ticket -> descargar archivo -> leer totales.
//
// Las credenciales (Clave SOL + client_id/secret) se reciben por consulta y
// NO se persisten; solo se guardan los TOTALES resultantes.
//
// Como las rutas/códigos exactos dependen de la versión del manual SUNAT y no
// se pueden probar a ciegas, todo es configurable por entorno y existe un
// MODO DIAGNÓSTICO que devuelve la respuesta cruda de cada paso para calibrar.

export interface SireParams {
  ruc: string;
  periodo: string; // "YYYYMM"
  solUser: string;
  solPass: string;
  clientId?: string;
  clientSecret?: string;
  /** true = consulta REAL a SUNAT; false = ejemplo simulado. */
  real?: boolean;
  /** Si true, no parsea: devuelve la traza cruda de cada paso. */
  diagnostico?: boolean;
}

export interface SireResultado {
  resumen?: SireResumen;
  diag?: SireDiag;
}

export interface SirePaso {
  paso: string;
  url?: string;
  metodo?: string;
  httpStatus?: number;
  ok: boolean;
  // Fragmento de la respuesta (truncado, sin credenciales).
  respuesta?: string;
}

export interface SireDiag {
  periodo: string;
  pasos: SirePaso[];
}

interface SireConfig {
  tokenUrl: string;
  scope: string;
  apiBase: string;
  exportVentasPath: string;
  exportComprasPath: string;
  estadoPath: string;
  descargaPath: string;
  codLibroVentas: string;
  codLibroCompras: string;
  omisosPath: string;
  codTipoResumen: string;
  codTipoArchivo: string;
  defClientId: string;
  defClientSecret: string;
  forceMock: boolean;
}

function getConfig(): SireConfig {
  return {
    tokenUrl:
      process.env.SUNAT_TOKEN_URL ??
      "https://api-seguridad.sunat.gob.pe/v1/clientessol",
    scope: process.env.SIRE_SCOPE ?? "https://api-sire.sunat.gob.pe",
    apiBase:
      process.env.SIRE_API_BASE ??
      "https://api-sire.sunat.gob.pe/v1/contribuyente/migeigv/libros",
    // Endpoint de RESUMEN (mismo para ventas/compras, distingue por codLibro).
    // codTipoResumen: -1 = propuesta, -2 = preliminar/registro (lo declarado).
    exportVentasPath:
      process.env.SIRE_EXPORT_VENTAS_PATH ??
      "/rvierce/resumen/web/resumencomprobantes/{periodo}/{codTipoResumen}/{codTipoArchivo}/exporta?codLibro={codLibro}",
    exportComprasPath:
      process.env.SIRE_EXPORT_COMPRAS_PATH ??
      "/rvierce/resumen/web/resumencomprobantes/{periodo}/{codTipoResumen}/{codTipoArchivo}/exporta?codLibro={codLibro}",
    estadoPath:
      process.env.SIRE_ESTADO_PATH ??
      "/rvierce/gestionprocesosmasivos/web/masivo/consultaestadotickets?perIni={periodo}&perFin={periodo}&page=1&perPage=20&numTicket={ticket}",
    descargaPath:
      process.env.SIRE_DESCARGA_PATH ??
      "/rvierce/gestionprocesosmasivos/web/masivo/archivoreporte?nomArchivoReporte={nombre}&perTributario={periodo}&codLibro={codLibro}&codTipoArchivoReporte=00",
    // Confirmado empíricamente: 140000 = ventas (RVIE), 080000 = compras (RCE).
    codLibroVentas: process.env.SIRE_COD_LIBRO_VENTAS ?? "140000",
    codLibroCompras: process.env.SIRE_COD_LIBRO_COMPRAS ?? "080000",
    // Estado de presentación por periodo: .../omisos/{codLibro}/periodos
    omisosPath:
      process.env.SIRE_OMISOS_PATH ?? "/rvierce/padron/web/omisos/{codLibro}/periodos",
    // 1 dígito. 1 = resumen del registro (lo declarado, con datos por mes).
    codTipoResumen: process.env.SIRE_COD_TIPO_RESUMEN ?? "1",
    codTipoArchivo: process.env.SIRE_COD_TIPO_ARCHIVO ?? "0",
    defClientId: process.env.SUNAT_SIRE_CLIENT_ID ?? "",
    defClientSecret: process.env.SUNAT_SIRE_CLIENT_SECRET ?? "",
    forceMock: (process.env.SIRE_FORCE_MOCK ?? "false") === "true",
  };
}

export function periodoValido(periodo: string): boolean {
  if (!/^\d{6}$/.test(periodo)) return false;
  const mes = Number(periodo.slice(4, 6));
  return mes >= 1 && mes <= 12;
}

// ---- Utilidades -------------------------------------------------------------

async function leerDetalle(res: Response): Promise<string> {
  try {
    const txt = (await res.text()).trim();
    return txt ? `: ${txt.slice(0, 600)}` : "";
  } catch {
    return "";
  }
}

function trunc(s: string, n = 600): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

// Marcador interno: periodo terminado pero sin comprobantes (mes sin movimiento).
const VACIO = "__VACIO__";

// ---- Autenticación oficial (OAuth2 password) -------------------------------

async function obtenerToken(
  cfg: SireConfig,
  ruc: string,
  solUser: string,
  solPass: string,
  clientId: string,
  clientSecret: string,
  diag: SireDiag
): Promise<string> {
  const url = `${cfg.tokenUrl}/${clientId}/oauth2/token/`;
  const body = new URLSearchParams({
    grant_type: "password",
    scope: cfg.scope,
    client_id: clientId,
    client_secret: clientSecret,
    username: `${ruc}${solUser}`,
    password: solPass,
  });
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const detalle = await leerDetalle(res);
    diag.pasos.push({
      paso: "auth",
      url: `${cfg.tokenUrl}/***/oauth2/token/`,
      metodo: "POST",
      httpStatus: res.status,
      ok: false,
      respuesta: trunc(detalle),
    });
    throw new Error(`autenticación SUNAT (HTTP ${res.status})${detalle}`);
  }
  const json = (await res.json()) as Record<string, any>;
  // Mostramos en diagnóstico el scope/permiso concedido (NO el token) para
  // verificar si el credencial está habilitado para SIRE.
  const meta = {
    scope_solicitado: cfg.scope,
    scope_concedido: json.scope ?? "(no informado)",
    token_type: json.token_type ?? "(no informado)",
    expires_in: json.expires_in ?? "(no informado)",
  };
  diag.pasos.push({
    paso: "auth",
    metodo: "POST",
    httpStatus: 200,
    ok: true,
    respuesta: JSON.stringify(meta),
  });
  if (!json.access_token) throw new Error("autenticación SUNAT sin token");
  return json.access_token as string;
}

// ---- Paso: solicitar reporte (devuelve ticket) -----------------------------

function buildUrl(cfg: SireConfig, path: string, repl: Record<string, string>): string {
  let p = path;
  for (const [k, v] of Object.entries(repl)) {
    p = p.replaceAll(`{${k}}`, encodeURIComponent(v));
  }
  return `${cfg.apiBase}${p}`;
}

async function solicitarTicket(
  cfg: SireConfig,
  token: string,
  periodo: string,
  pathTemplate: string,
  codLibro: string,
  etiqueta: string,
  diag: SireDiag
): Promise<string> {
  const url = buildUrl(cfg, pathTemplate, {
    periodo,
    codTipoResumen: cfg.codTipoResumen,
    codTipoArchivo: cfg.codTipoArchivo,
    codLibro,
  });
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  const txt = await res.text();
  diag.pasos.push({
    paso: `ticket-${etiqueta}`,
    url,
    metodo: "GET",
    httpStatus: res.status,
    ok: res.ok,
    respuesta: trunc(txt),
  });
  if (!res.ok) {
    throw new Error(`solicitud ${etiqueta} (HTTP ${res.status}): ${trunc(txt, 200)}`);
  }
  let data: any = {};
  try {
    data = JSON.parse(txt);
  } catch {
    /* respuesta no-JSON; queda en diag */
  }
  const ticket = data.numTicket ?? data.numticket ?? data.ticket;
  if (!ticket) {
    throw new Error(`solicitud ${etiqueta} sin numTicket (ver diagnóstico)`);
  }
  return String(ticket);
}

// ---- Paso: esperar ticket y obtener nombre de archivo ----------------------

async function esperarArchivo(
  cfg: SireConfig,
  token: string,
  periodo: string,
  ticket: string,
  etiqueta: string,
  diag: SireDiag
): Promise<string> {
  const url = buildUrl(cfg, cfg.estadoPath, { periodo, ticket });
  // SUNAT puede tardar en generar el archivo (estado "05 = En proceso").
  const deadline = Date.now() + 95_000;
  let ultima = "";
  while (Date.now() < deadline) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    const txt = await res.text();
    ultima = txt;
    if (!res.ok) {
      diag.pasos.push({
        paso: `estado-${etiqueta}`,
        url,
        metodo: "GET",
        httpStatus: res.status,
        ok: false,
        respuesta: trunc(txt),
      });
      throw new Error(`estado ${etiqueta} (HTTP ${res.status})`);
    }
    let data: any = {};
    try {
      data = JSON.parse(txt);
    } catch {
      /* ignore */
    }
    const registros: any[] = data.registros ?? data.registro ?? (Array.isArray(data) ? data : []);
    const reg = registros[0] ?? data;
    const det = reg?.detalleTicket ?? {};
    const estado = String(reg?.codEstadoProceso ?? det?.codEstadoEnvio ?? reg?.estado ?? "");
    const desc = String(reg?.desEstadoProceso ?? det?.desEstadoEnvio ?? "");
    const terminado = estado === "06" || /termin/i.test(desc);
    // Nº de comprobantes informados en el periodo (0 = mes sin movimiento).
    const comprobantes =
      Number(det?.cntCPInformados ?? det?.cntFilasvalidada ?? reg?.cntCPInformados ?? 0) || 0;
    // El nombre del archivo viene en el arreglo archivoReporte[0].nomArchivoReporte
    // (un .zip que contiene el .txt indicado en nomArchivoContenido).
    const archRep = Array.isArray(reg?.archivoReporte)
      ? reg.archivoReporte[0]
      : reg?.archivoReporte;
    const nombre =
      archRep?.nomArchivoReporte ??
      det?.nomArchivoReporte ??
      reg?.nomArchivoReporte ??
      archRep?.nomArchivoContenido ??
      reg?.nombreArchivo ??
      null;

    if (terminado) {
      diag.pasos.push({
        paso: `estado-${etiqueta}`,
        url,
        metodo: "GET",
        httpStatus: 200,
        ok: true,
        respuesta: trunc(txt, 2500),
      });
      // Mes sin movimiento: no hay archivo útil que descargar -> totales en 0.
      if (comprobantes === 0) return VACIO;
      if (nombre) return String(nombre);
      throw new Error(`${etiqueta}: proceso terminado pero sin nombre de archivo`);
    }
    if (nombre) {
      diag.pasos.push({
        paso: `estado-${etiqueta}`,
        url,
        metodo: "GET",
        httpStatus: 200,
        ok: true,
        respuesta: trunc(txt, 2500),
      });
      return String(nombre);
    }
    if (/(09|error|fallo)/i.test(estado)) {
      throw new Error(`estado ${etiqueta}: proceso con error (${estado})`);
    }
    await new Promise((r) => setTimeout(r, 4000));
  }
  diag.pasos.push({
    paso: `estado-${etiqueta}`,
    url,
    metodo: "GET",
    ok: false,
    respuesta: trunc(ultima, 2500),
  });
  throw new Error(
    `estado ${etiqueta}: SUNAT aún genera el reporte (En proceso). Espera unos segundos y vuelve a Consultar.`
  );
}

// ---- Paso: descargar y parsear --------------------------------------------

async function descargarReporte(
  cfg: SireConfig,
  token: string,
  periodo: string,
  nombre: string,
  codLibro: string,
  etiqueta: string,
  diag: SireDiag
): Promise<string> {
  const url = buildUrl(cfg, cfg.descargaPath, { nombre, periodo, codLibro });
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const detalle = await leerDetalle(res);
    diag.pasos.push({
      paso: `descarga-${etiqueta}`,
      url,
      metodo: "GET",
      httpStatus: res.status,
      ok: false,
      respuesta: trunc(detalle),
    });
    throw new Error(`descarga ${etiqueta} (HTTP ${res.status})`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const texto = descomprimirSiHaceFalta(buf);
  diag.pasos.push({
    paso: `descarga-${etiqueta}`,
    url,
    metodo: "GET",
    httpStatus: 200,
    ok: true,
    respuesta: trunc(texto, 1200),
  });
  return texto;
}

function descomprimirSiHaceFalta(buf: Buffer): string {
  // ZIP empieza con "PK" (0x50 0x4B).
  if (buf[0] === 0x50 && buf[1] === 0x4b) {
    try {
      const files = unzipSync(new Uint8Array(buf));
      const primero = Object.values(files)[0];
      return primero ? strFromU8(primero) : "";
    } catch {
      return "";
    }
  }
  return buf.toString("utf-8");
}

/**
 * Parsea los totales del archivo de PROPUESTA SUNAT (RVIE/RCE).
 * Formato real (separado por "|", con encabezado), columnas relevantes:
 *   - "BI Gravado DG/DGNG/DNG"  -> base imponible gravada
 *   - "IGV / IPM DG/DGNG/DNG"   -> IGV
 *   - "Valor Adq. NG"           -> no gravado / inafecto-exonerado
 *   - "Total CP"                -> importe total del comprobante
 */
function parseTotales(texto: string): SireBloque {
  const lineas = texto
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lineas.length === 0) {
    throw new Error("reporte vacío (usa modo diagnóstico)");
  }

  const delim = ["|", ";", "\t", ","].find((d) => lineas[0].includes(d)) ?? "|";
  const num = (s: string) => {
    const v = Number(String(s ?? "").replace(/[^\d.-]/g, ""));
    return Number.isNaN(v) ? 0 : v;
  };

  const primera = lineas[0].toLowerCase();
  const esEncabezado =
    primera.includes("total cp") ||
    primera.includes("bi gravado") ||
    primera.startsWith("ruc");

  let colsBase: number[];
  let colsIgv: number[];
  let colTotal: number;
  let colInaf: number;
  // Columna "Total Documentos" del resumen (nº de comprobantes por tipo).
  let colDocs = -1;
  let filas: string[];

  if (esEncabezado) {
    const header = lineas[0].split(delim).map((h) => h.trim().toLowerCase());
    // No deben contar como BASE GRAVADA: no gravadas, exonerado, inafecto,
    // exportación, ni "Valor Adq. NG" (compras no gravadas).
    const noGravable = /no\s*gravad|exoner|inafect|export|adq\.?\s*ng/;
    // Base imponible gravada: cualquier columna con "gravad"/"gravada" que NO
    // sea IGV ni una categoría no gravable. Cubre "BI Gravado DG" (compras),
    // "BI Gravada" / "Base Imponible Gravada" (ventas), DG/DGNG/DNG, etc.
    colsBase = header
      .map((h, i) => (/gravad/.test(h) && !/igv|ipm/.test(h) && !noGravable.test(h) ? i : -1))
      .filter((i) => i >= 0);
    // IGV: toda columna que mencione IGV o IPM.
    colsIgv = header
      .map((h, i) => (/igv|ipm/.test(h) ? i : -1))
      .filter((i) => i >= 0);
    colTotal = header.findIndex((h) => /total\s*cp|importe\s*total/.test(h));
    // Compras: "Valor Adq. NG"; ventas: exonerado/inafecto.
    colInaf = header.findIndex((h) => /valor\s*adq.*ng|exonerad|inafect/.test(h));
    colDocs = header.findIndex((h) => /total\s*documentos/.test(h));
    filas = lineas.slice(1);
  } else {
    // Respaldo: posiciones fijas del formato propuesta SUNAT (línea por CP).
    colsBase = [14, 16, 18];
    colsIgv = [15, 17, 19];
    colTotal = 24;
    colInaf = 20;
    filas = lineas;
  }

  if (colsBase.length === 0 && colTotal < 0) {
    throw new Error(
      "formato de reporte no reconocido — ejecuta con 'Modo diagnóstico' y compártelo"
    );
  }

  const b: SireBloque = {
    comprobantes: 0,
    baseImponible: 0,
    igv: 0,
    inafectoExonerado: 0,
    importeTotal: 0,
  };
  for (const linea of filas) {
    const cols = linea.split(delim);
    if (cols.length < 4) continue; // fila no válida
    const primera = (cols[0] ?? "").trim().toLowerCase();
    // Saltar fila de totales del resumen (evita duplicar).
    if (primera === "total" || primera === "") continue;
    // Nº de comprobantes: por "Total Documentos" (resumen) o 1 por fila.
    b.comprobantes += colDocs >= 0 ? num(cols[colDocs]) : 1;
    for (const c of colsBase) b.baseImponible += num(cols[c]);
    for (const c of colsIgv) b.igv += num(cols[c]);
    if (colInaf >= 0) b.inafectoExonerado += num(cols[colInaf]);
    if (colTotal >= 0) b.importeTotal += num(cols[colTotal]);
  }

  // Sin filas de datos: periodo sin movimiento -> totales en cero.
  if (b.comprobantes === 0) return b;

  if (b.importeTotal === 0) {
    b.importeTotal = b.baseImponible + b.igv + b.inafectoExonerado;
  }
  const r = (n: number) => Math.round(n * 100) / 100;
  return {
    comprobantes: b.comprobantes,
    baseImponible: r(b.baseImponible),
    igv: r(b.igv),
    inafectoExonerado: r(b.inafectoExonerado),
    importeTotal: r(b.importeTotal),
  };
}

// ---- Orquestación oficial --------------------------------------------------

async function flujoOficial(
  params: SireParams,
  cfg: SireConfig,
  clientId: string,
  clientSecret: string
): Promise<SireResultado> {
  const { ruc, periodo, solUser, solPass, diagnostico } = params;
  const diag: SireDiag = { periodo, pasos: [] };

  let token: string;
  try {
    token = await obtenerToken(cfg, ruc, solUser, solPass, clientId, clientSecret, diag);
  } catch (err) {
    if (diagnostico) {
      diag.pasos.push({
        paso: "error",
        ok: false,
        respuesta: err instanceof Error ? err.message : String(err),
      });
      return { diag };
    }
    throw err;
  }

  // El resumen suele devolver el CONTENIDO directo (HTTP 200 con el .txt).
  // Si en cambio devuelve un ticket (JSON numTicket), se usa el flujo asíncrono.
  const fetchResumen = async (
    etiqueta: string,
    pathTemplate: string,
    codLibro: string
  ): Promise<string | null> => {
    const url = buildUrl(cfg, pathTemplate, {
      periodo,
      codTipoResumen: cfg.codTipoResumen,
      codTipoArchivo: cfg.codTipoArchivo,
      codLibro,
    });
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });
      const txt = await res.text();
      diag.pasos.push({
        paso: `solicitud-${etiqueta}`,
        url,
        metodo: "GET",
        httpStatus: res.status,
        ok: res.ok,
        respuesta: trunc(txt, 900),
      });
      if (!res.ok) {
        // 1070 = sin comprobantes en el periodo -> vacío (cero), no error.
        if (/1070|no se ha encontrado/i.test(txt)) return "";
        throw new Error(`${etiqueta} (HTTP ${res.status}): ${trunc(txt, 150)}`);
      }
      // ¿Ticket asíncrono o contenido directo?
      let ticket = "";
      try {
        const j = JSON.parse(txt);
        ticket = String(j.numTicket ?? j.numticket ?? j.ticket ?? "");
      } catch {
        /* no es JSON -> contenido directo del resumen */
      }
      if (ticket) {
        const nombre = await esperarArchivo(cfg, token, periodo, ticket, etiqueta, diag);
        if (nombre === VACIO) return "";
        return await descargarReporte(cfg, token, periodo, nombre, codLibro, etiqueta, diag);
      }
      return txt;
    } catch (err) {
      diag.pasos.push({
        paso: `error-${etiqueta}`,
        ok: false,
        respuesta: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  };

  // "" = periodo válido sin movimiento; null = error.
  const fV = await fetchResumen("ventas", cfg.exportVentasPath, cfg.codLibroVentas);
  const fC = await fetchResumen("compras", cfg.exportComprasPath, cfg.codLibroCompras);

  if (diagnostico) {
    return { diag };
  }

  if (fV === null && fC === null) {
    throw new Error("no se pudo obtener ni ventas ni compras (usa modo diagnóstico)");
  }
  const ventas = fV ? parseTotales(fV) : bloqueCero();
  const compras = fC ? parseTotales(fC) : bloqueCero();
  // Estado REAL de presentación (endpoint omisos/periodos).
  const presV = await estadoPresentado(cfg, token, cfg.codLibroVentas, periodo);
  const presC = await estadoPresentado(cfg, token, cfg.codLibroCompras, periodo);
  return {
    resumen: {
      periodo,
      ventas,
      compras,
      presentadoVentas: presV ?? false,
      presentadoCompras: presC ?? false,
      fuente: "oficial",
      consultadoAt: new Date().toISOString(),
    },
    diag,
  };
}

function bloqueCero(): SireBloque {
  return { comprobantes: 0, baseImponible: 0, igv: 0, inafectoExonerado: 0, importeTotal: 0 };
}

// ---- Estado de presentación del registro por periodo -----------------------

/** Devuelve si el registro del periodo fue presentado (true), no presentado
 * (false) o desconocido (null). Endpoint: .../omisos/{codLibro}/periodos. */
async function estadoPresentado(
  cfg: SireConfig,
  token: string,
  codLibro: string,
  periodo: string
): Promise<boolean | null> {
  try {
    const url = `${cfg.apiBase}${cfg.omisosPath.replace("{codLibro}", codLibro)}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    if (!res.ok) return null;
    const data: any = await res.json().catch(() => null);
    if (!data) return null;
    const arr: any[] = data.registros ?? data.lista ?? data.periodos ?? (Array.isArray(data) ? data : []);
    const reg = arr.find((p) => String(p.perTributario ?? p.periodo ?? "") === periodo);
    if (!reg) return null;
    const des = String(reg.desEstado ?? "").toLowerCase();
    if (!des) return null;
    // "No Presentado" -> false ; "Presentado" -> true
    return des.includes("presentado") && !des.includes("no presentado");
  } catch {
    return null;
  }
}

// ---- Modo simulado (determinista por RUC + periodo) ------------------------

function simularBloque(seedBuf: Buffer, escala: number): SireBloque {
  const seed = seedBuf[0] + seedBuf[1] * 256 + seedBuf[2] * 65536;
  const base = Math.round((5000 + (seed % 195000)) * escala);
  const igv = Math.round(base * 0.18 * 100) / 100;
  const inaf = Math.round((seed % 4000) * escala);
  const comprobantes = 5 + (seedBuf[3] % 120);
  return {
    comprobantes,
    baseImponible: base,
    igv,
    inafectoExonerado: inaf,
    importeTotal: Math.round((base + igv + inaf) * 100) / 100,
  };
}

function simular(ruc: string, periodo: string): SireResumen {
  const hV = crypto.createHash("md5").update(`${ruc}-${periodo}-ventas`).digest();
  const hC = crypto.createHash("md5").update(`${ruc}-${periodo}-compras`).digest();
  return {
    periodo,
    ventas: simularBloque(hV, 1),
    compras: simularBloque(hC, 0.7),
    presentadoVentas: true,
    presentadoCompras: true,
    fuente: "simulado",
    consultadoAt: new Date().toISOString(),
  };
}

// ---- API pública ------------------------------------------------------------

export async function consultarResumenSire(
  params: SireParams
): Promise<SireResultado> {
  const { ruc, periodo, solUser, solPass } = params;
  if (!/^\d{11}$/.test(ruc)) throw new Error("RUC inválido.");
  if (!periodoValido(periodo)) {
    throw new Error("Periodo inválido (use formato AAAAMM, p. ej. 202606).");
  }

  const cfg = getConfig();

  // El ejemplo (real=false) o el modo forzado devuelven datos simulados.
  if (params.real !== true || cfg.forceMock) {
    return { resumen: simular(ruc, periodo) };
  }

  // Consulta REAL: exige credenciales; NO cae a simulado para no confundir.
  if (!solUser || !solPass) {
    throw new Error(
      "Para el dato real ingresa el Usuario SOL y la Clave SOL (se borran por seguridad tras cada consulta, vuelve a escribir la clave)."
    );
  }

  const clientId = params.clientId || cfg.defClientId;
  const clientSecret = params.clientSecret || cfg.defClientSecret;
  if (!clientId || !clientSecret) {
    throw new Error(
      "Faltan las credenciales de la app SIRE (client_id y client_secret). " +
        "Genéralas en SUNAT SOL o configúralas en la plataforma."
    );
  }

  try {
    return await flujoOficial(params, cfg, clientId, clientSecret);
  } catch (err) {
    const detalle = err instanceof Error ? err.message : String(err);
    console.error("[SIRE] Falló consulta oficial:", detalle);
    throw new Error(`No se pudo obtener el SIRE real — ${detalle}`);
  }
}

export function etiquetaPeriodo(periodo: string): string {
  if (!periodoValido(periodo)) return periodo;
  const meses = [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Setiembre", "Octubre", "Noviembre", "Diciembre",
  ];
  const anio = periodo.slice(0, 4);
  const mes = Number(periodo.slice(4, 6));
  return `${meses[mes - 1]} ${anio}`;
}
