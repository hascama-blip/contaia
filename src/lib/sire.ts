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
    // Endpoints de PROPUESTA (los más documentados). {periodo} {codTipoArchivo}
    // se reemplazan. Generan un ticket asíncrono igual que el resumen.
    exportVentasPath:
      process.env.SIRE_EXPORT_VENTAS_PATH ??
      "/rvie/propuesta/web/propuesta/{periodo}/exportapropuesta?codTipoArchivo={codTipoArchivo}",
    exportComprasPath:
      process.env.SIRE_EXPORT_COMPRAS_PATH ??
      "/rce/propuesta/web/propuestarce/{periodo}/exportapropuesta?codTipoArchivo={codTipoArchivo}",
    estadoPath:
      process.env.SIRE_ESTADO_PATH ??
      "/rvierce/gestionprocesosmasivos/web/masivo/consultaestadotickets?perIni={periodo}&perFin={periodo}&page=1&perPage=20&numTicket={ticket}",
    descargaPath:
      process.env.SIRE_DESCARGA_PATH ??
      "/rvierce/gestionprocesosmasivos/web/masivo/archivoreporte?nomArchivoReporte={nombre}&codLibro={codLibro}&codTipoArchivoReporte=01",
    codLibroVentas: process.env.SIRE_COD_LIBRO_VENTAS ?? "080000",
    codLibroCompras: process.env.SIRE_COD_LIBRO_COMPRAS ?? "140000",
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
    return txt ? `: ${txt.slice(0, 300)}` : "";
  } catch {
    return "";
  }
}

function trunc(s: string, n = 600): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

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
  const deadline = Date.now() + 40_000;
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
    // El nombre del archivo puede venir en varios campos según el servicio.
    const nombre =
      det?.nomArchivoReporte ??
      reg?.nomArchivoReporte ??
      det?.nomArchivoContenido ??
      reg?.nomArchivoContenido ??
      reg?.archivoReporte?.nomArchivoReporte ??
      reg?.nombreArchivo ??
      null;

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
    if (terminado) {
      // Proceso terminado pero sin nombre de archivo en los campos esperados:
      // registramos la respuesta COMPLETA para localizar el campo correcto.
      diag.pasos.push({
        paso: `estado-${etiqueta}`,
        url,
        metodo: "GET",
        httpStatus: 200,
        ok: true,
        respuesta: trunc(txt, 2500),
      });
      throw new Error(
        `${etiqueta}: proceso terminado pero sin nomArchivoReporte (revisar respuesta del estado)`
      );
    }
    if (/(09|error|fallo)/i.test(estado)) {
      throw new Error(`estado ${etiqueta}: proceso con error (${estado})`);
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  diag.pasos.push({
    paso: `estado-${etiqueta}`,
    url,
    metodo: "GET",
    ok: false,
    respuesta: trunc(ultima, 2500),
  });
  throw new Error(`estado ${etiqueta}: tiempo de espera agotado`);
}

// ---- Paso: descargar y parsear --------------------------------------------

async function descargarReporte(
  cfg: SireConfig,
  token: string,
  nombre: string,
  codLibro: string,
  etiqueta: string,
  diag: SireDiag
): Promise<string> {
  const url = buildUrl(cfg, cfg.descargaPath, { nombre, codLibro });
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

/** Parsea los totales del reporte de resumen (formato a calibrar). */
function parseTotales(texto: string): SireBloque {
  const lineas = texto
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lineas.length === 0) {
    throw new Error("reporte vacío (usa modo diagnóstico)");
  }
  // Detecta delimitador del archivo.
  const delim = ["|", ";", "\t", ","].find((d) => lineas[0].includes(d)) ?? "|";
  const bloque: SireBloque = {
    comprobantes: 0,
    baseImponible: 0,
    igv: 0,
    inafectoExonerado: 0,
    importeTotal: 0,
  };
  const num = (s: string) => {
    const v = Number(String(s).replace(/[^\d.-]/g, ""));
    return Number.isNaN(v) ? 0 : v;
  };
  // Heurística: usa el encabezado para ubicar columnas por nombre.
  const header = lineas[0].toLowerCase().split(delim);
  const idx = (re: RegExp) => header.findIndex((h) => re.test(h));
  const iBase = idx(/base|gravad|valor/);
  const iIgv = idx(/igv|impuesto/);
  const iTotal = idx(/total|importe/);
  const iInaf = idx(/inafect|exoner/);
  const hayHeader = iBase >= 0 || iIgv >= 0 || iTotal >= 0;

  const filas = hayHeader ? lineas.slice(1) : lineas;
  for (const linea of filas) {
    const cols = linea.split(delim);
    if (cols.length < 2) continue;
    bloque.comprobantes += 1;
    if (iBase >= 0) bloque.baseImponible += num(cols[iBase]);
    if (iIgv >= 0) bloque.igv += num(cols[iIgv]);
    if (iInaf >= 0) bloque.inafectoExonerado += num(cols[iInaf]);
    if (iTotal >= 0) bloque.importeTotal += num(cols[iTotal]);
  }
  if (!hayHeader || (bloque.baseImponible === 0 && bloque.importeTotal === 0)) {
    throw new Error(
      "formato de reporte no reconocido — ejecuta con 'Modo diagnóstico' y compártelo"
    );
  }
  if (bloque.importeTotal === 0) {
    bloque.importeTotal = bloque.baseImponible + bloque.igv + bloque.inafectoExonerado;
  }
  const r = (n: number) => Math.round(n * 100) / 100;
  return {
    comprobantes: bloque.comprobantes,
    baseImponible: r(bloque.baseImponible),
    igv: r(bloque.igv),
    inafectoExonerado: r(bloque.inafectoExonerado),
    importeTotal: r(bloque.importeTotal),
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

  // Procesa cada registro de forma INDEPENDIENTE: un fallo en compras no
  // impide ver el flujo completo de ventas (ticket -> estado -> descarga).
  const intentar = async (
    etiqueta: string,
    pathTemplate: string,
    codLibro: string
  ): Promise<string | null> => {
    try {
      const ticket = await solicitarTicket(cfg, token, periodo, pathTemplate, codLibro, etiqueta, diag);
      const nombre = await esperarArchivo(cfg, token, periodo, ticket, etiqueta, diag);
      return await descargarReporte(cfg, token, nombre, codLibro, etiqueta, diag);
    } catch (err) {
      diag.pasos.push({
        paso: `error-${etiqueta}`,
        ok: false,
        respuesta: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  };

  const fV = await intentar("ventas", cfg.exportVentasPath, cfg.codLibroVentas);
  const fC = await intentar("compras", cfg.exportComprasPath, cfg.codLibroCompras);

  if (diagnostico) {
    return { diag };
  }

  if (!fV && !fC) {
    throw new Error("no se pudo obtener ni ventas ni compras (usa modo diagnóstico)");
  }
  const ventas = fV ? parseTotales(fV) : bloqueCero();
  const compras = fC ? parseTotales(fC) : bloqueCero();
  return {
    resumen: {
      periodo,
      ventas,
      compras,
      fuente: "oficial",
      consultadoAt: new Date().toISOString(),
    },
    diag,
  };
}

function bloqueCero(): SireBloque {
  return { comprobantes: 0, baseImponible: 0, igv: 0, inafectoExonerado: 0, importeTotal: 0 };
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
  const quiereReal = Boolean(solUser && solPass) && !cfg.forceMock;

  if (!quiereReal) {
    return { resumen: simular(ruc, periodo) };
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
