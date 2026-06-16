import crypto from "crypto";
import type { SireBloque, SireResumen } from "./types";

// ============================================================
//  Integración SIRE de SUNAT (RVIE ventas + RCE compras)
// ============================================================
//
// El SIRE es información privada del contribuyente. Para obtenerla se
// autentica con la Clave SOL del cliente contra la API oficial de SUNAT
// (OAuth2, grant_type=password) y se consultan los resúmenes del periodo.
//
// Por seguridad, las credenciales se reciben en cada consulta y NO se
// persisten. Solo se guardan los TOTALES resultantes (no sensibles).
//
// Filosofía estricta: si se ingresan credenciales reales y la consulta
// falla, se lanza error (no se devuelven datos simulados que confundan).
// Si NO se ingresan credenciales, se devuelve un resumen SIMULADO para
// poder previsualizar la interfaz.
//
// NOTA: los endpoints oficiales del SIRE pueden variar según el plan/versión
// habilitada para el contribuyente; por eso las URLs son configurables por
// variables de entorno y el parseo de la respuesta es defensivo.

export interface SireParams {
  ruc: string;
  periodo: string; // "YYYYMM"
  solUser: string;
  solPass: string;
  /** client_id / client_secret de la credencial SIRE del contribuyente. */
  clientId?: string;
  clientSecret?: string;
}

interface SireConfig {
  tokenUrl: string;
  apiBase: string;
  ventasPath: string;
  comprasPath: string;
  defClientId: string;
  defClientSecret: string;
  forceMock: boolean;
}

function getConfig(): SireConfig {
  return {
    tokenUrl:
      process.env.SUNAT_TOKEN_URL ??
      "https://api-seguridad.sunat.gob.pe/v1/clientessol",
    apiBase:
      process.env.SIRE_API_BASE ??
      "https://api-sire.sunat.gob.pe/v1/contribuyente/migeigv/libros",
    // Rutas de resumen (configurables). {periodo} se reemplaza por YYYYMM.
    ventasPath:
      process.env.SIRE_VENTAS_PATH ??
      "/rvie/resumen/web/resumencomprobantes/{periodo}",
    comprasPath:
      process.env.SIRE_COMPRAS_PATH ??
      "/rce/resumen/web/resumencomprobantes/{periodo}",
    // Credencial SIRE a nivel plataforma (si todos usan la misma app registrada).
    defClientId: process.env.SUNAT_SIRE_CLIENT_ID ?? "",
    defClientSecret: process.env.SUNAT_SIRE_CLIENT_SECRET ?? "",
    forceMock: (process.env.SIRE_FORCE_MOCK ?? "false") === "true",
  };
}

/** Valida un periodo tributario "YYYYMM". */
export function periodoValido(periodo: string): boolean {
  if (!/^\d{6}$/.test(periodo)) return false;
  const mes = Number(periodo.slice(4, 6));
  return mes >= 1 && mes <= 12;
}

// ---- Autenticación oficial (OAuth2 password) -------------------------------

async function obtenerToken(
  cfg: SireConfig,
  ruc: string,
  solUser: string,
  solPass: string,
  clientId: string,
  clientSecret: string
): Promise<string> {
  const url = `${cfg.tokenUrl}/${clientId}/oauth2/token/`;
  const body = new URLSearchParams({
    grant_type: "password",
    scope: "https://api-sire.sunat.gob.pe",
    client_id: clientId,
    client_secret: clientSecret,
    // SUNAT espera el usuario como RUC + usuario SOL.
    username: `${ruc}${solUser}`,
    password: solPass,
  });
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(`SIRE auth error ${res.status}`);
  }
  const json = (await res.json()) as { access_token: string };
  if (!json.access_token) throw new Error("SIRE auth sin token");
  return json.access_token;
}

async function fetchResumen(
  cfg: SireConfig,
  token: string,
  path: string,
  periodo: string
): Promise<SireBloque> {
  const url = `${cfg.apiBase}${path.replace("{periodo}", periodo)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`SIRE resumen error ${res.status} (${url})`);
  }
  const data = (await res.json()) as any;
  return mapearBloque(data);
}

/** Mapeo defensivo: el resumen SIRE agrupa por tipo; sumamos los totales. */
function mapearBloque(data: any): SireBloque {
  const filas: any[] = Array.isArray(data)
    ? data
    : Array.isArray(data?.registros)
      ? data.registros
      : Array.isArray(data?.detalle)
        ? data.detalle
        : data
          ? [data]
          : [];

  const bloque: SireBloque = {
    comprobantes: 0,
    baseImponible: 0,
    igv: 0,
    inafectoExonerado: 0,
    importeTotal: 0,
  };

  const num = (...keys: string[]) => (row: any): number => {
    for (const k of keys) {
      const v = row[k];
      if (v != null && !Number.isNaN(Number(v))) return Number(v);
    }
    return 0;
  };
  const getComprobantes = num("totalCpe", "cantCp", "cantidad", "numDoc", "totalComprobantes");
  const getBase = num("mtoBIGravadaDG", "valorAdqNG", "baseImponible", "mtoBaseImponible", "mtoImporteTotal");
  const getIgv = num("mtoIGV", "mtoIgvIpm", "igv", "mtoIGVIPM");
  const getInaf = num("mtoExonerado", "mtoInafecto", "inafectoExonerado", "mtoExoneradoInafecto");
  const getTotal = num("mtoImporteTotal", "importeTotal", "mtoTotalCP", "total");

  for (const row of filas) {
    bloque.comprobantes += getComprobantes(row);
    bloque.baseImponible += getBase(row);
    bloque.igv += getIgv(row);
    bloque.inafectoExonerado += getInaf(row);
    bloque.importeTotal += getTotal(row);
  }
  // Si la API no trae total explícito, lo derivamos.
  if (bloque.importeTotal === 0) {
    bloque.importeTotal =
      bloque.baseImponible + bloque.igv + bloque.inafectoExonerado;
  }
  return redondear(bloque);
}

function redondear(b: SireBloque): SireBloque {
  const r = (n: number) => Math.round(n * 100) / 100;
  return {
    comprobantes: Math.round(b.comprobantes),
    baseImponible: r(b.baseImponible),
    igv: r(b.igv),
    inafectoExonerado: r(b.inafectoExonerado),
    importeTotal: r(b.importeTotal),
  };
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
): Promise<SireResumen> {
  const { ruc, periodo, solUser, solPass } = params;
  if (!/^\d{11}$/.test(ruc)) throw new Error("RUC inválido.");
  if (!periodoValido(periodo)) {
    throw new Error("Periodo inválido (use formato AAAAMM, p. ej. 202606).");
  }

  const cfg = getConfig();
  const quiereReal = Boolean(solUser && solPass) && !cfg.forceMock;

  if (!quiereReal) {
    return simular(ruc, periodo);
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
    const token = await obtenerToken(
      cfg,
      ruc,
      solUser,
      solPass,
      clientId,
      clientSecret
    );
    const [ventas, compras] = await Promise.all([
      fetchResumen(cfg, token, cfg.ventasPath, periodo),
      fetchResumen(cfg, token, cfg.comprasPath, periodo),
    ]);
    return {
      periodo,
      ventas,
      compras,
      fuente: "oficial",
      consultadoAt: new Date().toISOString(),
    };
  } catch (err) {
    console.error("[SIRE] Falló consulta oficial:", err);
    throw new Error(
      "No se pudo obtener el SIRE real de SUNAT. Verifica la Clave SOL, las " +
        "credenciales de la app SIRE y que el periodo esté disponible."
    );
  }
}

/** Etiqueta legible de un periodo "YYYYMM" -> "Junio 2026". */
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
