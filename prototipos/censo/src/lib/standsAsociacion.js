// Stands propios de la Asociación: qué stands marcar (desde el Excel de revisión del libro o
// una lista de números) y qué pasará con cada uno antes de guardar. Lógica pura.
import { existeStand, nombreCompleto, etiquetaNumero, compararCodigos } from "./padron.js";

export const MARCA_ASOCIACION = /STAND\s+DE\s+LA\s+ASOCIACI[OÓ]N/i;

/**
 * Filas del Excel → [{ codigo, nota }] de las que dicen "STAND DE LA ASOCIACION".
 * El código es la celda de 4 dígitos que existe en el plano; la nota, la otra celda con texto
 * (p. ej. "APCCIC-…", cómo figura en el libro).
 */
export function standsDesdeFilas(filas) {
  const vistos = new Map();
  for (const fila of filas) {
    if (!fila.some((c) => MARCA_ASOCIACION.test(c))) continue;
    const codigo = fila.find((c) => /^\d{4}$/.test(c) && existeStand(c));
    if (!codigo) continue;
    const nota = fila.find((c) => c && c !== codigo && !MARCA_ASOCIACION.test(c)) || "";
    if (!vistos.has(codigo)) vistos.set(codigo, { codigo, nota });
  }
  return [...vistos.values()].sort((a, b) => compararCodigos(a.codigo, b.codigo));
}

/** "1014, 1015 1019; 1020" → [{ codigo, nota: "" }] y los que no existen en el plano. */
export function standsDesdeTexto(texto) {
  const validos = [], invalidos = [];
  for (const parte of String(texto || "").split(/[\s,;]+/).filter(Boolean)) {
    if (/^\d{4}$/.test(parte) && existeStand(parte)) { if (!validos.some((x) => x.codigo === parte)) validos.push({ codigo: parte, nota: "" }); }
    else invalidos.push(parte);
  }
  return { items: validos.sort((a, b) => compararCodigos(a.codigo, b.codigo)), invalidos };
}

/** Qué pasará con cada stand: crear | marcar | dueno (pasa al historial) | ya. */
export function planAsociacion(items, stands, porId) {
  return items.map(({ codigo, nota }) => {
    const s = stands.find((x) => x.codigo === codigo);
    if (!s) return { codigo, nota, accion: "crear", texto: "No estaba registrado: se crea como stand de la asociación." };
    if (s.deAsociacion && !s.propietarioId) return { codigo, nota, accion: "ya", texto: "Ya figura como stand de la asociación." };
    if (s.propietarioId) {
      const a = porId.get(s.propietarioId);
      return { codigo, nota, accion: "dueno", dueno: a || null, texto: `Figura a nombre de ${a ? `${nombreCompleto(a)} (${etiquetaNumero(a)})` : "una ficha que ya no existe"}: pasa al historial del stand y su ficha queda «por revisar».` };
    }
    return { codigo, nota, accion: "marcar", texto: "Estaba sin propietario: se marca como stand de la asociación." };
  });
}
