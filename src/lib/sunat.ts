import crypto from "crypto";
import type { SunatInfo, RepresentanteLegal } from "./types";

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

type Provider = "oficial" | "decolecta" | "apisnet" | "mock";

interface SunatConfig {
  provider: string;
  clientId: string;
  clientSecret: string;
  ruc: string;
  solUser: string;
  solPass: string;
  tokenUrl: string;
  apiBase: string;
  decolectaToken: string;
  decolectaUrl: string;
  repsUrl: string;
  apisnetToken: string;
  apisnetUrl: string;
  forceMock: boolean;
}

function getConfig(): SunatConfig {
  return {
    // "auto" (por defecto) elige la mejor fuente disponible según las credenciales.
    // También puede forzarse: "decolecta" | "apisnet" | "oficial" | "mock".
    provider: process.env.SUNAT_PROVIDER ?? "auto",
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
    // Fuente externa decolecta.com (consulta RUC, endpoint extendido /full).
    decolectaToken: process.env.DECOLECTA_TOKEN ?? "",
    decolectaUrl:
      process.env.DECOLECTA_URL ?? "https://api.decolecta.com/v1/sunat/ruc/full",
    // Endpoint de representantes legales de decolecta (configurable por si cambia).
    repsUrl:
      process.env.DECOLECTA_REPRESENTANTES_URL ??
      "https://api.decolecta.com/v1/sunat/representantes-legales",
    // Fuente externa apis.net.pe (consulta RUC). Requiere token gratuito.
    apisnetToken: process.env.APISNET_TOKEN ?? "",
    apisnetUrl: process.env.APISNET_URL ?? "https://api.apis.net.pe/v2/sunat/ruc",
    forceMock: (process.env.SUNAT_FORCE_MOCK ?? "false") === "true",
  };
}

function tieneCredenciales(cfg: SunatConfig): boolean {
  return Boolean(
    cfg.clientId && cfg.clientSecret && cfg.solUser && cfg.solPass
  );
}

/** Decide qué fuente usar según configuración y credenciales disponibles. */
function resolverProvider(cfg: SunatConfig): Provider {
  if (cfg.forceMock) return "mock";
  const p = cfg.provider.toLowerCase();
  if (p === "mock") return "mock";
  if (p === "decolecta") return cfg.decolectaToken ? "decolecta" : "mock";
  if (p === "apisnet") return cfg.apisnetToken ? "apisnet" : "mock";
  if (p === "oficial") return tieneCredenciales(cfg) ? "oficial" : "mock";
  // auto: prioriza decolecta (datos extendidos), luego apis.net.pe, luego SOL.
  if (cfg.decolectaToken) return "decolecta";
  if (cfg.apisnetToken) return "apisnet";
  if (tieneCredenciales(cfg)) return "oficial";
  return "mock";
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

/** Lee un fragmento del cuerpo de error (sin datos sensibles). */
async function leerCuerpo(res: Response): Promise<string> {
  try {
    const txt = (await res.text()).trim();
    return txt ? `: ${txt.slice(0, 200)}` : "";
  } catch {
    return "";
  }
}

/** fetch con timeout (AbortController): evita que una fuente lenta cuelgue toda
 *  la consulta (Render corta en ~30s y devuelve 502). */
async function fetchTimeout(url: string, opts: any, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

// ---- Representantes legales (decolecta) -------------------------------------

/** Normaliza la respuesta de representantes (la forma exacta varía: array suelto,
 *  {data:[...]}, {representantes:[...]}, nombre combinado o partido en apellidos). */
function parseRepresentantes(payload: any): RepresentanteLegal[] {
  const arr = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.data)
    ? payload.data
    : Array.isArray(payload?.representantes)
    ? payload.representantes
    : Array.isArray(payload?.representantes_legales)
    ? payload.representantes_legales
    : [];
  return (arr as any[])
    .map((r) => {
      const nombre = String(
        r.nombre ??
          r.nombre_completo ??
          r.nombreCompleto ??
          [r.apellido_paterno, r.apellido_materno, r.nombres].filter(Boolean).join(" ")
      )
        .replace(/\s+/g, " ")
        .trim();
      return {
        tipoDoc:
          String(r.tipo_documento ?? r.tipoDocumento ?? r.tipo_doc ?? r.tipo ?? "").trim() ||
          undefined,
        numeroDoc: String(
          r.numero_documento ?? r.numeroDocumento ?? r.documento ?? r.num_doc ?? r.dni ?? ""
        ).trim(),
        nombre,
        cargo: String(r.cargo ?? r.descripcion_cargo ?? r.desc_cargo ?? "").trim() || undefined,
        desde: String(r.fecha_desde ?? r.desde ?? r.fecha ?? "").trim() || undefined,
      } as RepresentanteLegal;
    })
    .filter((r) => r.nombre || r.numeroDoc);
}

/** Consulta los representantes legales en decolecta. Best-effort: [] si falla. */
async function consultarRepresentantes(ruc: string, cfg: SunatConfig): Promise<RepresentanteLegal[]> {
  if (!cfg.decolectaToken || !cfg.repsUrl) return [];
  try {
    const sep = cfg.repsUrl.includes("?") ? "&" : "?";
    const res = await fetchTimeout(
      `${cfg.repsUrl}${sep}numero=${ruc}`,
      { headers: { Authorization: `Bearer ${cfg.decolectaToken}`, Accept: "application/json" } },
      8000
    );
    if (!res.ok) return [];
    return parseRepresentantes(await res.json());
  } catch {
    return [];
  }
}

// ---- Fuente externa: decolecta.com -----------------------------------------

async function consultarDecolecta(
  ruc: string,
  cfg: SunatConfig
): Promise<SunatInfo> {
  const sep = cfg.decolectaUrl.includes("?") ? "&" : "?";
  const url = `${cfg.decolectaUrl}${sep}numero=${ruc}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${cfg.decolectaToken}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const detalle = await leerCuerpo(res);
    throw new Error(`decolecta HTTP ${res.status}${detalle}`);
  }
  const d = (await res.json()) as Record<string, any>;

  // decolecta usa snake_case; mapeamos defensivamente.
  const direccion =
    d.direccion_completa ??
    d.direccion ??
    [d.direccion, d.distrito, d.provincia, d.departamento]
      .filter(Boolean)
      .join(", ");

  // Aprovechamos indicadores extendidos del endpoint /full como "tributos".
  const tributos: string[] = Array.isArray(d.tributos) ? [...d.tributos] : [];
  if (d.es_agente_de_retencion) tributos.push("AGENTE DE RETENCIÓN");
  if (d.es_buen_contribuyente) tributos.push("BUEN CONTRIBUYENTE");
  if (d.tipo_contribuyente && !d.tipo) tributos.push(String(d.tipo_contribuyente));

  // Representantes legales: si vienen embebidos en /full los usamos; si no,
  // consultamos el endpoint dedicado (no es fatal si falla).
  let representantes = parseRepresentantes(d.representantes_legales ?? d.representantes);
  if (!representantes.length) representantes = await consultarRepresentantes(ruc, cfg);

  return {
    ruc,
    razonSocial: d.razon_social ?? d.razonSocial ?? d.nombre ?? "",
    estado: String(d.estado ?? "DESCONOCIDO").toUpperCase(),
    condicion: String(d.condicion ?? "DESCONOCIDO").toUpperCase(),
    tipoContribuyente: d.tipo_contribuyente ?? d.tipo ?? "",
    direccion: direccion || "",
    tributos,
    representantes,
    comprobanteElectronico: true,
    fuente: "externo",
    consultadoAt: new Date().toISOString(),
  };
}

/** Diagnóstico: respuestas CRUDAS de decolecta (RUC full + representantes) para
 *  calibrar el mapeo si los nombres de campo difieren. */
export async function debugDecolecta(ruc: string): Promise<any> {
  const cfg = getConfig();
  if (!cfg.decolectaToken) return { error: "Sin DECOLECTA_TOKEN configurado." };
  const headers = { Authorization: `Bearer ${cfg.decolectaToken}`, Accept: "application/json" };
  const out: any = {};
  try {
    const sep = cfg.decolectaUrl.includes("?") ? "&" : "?";
    const r = await fetchTimeout(`${cfg.decolectaUrl}${sep}numero=${ruc}`, { headers }, 10000);
    out.full = { status: r.status, body: await r.json().catch(() => null) };
  } catch (e) {
    out.full = { error: e instanceof Error ? e.message : String(e) };
  }
  try {
    const sep = cfg.repsUrl.includes("?") ? "&" : "?";
    const r = await fetchTimeout(`${cfg.repsUrl}${sep}numero=${ruc}`, { headers }, 10000);
    out.representantes = { url: cfg.repsUrl, status: r.status, body: await r.json().catch(() => null) };
  } catch (e) {
    out.representantes = { error: e instanceof Error ? e.message : String(e) };
  }
  return out;
}

// ---- Fuente externa: apis.net.pe -------------------------------------------

async function consultarApisNet(
  ruc: string,
  cfg: SunatConfig
): Promise<SunatInfo> {
  const url = `${cfg.apisnetUrl}?numero=${ruc}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${cfg.apisnetToken}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const detalle = await leerCuerpo(res);
    throw new Error(`apis.net.pe HTTP ${res.status}${detalle}`);
  }
  const d = (await res.json()) as Record<string, any>;
  // Mapeo defensivo: apis.net.pe ha usado distintos nombres de campo (v1/v2).
  const direccion =
    d.direccion ??
    d.direccionCompleta ??
    [d.direccion, d.distrito, d.provincia, d.departamento]
      .filter(Boolean)
      .join(", ");
  return {
    ruc,
    razonSocial: d.razonSocial ?? d.nombre ?? "",
    estado: String(d.estado ?? "DESCONOCIDO").toUpperCase(),
    condicion: String(d.condicion ?? "DESCONOCIDO").toUpperCase(),
    tipoContribuyente: d.tipo ?? d.tipoContribuyente ?? "",
    direccion: direccion || "",
    tributos: Array.isArray(d.tributos) ? d.tributos : [],
    // apis.net.pe no expone afiliación a comprobante electrónico; lo asumimos.
    comprobanteElectronico: true,
    fuente: "externo",
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
  const provider = resolverProvider(cfg);

  // Si se exige explícitamente una fuente real (decolecta/apisnet/oficial),
  // NO devolvemos datos simulados de respaldo: ante un fallo, lanzamos error
  // para que el usuario nunca confunda datos reales con datos de ejemplo.
  const fuenteRealExigida = ["decolecta", "apisnet", "oficial"].includes(
    cfg.provider.toLowerCase()
  );

  if (fuenteRealExigida && provider === "mock") {
    throw new Error(
      "Falta configurar el token de la fuente externa (revisa DECOLECTA_TOKEN / APISNET_TOKEN o las credenciales SOL)."
    );
  }

  // Orden de intentos: la fuente elegida primero y, como RESPALDO, las demás
  // fuentes reales que estén configuradas (si decolecta agota su límite, se
  // intenta apis.net.pe u oficial automáticamente).
  const orden: Provider[] = [];
  if (provider !== "mock") orden.push(provider);
  if (cfg.decolectaToken && !orden.includes("decolecta")) orden.push("decolecta");
  if (cfg.apisnetToken && !orden.includes("apisnet")) orden.push("apisnet");
  if (tieneCredenciales(cfg) && !orden.includes("oficial")) orden.push("oficial");

  let ultimoError = "";
  for (const p of orden) {
    try {
      if (p === "decolecta") return await consultarDecolecta(cleaned, cfg);
      if (p === "apisnet") return await consultarApisNet(cleaned, cfg);
      if (p === "oficial") return await consultarOficial(cleaned, cfg);
    } catch (err) {
      ultimoError = err instanceof Error ? err.message : String(err);
      console.error(`[SUNAT] Falló fuente "${p}":`, ultimoError);
      // sigue con la próxima fuente de respaldo
    }
  }

  if (fuenteRealExigida || orden.length > 0) {
    throw new Error(
      `No se pudo obtener la información de SUNAT — ${ultimoError}. ` +
        `Puedes escribir la razón social a mano y crear el cliente igual.`
    );
  }
  // En modo "auto" sin ninguna fuente real, degradamos a simulado (desarrollo).
  return simular(cleaned);
}

export function sunatModo(): Provider {
  return resolverProvider(getConfig());
}

// ---- Actividad económica (rubro) por decolecta, para clasificación ----------
/**
 * Devuelve el rubro (actividad económica) y la razón social de un RUC vía
 * decolecta. Liviano y tolerante: null si no hay token o falla.
 */
export async function consultarActividad(
  ruc: string
): Promise<{ razonSocial: string; actividad: string } | null> {
  const token = process.env.DECOLECTA_TOKEN ?? "";
  const baseUrl = process.env.DECOLECTA_URL ?? "https://api.decolecta.com/v1/sunat/ruc/full";
  if (!token || !/^\d{11}$/.test(ruc)) return null;
  try {
    const sep = baseUrl.includes("?") ? "&" : "?";
    const res = await fetch(`${baseUrl}${sep}numero=${ruc}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    if (!res.ok) return null;
    const d = (await res.json()) as Record<string, any>;
    let act: any =
      d.actividad_economica ?? d.actividadEconomica ?? d.ciiu ?? d.actividad ?? "";
    if (!act && Array.isArray(d.actividades_economicas) && d.actividades_economicas.length) {
      const a0 = d.actividades_economicas[0];
      act = typeof a0 === "string" ? a0 : a0?.descripcion ?? a0?.actividad ?? a0?.ciiu ?? "";
    }
    return {
      razonSocial: String(d.razon_social ?? d.razonSocial ?? d.nombre ?? ""),
      actividad: String(act ?? ""),
    };
  } catch {
    return null;
  }
}
