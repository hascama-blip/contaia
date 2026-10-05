// Consulta de DNI en RENIEC a través del servidor de Radar (función pura de red).
import { CONSULTA_DNI } from "../config.js";

export const reniecActivo = () => Boolean(CONSULTA_DNI.url && CONSULTA_DNI.clave);

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
    res = await fetch(`${CONSULTA_DNI.url.replace(/\/$/, "")}/${numero}`, { headers: { "x-api-key": CONSULTA_DNI.clave } });
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
