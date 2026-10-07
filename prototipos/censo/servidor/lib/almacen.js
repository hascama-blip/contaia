// Almacén de documentos en JSON (un archivo por colección) con escritura
// atómica y avisos de cambio. Mismo modelo que la base del artifact:
// colección → documento (id, data). `update` fusiona objetos anidados y
// reemplaza arreglos, igual que allá.
import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";

export const COLECCIONES = ["asociados", "stands", "pagos", "incidencias", "tiendas", "articulos", "sitio"];

const esObj = (v) => v && typeof v === "object" && !Array.isArray(v);
export function fusionar(a, b) {
  const o = { ...a };
  for (const [k, v] of Object.entries(b)) o[k] = esObj(v) && esObj(a?.[k]) ? fusionar(a[k], v) : v;
  return o;
}

export class Almacen extends EventEmitter {
  constructor(dir) {
    super();
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
    this.datos = new Map(); // col → Map(id → data)
    this.pendientes = new Set();
    for (const col of COLECCIONES) this.datos.set(col, this.#leer(col));
  }

  #ruta(col) { return path.join(this.dir, `${col}.json`); }

  #leer(col) {
    try {
      const obj = JSON.parse(fs.readFileSync(this.#ruta(col), "utf8"));
      return new Map(Object.entries(obj));
    } catch { return new Map(); }
  }

  /** Escribe la colección a disco de forma atómica (archivo temporal + rename). */
  #guardar(col) {
    const tmp = this.#ruta(col) + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.datos.get(col))));
    fs.renameSync(tmp, this.#ruta(col));
  }

  #programar(col, id = null, data = null) {
    this.pendientes.add(col);
    clearTimeout(this.t);
    this.t = setTimeout(() => {
      for (const c of this.pendientes) this.#guardar(c);
      this.pendientes.clear();
    }, 150);
    this.emit("cambio", col, id, data); // id null = cambió toda la colección (importación)
  }

  coleccion(col) {
    if (!this.datos.has(col)) throw { status: 404, message: `No existe la colección ${col}.` };
    return this.datos.get(col);
  }

  listar(col) {
    return [...this.coleccion(col)].map(([id, data]) => ({ id, data }));
  }

  obtener(col, id) {
    const d = this.coleccion(col).get(id);
    return d === undefined ? null : { id, data: d };
  }

  establecer(col, id, data) {
    const limpio = JSON.parse(JSON.stringify(data));
    this.coleccion(col).set(id, limpio);
    this.#programar(col, id, limpio);
  }

  actualizar(col, id, parcial) {
    const c = this.coleccion(col);
    if (!c.has(id)) throw { status: 404, message: "El registro ya no existe.", code: "not_found" };
    c.set(id, fusionar(c.get(id), JSON.parse(JSON.stringify(parcial))));
    this.#programar(col, id, c.get(id));
  }

  borrar(col, id) {
    if (this.coleccion(col).delete(id)) this.#programar(col, id, null);
  }

  /** Importación: muchos registros de golpe y un solo aviso por colección. */
  establecerVarios(col, pares) {
    const c = this.coleccion(col);
    for (const [id, data] of pares) c.set(id, JSON.parse(JSON.stringify(data)));
    if (pares.length) this.#programar(col);
  }

  /** Fuerza la escritura pendiente (al apagar). */
  vaciar() {
    clearTimeout(this.t);
    for (const c of this.pendientes) this.#guardar(c);
    this.pendientes.clear();
  }
}

/** Id corto y único (como el del artifact). */
export function nuevoId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}
