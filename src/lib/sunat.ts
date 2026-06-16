import crypto from "crypto";
import type { SunatInfo } from "./types";

// ============================================================
//  Integración SUNAT (oficial OAuth2 con Clave SOL) + fallback simulado
// ============================================================
//
// La API oficial de SUNAT para consulta de contribuyente usa OAuth2
// (client credentials / password) contra el servidor de seguridad,
// y luego se consultan los endpoints de contribuyente con el token.
//
// Como las credenciales SOL son privadas y deben configurarse por el
// estudio contable, esta capa:
//   1) Si hay credenciales -> intenta la consulta oficial real.
//   2) Si NO hay credenciales o falla -> devuelve datos SIMULADOS
//      (deterministas a partir del RUC) para que la app sea usable.
//
// Toda la app consume `consultarSunat()` sin saber el origen; el campo
// `fuente` indica si el dato es "oficial" o "simulado".

interface SunatConfig {
  clientId: string;
  clientSecret: string;
  ruc: string;
  solUser: string;
  solPass: string;
  tokenUrl: string;
  apiBase: string;
  forceMock: boolean;
}

function getConfig(): SunatConfig {
  return {
    clientId: process.env.SUNAT_CLIENT_ID ?? "",
    clientSecret: process.env.SUNAT_CLIENT_SECRET ?? "",
    ruc: process.env.SUNAT_RUC ?? "",
    solUser: process.env.SUNAT_SOL_USER ?? "",
    solPass: process.env.SUNAT_SOL_PASS ?? "",
    tokenUrl:
      process.env.SUNAT_TOKEN_URL ??
      "https://api-seguridad.sunat.gob.pe/v1/clientessol",
    apiBase:
      process.env.SUNAT_API_BASE ??
      "https://api.sunat.gob.pe/v1/contribuyente/contribuyentes",
    forceMock: (process.env.SUNAT_FORCE_MOCK ?? "false") === "true",
  };
}

function tieneCredenciales(cfg: SunatConfig): boolean {
  return Boolean(
    cfg.clientId && cfg.clientSecret && cfg.solUser && cfg.solPass
  );
}

/** Valida estructura básica de un RUC peruano (11 dígitos). */
export function rucValido(ruc: string): boolean {
  return /^\d{11}$/.test(ruc.trim());
}

// ---- Cliente OAuth2 oficial -------------------------------------------------

let cachedToken: { token: string; expiresAt: number } | null = null;

async function obtenerToken(cfg: SunatConfig): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.token;
  }
  // Endpoint de token según patrón SUNAT:
  //   POST {tokenUrl}/{clientId}/oauth2/token/
  const url = `${cfg.tokenUrl}/${cfg.clientId}/oauth2/token/`;
  const body = new URLSearchParams({
    grant_type: "password",
    scope: "https://api.sunat.gob.pe",
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    username: cfg.solUser,
    password: cfg.solPass,
  });
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(`SUNAT token error ${res.status}`);
  }
  const json = (await res.json()) as {
    access_token: string;
    expires_in?: number;
  };
  cachedToken = {
    token: json.access_token,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  };
  return cachedToken.token;
}

async function consultarOficial(
  ruc: string,
  cfg: SunatConfig
): Promise<SunatInfo> {
  const token = await obtenerToken(cfg);
  // Endpoint de padrón reducido / información del contribuyente.
  const url = `${cfg.apiBase}/${ruc}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`SUNAT consulta error ${res.status}`);
  }
  const d = (await res.json()) as Record<string, any>;
  return {
    ruc,
    razonSocial: d.razonSocial ?? d.nombre ?? "",
    estado: d.estado ?? d.estadoContribuyente ?? "DESCONOCIDO",
    condicion: d.condicion ?? d.condicionDomicilio ?? "DESCONOCIDO",
    tipoContribuyente: d.tipoContribuyente ?? d.tipo ?? "",
    direccion: d.direccion ?? d.domicilioFiscal ?? "",
    tributos: Array.isArray(d.tributos) ? d.tributos : [],
    comprobanteElectronico: Boolean(d.comprobanteElectronico ?? true),
    fuente: "oficial",
    consultadoAt: new Date().toISOString(),
  };
}

// ---- Modo simulado (determinista por RUC) ----------------------------------

function pick<T>(arr: T[], seed: number): T {
  return arr[seed % arr.length];
}

function simular(ruc: string): SunatInfo {
  // Hash determinista del RUC para generar datos estables y realistas.
  const hash = crypto.createHash("md5").update(ruc).digest();
  const seed = hash[0] + hash[1] * 256;

  const estados = ["ACTIVO", "ACTIVO", "ACTIVO", "SUSPENSION TEMPORAL", "BAJA DE OFICIO"];
  const condiciones = ["HABIDO", "HABIDO", "HABIDO", "NO HABIDO", "NO HALLADO"];
  const tipos = [
    "PERSONA JURIDICA",
    "PERSONA NATURAL CON NEGOCIO",
    "EMPRESA INDIVIDUAL DE RESP. LTDA",
  ];
  const regimenes = [
    ["IGV - OPER. INT. - CTA. PROPIA", "RENTA-3RA. CATEG. RG", "ESSALUD"],
    ["RENTA - REGIMEN MYPE TRIBUTARIO", "IGV - OPER. INT. - CTA. PROPIA"],
    ["NUEVO RUS", "RENTA - NUEVO RUS"],
    ["RENTA - REGIMEN ESPECIAL", "IGV - OPER. INT. - CTA. PROPIA", "ESSALUD"],
  ];

  return {
    ruc,
    razonSocial: `CONTRIBUYENTE DEMO ${ruc.slice(-4)} S.A.C.`,
    estado: pick(estados, seed),
    condicion: pick(condiciones, hash[2]),
    tipoContribuyente: pick(tipos, hash[3]),
    direccion: `AV. EJEMPLO ${100 + (hash[4] % 800)} - LIMA, LIMA, LIMA`,
    tributos: pick(regimenes, hash[5]),
    comprobanteElectronico: hash[6] % 4 !== 0,
    fuente: "simulado",
    consultadoAt: new Date().toISOString(),
  };
}

// ---- API pública ------------------------------------------------------------

export async function consultarSunat(ruc: string): Promise<SunatInfo> {
  const cleaned = ruc.trim();
  if (!rucValido(cleaned)) {
    throw new Error("RUC inválido: debe tener 11 dígitos numéricos.");
  }
  const cfg = getConfig();

  if (!cfg.forceMock && tieneCredenciales(cfg)) {
    try {
      return await consultarOficial(cleaned, cfg);
    } catch (err) {
      // Si la API oficial falla, degradamos a simulado para no romper el flujo,
      // pero dejamos rastro en consola para diagnóstico.
      console.error("[SUNAT] Falló consulta oficial, usando simulado:", err);
    }
  }
  return simular(cleaned);
}

export function sunatModo(): "oficial" | "simulado" {
  const cfg = getConfig();
  return !cfg.forceMock && tieneCredenciales(cfg) ? "oficial" : "simulado";
}
