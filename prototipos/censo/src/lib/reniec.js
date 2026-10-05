// Consulta de DNI en RENIEC a través del servidor de Radar (función pura de red).
import { CONSULTA_DNI } from "../config.js";

// En el servidor propio la configuración la inyecta el servidor (misma sesión, sin clave aparte).
const cfg = () => window.__CONSULTA_DNI__ || CONSULTA_DNI;
export const reniecActivo = () => Boolean(cfg().url && cfg().clave);

const MENSAJES = {
  401: "El servidor rechazó la clave de consulta. Revisa CONSULTA_DNI.clave y RENIEC_API_KEY.",
  404: "El DNI no figura en RENIEC. Verifica el número.",
  429: "Se agotaron las consultas por ahora. Intenta más tarde.",
};

/**
 * @param {string} dni  8 dígitos
 * @returns {Promise<{persona: object, simulado: boolean}>}
 */
export async function consultarDni(dni) {
  const numero = String(dni || "").replace(/\D/g, "");
  if (!/^\d{8}$/.test(numero)) throw { code: "dni", message: "Escribe los 8 dígitos del DNI antes de buscar." };
  if (!reniecActivo()) throw { code: "sin_reniec", message: "La consulta a RENIEC no está configurada." };
  let res;
  try {
    res = await fetch(`${cfg().url.replace(/\/$/, "")}/${numero}`, { headers: cfg().clave === "sesion" ? {} : { "x-api-key": cfg().clave } });
  } catch {
    throw { code: "red", message: `No se pudo conectar con el servidor de consultas (${location.origin} debe estar permitido en RENIEC_CORS_ORIGENES).` };
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.persona) throw { code: `http_${res.status}`, message: MENSAJES[res.status] || json.error || "No se pudo consultar el DNI." };
  return { persona: json.persona, simulado: Boolean(json.simulado) };
}

/** "QUISPE HUAMAN" → "Quispe Huaman" (RENIEC devuelve todo en mayúsculas). */
export function capitalizar(s) {
  return String(s || "").toLowerCase().replace(/(^|[\s\-])(\p{L})/gu, (m, sep, l) => sep + l.toUpperCase());
}

/** Foto del DNI (base64 JPG) → archivo listo para subir a la ficha. */
export function fotoComoArchivo(persona) {
  if (!persona?.fotoBase64) return null;
  const bin = atob(persona.fotoBase64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], `dni-${persona.dni}.jpg`, { type: "image/jpeg" });
}

/** Campos de la ficha que se llenan con lo que devuelve RENIEC. */
export function fichaDesdeReniec(p) {
  return {
    nombres: capitalizar(p.nombres),
    apellidoPaterno: capitalizar(p.apellidoPaterno),
    apellidoMaterno: capitalizar(p.apellidoMaterno),
    ...(p.fechaNacimiento ? { fechaNacimiento: p.fechaNacimiento } : {}),
    ...(p.direccion ? { direccion: p.direccion } : {}),
    ...(p.distrito ? { distritoResidencia: capitalizar(p.distrito) } : {}),
  };
}
