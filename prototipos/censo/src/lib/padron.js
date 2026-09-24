// Reglas del padrón: nombres, stands por asociado, avance del censo y filtros.
// Funciones puras: reciben datos y devuelven resultados (no leen ni escriben la base).
import { GALERIAS } from "../config.js";
import { porcentaje } from "./formato.js";

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

export function galeriaDeCodigo(codigo) {
  return String(codigo || "").split("-")[0];
}

export function nombreGaleria(id) {
  return GALERIAS.find((x) => x.id === id)?.nombre || id || "—";
}

/** Orden de inventario: galería (A, B, C, S) y número de stand. */
export function compararCodigos(a, b) {
  const ga = GALERIAS.findIndex((g) => g.id === galeriaDeCodigo(a));
  const gb = GALERIAS.findIndex((g) => g.id === galeriaDeCodigo(b));
  if (ga !== gb) return ga - gb;
  return Number(String(a).split("-")[1]) - Number(String(b).split("-")[1]);
}

/** "a12, B-4; c07" → ["A-12", "B-04", "C-07"]. Devuelve también los inválidos. */
export function leerCodigos(texto) {
  const validos = [];
  const invalidos = [];
  for (const parte of String(texto || "").split(/[,;\s]+/).filter(Boolean)) {
    const m = /^([a-zA-Z])-?(\d{1,3})$/.exec(parte.trim());
    const gal = m && GALERIAS.find((g) => g.id === m[1].toUpperCase());
    if (m && gal) {
      const codigo = `${gal.id}-${m[2].padStart(2, "0")}`;
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

export function avanceCenso(asociados) {
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
