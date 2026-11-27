// Completar la columna DNI de un Excel con los datos del padrón. Lógica pura: ubica en cada hoja
// la columna "DNI", toma el nombre de la columna de su izquierda y lo busca en el padrón
// (asociados, inquilinos, cónyuges e hijos). No adivina: si hay dos personas posibles, lo dice.
import { normalizar, nombreCompleto, etiquetaNumero } from "./padron.js";

const esDni = (v) => /^\d{8}$/.test(String(v || "").trim());
const CABECERA_DNI = /^\s*(n(ro|°|º|um(ero)?)?\.?\s*(de\s*)?)?dni\s*$/i;
const NO_ES_PERSONA = /^(total( general)?|asociaci[oó]n|\(en blanco\)|\(blank\)|\(vac[ií]o\)|-+)$/i;
const ORDEN_FUENTE = { asociado: 0, inquilino: 1, "cónyuge": 2, hijo: 3 };

/** ".APCCIC-APELLIDO APELLIDO NOMBRE" → "APELLIDO APELLIDO NOMBRE" (sin puntos iniciales ni el prefijo de la Asociación). */
export const limpiarNombre = (texto) => String(texto || "").replace(/^[\s.·*-]+/, "").replace(/^APCCIC\s*-?\s*/i, "").replace(/[\s.]+$/, "").trim();
const palabras = (s) => normalizar(s).replace(/[^a-z0-9ñ ]/g, " ").split(/\s+/).filter(Boolean);
/** Misma palabra aunque cambie la ortografía usual: Gonzales/González, Ysasi/Isasi, Vilchez/Bilches, Huamán/Guaman… */
const sonido = (p) => p.replace(/ñ/g, "n").replace(/h/g, "").replace(/z/g, "s").replace(/v/g, "b").replace(/y/g, "i").replace(/k|qu/g, "c").replace(/gu(?=[aeio])/g, "g").replace(/(.)\1+/g, "$1");
const clave = (ps) => [...ps].sort().join(" ");

/** Todas las personas del padrón que tienen nombre: [{ palabras, sonidos, dni, nombre, fuente, detalle }]. */
export function indicePersonas({ asociados = [], stands = [] }) {
  const lista = [];
  const agregar = (nombre, dni, fuente, detalle) => {
    const ps = palabras(limpiarNombre(nombre));
    if (ps.length < 2) return;
    lista.push({ palabras: ps, sonidos: ps.map(sonido), dni: esDni(dni) ? String(dni).trim() : "", nombre: String(nombre).replace(/\s+/g, " ").trim(), fuente, detalle });
  };
  for (const a of asociados) {
    agregar(`${a.nombres || ""} ${a.apellidoPaterno || ""} ${a.apellidoMaterno || ""}`, a.dni, "asociado", etiquetaNumero(a));
    if (a.conyuge?.nombre) agregar(a.conyuge.nombre, a.conyuge.dni, "cónyuge", `de ${nombreCompleto(a)}`);
    for (const h of a.hijos || []) if (h?.nombre) agregar(h.nombre, h.dni, "hijo", `de ${nombreCompleto(a)}`);
  }
  for (const s of stands) if (s.inquilino?.nombre) agregar(s.inquilino.nombre, s.inquilino.dni, "inquilino", `stand ${s.codigo}`);
  return lista;
}

const contiene = (grande, chico) => chico.every((p) => grande.includes(p));

/**
 * Busca el DNI de un nombre del Excel.
 * @returns {{ estado: "exacto"|"aproximado"|"varios"|"sin_dni"|"no"|"omitido", dni: string, persona?: object, candidatos?: object[] }}
 */
export function buscarDni(texto, indice) {
  const limpio = limpiarNombre(texto);
  if (!limpio || NO_ES_PERSONA.test(limpio) || NO_ES_PERSONA.test(String(texto).trim())) return { estado: "omitido", dni: "" };
  const ps = palabras(limpio);
  if (ps.length < 2) return { estado: "no", dni: "" };
  const ss = ps.map(sonido);
  const elegir = (candidatos, estado) => {
    if (!candidatos.length) return null;
    const conDni = candidatos.filter((c) => c.dni);
    if (!conDni.length) return { estado: "sin_dni", dni: "", persona: candidatos.sort((a, b) => ORDEN_FUENTE[a.fuente] - ORDEN_FUENTE[b.fuente])[0] };
    const dnis = [...new Set(conDni.map((c) => c.dni))];
    if (dnis.length > 1) return { estado: "varios", dni: "", candidatos: conDni };
    return { estado, dni: dnis[0], persona: conDni.sort((a, b) => ORDEN_FUENTE[a.fuente] - ORDEN_FUENTE[b.fuente])[0] };
  };
  const k = clave(ps), ks = clave(ss);
  return elegir(indice.filter((x) => clave(x.palabras) === k), "exacto")              // mismas palabras, en cualquier orden
    || elegir(indice.filter((x) => clave(x.sonidos) === ks), "aproximado")             // misma persona con otra ortografía
    || elegir(ss.length >= 2 ? indice.filter((x) => (contiene(x.sonidos, ss) || (x.sonidos.length >= 3 && contiene(ss, x.sonidos))) && Math.abs(x.sonidos.length - ss.length) <= 2) : [], "aproximado") // falta o sobra un nombre o apellido
    || { estado: "no", dni: "" };
}

const letra = (i) => { let s = ""; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };

/**
 * Qué celdas se llenan en cada hoja y qué pasó con cada nombre.
 * @param {{ nombre:string, ruta:string, filas:{ r:number, celdas:string[] }[] }[]} hojas
 * @returns {{ hojas: { nombre, ruta, columna:string, celdas: Map<string,{dni,estado}> }[], nombres: object[], resumen: object }}
 */
export function planCompletarDni(hojas, indice) {
  const porNombre = new Map(); // texto del Excel → resultado (una sola búsqueda por nombre distinto)
  const plan = [];
  for (const h of hojas) {
    const cab = h.filas.slice(0, 15).map((f) => ({ f, c: f.celdas.findIndex((x, i) => i > 0 && CABECERA_DNI.test(x)) })).find((x) => x.c > 0);
    if (!cab) continue;
    const celdas = new Map();
    for (const f of h.filas) {
      if (f.r <= cab.f.r) continue;
      const texto = String(f.celdas[cab.c - 1] || "").trim();
      if (!texto) continue;
      if (!porNombre.has(texto)) porNombre.set(texto, { texto, veces: 0, yaTenia: 0, ...buscarDni(texto, indice) });
      const r = porNombre.get(texto);
      r.veces++;
      if (String(f.celdas[cab.c] || "").trim()) { r.yaTenia++; continue; } // no se pisa lo que ya estaba escrito
      if (r.dni) celdas.set(`${letra(cab.c)}${f.r}`, { dni: r.dni, estado: r.estado });
    }
    plan.push({ nombre: h.nombre, ruta: h.ruta, columna: letra(cab.c), celdas });
  }
  const nombres = [...porNombre.values()].filter((n) => n.estado !== "omitido");
  const cuenta = (e) => nombres.filter((n) => n.estado === e).length;
  return { hojas: plan, nombres, resumen: { personas: nombres.length, exactos: cuenta("exacto"), aproximados: cuenta("aproximado"), varios: cuenta("varios"), sinDni: cuenta("sin_dni"), noFiguran: cuenta("no") } };
}
