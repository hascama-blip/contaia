// Reglas del padrón: nombres, stands por asociado, avance del censo y filtros.
// Funciones puras: reciben datos y devuelven resultados (no leen ni escriben la base).
import { GALERIAS } from "../config.js";
import { porcentaje } from "./formato.js";
import { PLANO } from "../plano.js";

export function normalizar(s) {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

export function apellidos(a) {
  return `${a.apellidoPaterno || ""} ${a.apellidoMaterno || ""}`.trim();
}

/** "Mendoza Ríos, Julio César" */
export function nombreCompleto(a) {
  if (!a) return "—";
  return `${apellidos(a)}, ${a.nombres || ""}`.trim();
}

/** "Mendoza Ríos, J." */
export function nombreCorto(a) {
  if (!a) return "—";
  return `${apellidos(a)}, ${(a.nombres || "").charAt(0)}.`;
}

// Galería de cada stand según el plano real (código "1091" → "A").
const GALERIA_DE = new Map(PLANO.stands.map(([codigo, galeria]) => [codigo, galeria]));

export function galeriaDeCodigo(codigo) {
  return GALERIA_DE.get(String(codigo)) || "";
}

export function existeStand(codigo) {
  return GALERIA_DE.has(String(codigo));
}

export function nombreGaleria(id) {
  return GALERIAS.find((x) => x.id === id)?.nombre || id || "—";
}

/** Orden de inventario: por número de stand (1001, 1002…). */
export function compararCodigos(a, b) {
  return (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0) || String(a).localeCompare(String(b));
}

/** "1091, 1092; 1105" → ["1091", "1092", "1105"]. Solo números que existen en el plano. */
export function leerCodigos(texto) {
  const validos = [];
  const invalidos = [];
  for (const parte of String(texto || "").split(/[,;\s]+/).filter(Boolean)) {
    const codigo = parte.trim().replace(/^N?°?/i, "");
    if (/^\d{4}$/.test(codigo) && existeStand(codigo)) {
      if (!validos.includes(codigo)) validos.push(codigo);
    } else {
      invalidos.push(parte);
    }
  }
  return { validos: validos.sort(compararCodigos), invalidos };
}

/** Mapa asociadoId → stands (ordenados). La verdad está en la colección stands. */
export function standsPorAsociado(stands) {
  const mapa = new Map();
  for (const s of stands) {
    if (!s.propietarioId) continue;
    if (!mapa.has(s.propietarioId)) mapa.set(s.propietarioId, []);
    mapa.get(s.propietarioId).push(s);
  }
  for (const lista of mapa.values()) lista.sort((a, b) => compararCodigos(a.codigo, b.codigo));
  return mapa;
}

export function estadoCenso(a) {
  return a?.censo?.estado || "pendiente";
}

export function estaCensado(a) {
  const e = estadoCenso(a);
  return e === "actualizado" || e === "verificado";
}

/** Avance de fichas. Los que vendieron todo (estado "transferido") ya no cuentan: son historial. */
export function avanceCenso(todos) {
  const asociados = todos.filter((a) => a.estado !== "transferido");
  const r = { total: asociados.length, actualizados: 0, verificados: 0, pendientes: 0, sinUbicar: 0 };
  for (const a of asociados) {
    const e = estadoCenso(a);
    if (e === "actualizado") r.actualizados++;
    else if (e === "verificado") r.verificados++;
    else if (e === "sin_ubicar") r.sinUbicar++;
    else r.pendientes++;
  }
  r.censados = r.actualizados + r.verificados;
  r.pct = porcentaje(r.censados, r.total);
  return r;
}

/** Stands con ficha actualizada o verificada, por galería. */
export function avancePorGaleria(asociados, stands) {
  const porId = new Map(asociados.map((a) => [a.id, a]));
  return GALERIAS.map((g) => {
    const lista = stands.filter((s) => s.galeria === g.id);
    const censados = lista.filter((s) => estaCensado(porId.get(s.propietarioId))).length;
    return { ...g, total: lista.length, censados, pct: porcentaje(censados, lista.length) };
  });
}

/** Filtro del padrón por texto (N°, DNI, nombre o stand), galería y estado del censo. */
export function filtrarPadron(asociados, mapaStands, { texto = "", galeria = "", censo = "" }) {
  const q = normalizar(texto);
  return asociados.filter((a) => {
    const suyos = mapaStands.get(a.id) || [];
    if (galeria && !suyos.some((s) => s.galeria === galeria)) return false;
    if (censo && estadoCenso(a) !== censo) return false;
    if (!q) return true;
    const pajar = normalizar([a.numero, a.dni, a.nombres, a.apellidoPaterno, a.apellidoMaterno, ...suyos.map((s) => s.codigo)].join(" "));
    return q.split(/\s+/).every((p) => pajar.includes(p));
  });
}

export function ordenarPorNumero(asociados) {
  return [...asociados].sort((a, b) => String(a.numero).localeCompare(String(b.numero), "es", { numeric: true }));
}
