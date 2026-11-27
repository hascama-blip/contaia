// Stands propios de la Asociación: qué stands marcar (desde el Excel de revisión del libro o
// una lista de números) y qué pasará con cada uno antes de guardar. Lógica pura.
import { existeStand, nombreCompleto, etiquetaNumero, compararCodigos, inquilinoDeNota, mismoNombre, fichaPorNombre } from "./padron.js";

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

/**
 * Quien ocupa el stand ("APCCIC-NOMBRE" en el libro) queda como su inquilino, con ese mismo nombre.
 * Toma DNI y celular de su ficha si la tiene. No pisa a otro inquilino ya registrado.
 * @returns {{ inquilino: object|null, textoInq: string }}  inquilino = lo que hay que guardar (null si nada)
 */
function planInquilino(nota, stand, indice) {
  const nombre = inquilinoDeNota(nota);
  if (!nombre) return { inquilino: null, textoInq: nota ? "El libro lo anota como libre: queda sin inquilino." : "" };
  const actual = String(stand?.inquilino?.nombre || "").trim() ? stand.inquilino : null;
  const ficha = fichaPorNombre(nombre, indice);
  const deFicha = { dni: /^\d{8}$/.test(ficha?.dni || "") ? ficha.dni : "", celular: /^9\d{8}$/.test(ficha?.celular || "") ? ficha.celular : "" };
  if (!actual) return { inquilino: { nombre, ...deFicha }, textoInq: `Se registra como inquilino: ${nombre}${deFicha.dni ? ` (DNI ${deFicha.dni}, de su ficha)` : ""}.` };
  if (!mismoNombre(actual.nombre, nombre)) return { inquilino: null, textoInq: `Ya tiene otro inquilino (${actual.nombre}): no se cambia.` };
  const nuevo = { nombre, dni: actual.dni || deFicha.dni, celular: actual.celular || deFicha.celular };
  const cambia = nuevo.nombre !== actual.nombre || nuevo.dni !== (actual.dni || "") || nuevo.celular !== (actual.celular || "");
  return cambia ? { inquilino: nuevo, textoInq: `Se actualiza el inquilino: ${nombre}.` } : { inquilino: null, textoInq: `Ya figura como inquilino: ${nombre}.` };
}

/** Qué pasará con cada stand: crear | marcar | dueno (pasa al historial) | inquilino | nota (se anota cómo figura en el libro) | ya. */
export function planAsociacion(items, stands, porId, indice = null) {
  return items.map(({ codigo, nota }) => {
    const s = stands.find((x) => x.codigo === codigo);
    const inq = planInquilino(nota, s, indice);
    if (!s) return { codigo, nota, ...inq, accion: "crear", texto: "No estaba registrado: se crea como stand de la asociación." };
    if (s.deAsociacion && !s.propietarioId) {
      if (inq.inquilino) return { codigo, nota, ...inq, accion: "inquilino", texto: "Ya figura como stand de la asociación." };
      return nota && !s.asociacionNota
        ? { codigo, nota, ...inq, accion: "nota", texto: "Ya figura como stand de la asociación: se anota cómo figura en el libro." }
        : { codigo, nota, ...inq, accion: "ya", texto: "Ya figura como stand de la asociación." };
    }
    if (s.propietarioId) {
      const a = porId.get(s.propietarioId);
      return { codigo, nota, ...inq, accion: "dueno", dueno: a || null, texto: `Figura a nombre de ${a ? `${nombreCompleto(a)} (${etiquetaNumero(a)})` : "una ficha que ya no existe"}: pasa al historial del stand y su ficha queda «por revisar».` };
    }
    return { codigo, nota, ...inq, accion: "marcar", texto: "Estaba sin propietario: se marca como stand de la asociación." };
  });
}
