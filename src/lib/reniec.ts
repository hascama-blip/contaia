// ============================================================
//  Consulta de DNI (RENIEC) vía apidni.com — con fallback simulado
// ============================================================
//
// Proveedor: https://apidni.com (manual: https://apidni.com/docs/).
//   GET https://apidni.com/api/v2/dni/{dni}
//   Authorization: Bearer {APIDNI_TOKEN}
//   Respuesta OK  → { respuesta: "Solicitud exitosa", data: {...}, codigo: >0 }
//   Plan ORO: `data` trae además la FOTO del DNI en base64 (soporte de apidni,
//   05/10/2026). El nombre exacto del campo no está en el manual: se aceptan
//   foto / foto_base64 / imagen / photo. Se devuelve como `fotoBase64` (JPG).
//
// Caché: cada DNI consultado se guarda en DATA_DIR/reniec-cache.json durante
// RENIEC_CACHE_DIAS (365). Así una segunda búsqueda del mismo DNI no gasta
// consulta del plan ni necesita la membresía activa.
//   Respuesta mal → { respuesta: "<motivo>", data: {}, codigo: 0 }
//     motivos: longitud inválida, "Error en la consulta" (no existe),
//     token expirado, consultas del plan agotadas, límite diario.
//
// El token vive SOLO en el servidor (Render → Environment → APIDNI_TOKEN).
// Sin token la consulta devuelve datos SIMULADOS (fuente "simulado") para
// poder probar la pantalla sin gastar consultas.

import fs from "fs/promises";
import path from "path";
import { DATA_DIR } from "./db";

export interface PersonaReniec {
  dni: string;
  nombres: string;
  apellidoPaterno: string;
  apellidoMaterno: string;
  /** AAAA-MM-DD ("" si el plan no lo trae) */
  fechaNacimiento: string;
  genero: string;
  direccion: string;
  ubigeo: string;
  distrito: string;
  provincia: string;
  departamento: string;
  /** Foto del DNI (JPG en base64, sin prefijo data:). Solo planes que la incluyen. */
  fotoBase64?: string;
  fuente: "apidni" | "simulado" | "cache";
  consultadoAt: string;
}

/** Error "de negocio" de la consulta (DNI inexistente, cuota agotada…). */
export class ErrorReniec extends Error {
  constructor(
    message: string,
    /** 404 no existe · 429 cuota/límite · 401 token · 502 otro */
    public status: number
  ) {
    super(message);
  }
}

function getConfig() {
  return {
    token: process.env.APIDNI_TOKEN ?? "",
    url: process.env.APIDNI_URL ?? "https://apidni.com/api/v2/dni",
    forceMock: process.env.RENIEC_FORCE_MOCK === "true",
    timeoutMs: Number(process.env.APIDNI_TIMEOUT_MS ?? 12_000),
    cacheDias: Number(process.env.RENIEC_CACHE_DIAS ?? 365),
  };
}

// ---- Caché en disco (DATA_DIR/reniec-cache.json) ------------------------------
const CACHE_PATH = path.join(DATA_DIR, "reniec-cache.json");
let cache: Record<string, PersonaReniec> | null = null;

async function leerCache(): Promise<Record<string, PersonaReniec>> {
  if (cache) return cache;
  try {
    cache = JSON.parse(await fs.readFile(CACHE_PATH, "utf8"));
  } catch {
    cache = {};
  }
  return cache!;
}

async function guardarEnCache(p: PersonaReniec): Promise<void> {
  const c = await leerCache();
  c[p.dni] = p;
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(CACHE_PATH, JSON.stringify(c));
  } catch {
    /* sin disco: queda solo en memoria */
  }
}

/** "data:image/jpeg;base64,/9j/..." o "/9j/..." → base64 limpio ("" si no parece imagen). */
function fotoLimpia(v: unknown): string {
  const s = String(v ?? "").trim().replace(/^data:image\/\w+;base64,/, "").replace(/\s+/g, "");
  return s.length > 100 && /^[A-Za-z0-9+/=]+$/.test(s) ? s : "";
}

export function dniValido(dni: string): boolean {
  return /^\d{8}$/.test(dni);
}

/** "17-09-1936" | "17/09/1936" → "1936-09-17". Otra cosa → "". */
function fechaISO(v: unknown): string {
  const m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(String(v ?? "").trim());
  if (!m) return "";
  return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

const txt = (v: unknown) => String(v ?? "").trim();

/** Traduce el mensaje de apidni a un código HTTP para el cliente. */
function clasificarError(mensaje: string): number {
  const m = mensaje.toLowerCase();
  if (m.includes("expirado")) return 401;
  if (m.includes("superó") || m.includes("límite") || m.includes("limite")) return 429;
  if (m.includes("longitud")) return 400;
  if (m.includes("error en la consulta")) return 404;
  return 502;
}

async function consultarApidni(dni: string): Promise<PersonaReniec> {
  const cfg = getConfig();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), cfg.timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${cfg.url}/${dni}`, {
      headers: { Authorization: `Bearer ${cfg.token}`, Accept: "application/json" },
      signal: ctrl.signal,
      cache: "no-store",
    });
  } catch (e: any) {
    throw new ErrorReniec(
      e?.name === "AbortError" ? "RENIEC no respondió a tiempo. Intenta de nuevo." : "No se pudo conectar con el servicio de DNI.",
      502
    );
  } finally {
    clearTimeout(t);
  }
  if (res.status === 401 || res.status === 403) {
    throw new ErrorReniec("El token de apidni no es válido o venció. Revisa APIDNI_TOKEN.", 401);
  }
  if (!res.ok) throw new ErrorReniec(`El servicio de DNI respondió ${res.status}.`, 502);

  const json = (await res.json().catch(() => ({}))) as { respuesta?: string; data?: Record<string, unknown>; codigo?: number };
  const codigo = Number(json.codigo ?? 0);
  const d = json.data ?? {};
  if (!(codigo > 0) || !txt(d.dni)) {
    const motivo = txt(json.respuesta) || "Error en la consulta";
    const status = clasificarError(motivo);
    throw new ErrorReniec(
      status === 404 ? "El DNI no figura en RENIEC. Verifica el número." : motivo,
      status
    );
  }
  return {
    dni: txt(d.dni),
    nombres: txt(d.nombres),
    apellidoPaterno: txt(d.apellido_paterno),
    apellidoMaterno: txt(d.apellido_materno),
    fechaNacimiento: fechaISO(d.fecha_nacimiento),
    genero: txt(d.genero),
    direccion: txt(d.direccion),
    ubigeo: txt(d.ubigeo),
    distrito: txt(d.distrito),
    provincia: txt(d.provincia),
    departamento: txt(d.departamento),
    ...(fotoLimpia(d.foto ?? d.foto_base64 ?? d.imagen ?? d.photo) ? { fotoBase64: fotoLimpia(d.foto ?? d.foto_base64 ?? d.imagen ?? d.photo) } : {}),
    fuente: "apidni",
    consultadoAt: new Date().toISOString(),
  };
}

/** Datos simulados, deterministas a partir del DNI (para probar sin token). */
function consultarMock(dni: string): PersonaReniec {
  const n = Number(dni);
  const nombres = ["MARIA ELENA", "JOSE LUIS", "ROSA", "CARLOS ALBERTO", "ANA", "JUAN"];
  const apellidos = ["QUISPE", "HUAMAN", "FLORES", "ROJAS", "MAMANI", "GARCIA", "TORRES", "RAMOS"];
  return {
    dni,
    nombres: nombres[n % nombres.length],
    apellidoPaterno: apellidos[n % apellidos.length],
    apellidoMaterno: apellidos[(n >> 3) % apellidos.length],
    fechaNacimiento: `${1950 + (n % 50)}-${String(1 + (n % 12)).padStart(2, "0")}-${String(1 + (n % 28)).padStart(2, "0")}`,
    genero: n % 2 ? "F" : "M",
    direccion: "AV. SIMULADA 123",
    ubigeo: "150101",
    distrito: "LIMA",
    provincia: "LIMA",
    departamento: "LIMA",
    fuente: "simulado",
    consultadoAt: new Date().toISOString(),
  };
}

/** ¿Hay token real configurado? (para avisar en pantalla que es simulado) */
export function reniecReal(): boolean {
  const cfg = getConfig();
  return Boolean(cfg.token) && !cfg.forceMock;
}

/**
 * Consulta un DNI. Primero mira la caché (no gasta consulta); si no está o
 * venció, va a apidni y guarda. Lanza ErrorReniec si el DNI no existe o el
 * servicio falla. `forzar` salta la caché.
 */
export async function consultarDni(dni: string, { forzar = false } = {}): Promise<PersonaReniec> {
  if (!dniValido(dni)) throw new ErrorReniec("El DNI debe tener 8 dígitos.", 400);
  if (!reniecReal()) return consultarMock(dni);
  const cfg = getConfig();
  if (!forzar) {
    const guardado = (await leerCache())[dni];
    if (guardado && Date.now() - Date.parse(guardado.consultadoAt) < cfg.cacheDias * 86_400_000) {
      return { ...guardado, fuente: "cache" };
    }
  }
  const persona = await consultarApidni(dni);
  await guardarEnCache(persona);
  return persona;
}
