// Importación "completar": rellena solo lo que falta en las fichas existentes (y crea las nuevas),
// sin pisar datos ya cargados, lo verificado por RENIEC ni las fotos/archivos.
const vacio = (v) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0)
  || (typeof v === "object" && !Array.isArray(v) && Object.values(v).every(vacio));
const normal = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();

/** Nunca se tocan al completar (los maneja el portal o la directiva). */
const PROTEGIDOS = new Set(["id", "archivos", "reniec", "censo", "creadoAt", "actualizadoAt", "actualizadoPor", "revisadoPor", "origen", "documentos", "compromiso", "estado", "revisar"]);
/** Si la ficha fue verificada en RENIEC, estos campos no se tocan aunque estén vacíos. */
const CAMPOS_RENIEC = new Set(["nombres", "apellidoPaterno", "apellidoMaterno", "fechaNacimiento", "direccion", "distritoResidencia", "estadoCivil"]);

function completarLista(actual, nuevos) {
  const lista = Array.isArray(actual) ? actual.map((x) => ({ ...x })) : [];
  let agregados = 0, completados = 0;
  for (const n of nuevos || []) {
    if (!n || vacio(n.nombre)) continue;
    const e = lista.find((x) => normal(x.nombre) === normal(n.nombre));
    if (!e) { lista.push({ ...n }); agregados++; continue; }
    for (const k of Object.keys(n)) if (vacio(e[k]) && !vacio(n[k])) { e[k] = n[k]; completados++; }
  }
  return { lista, agregados, completados, cambio: agregados + completados > 0 };
}

/**
 * Calcula los cambios para completar `existente` con `nuevo`.
 * @returns {{ cambios: object|null, campos: number, hijos: number, familiares: number, protegidos: number }}
 */
export function completarAsociado(existente, nuevo) {
  const cambios = {}; let campos = 0, hijos = 0, familiares = 0, protegidos = 0;
  const verificado = Boolean(existente?.reniec?.verificadoAt);
  for (const [k, v] of Object.entries(nuevo || {})) {
    if (PROTEGIDOS.has(k) || vacio(v)) continue;
    if (verificado && CAMPOS_RENIEC.has(k)) { protegidos++; continue; }
    const actual = existente?.[k];
    if (k === "hijos" || k === "familiares") {
      const r = completarLista(actual, v);
      if (r.cambio) { cambios[k] = r.lista; if (k === "hijos") hijos += r.agregados + r.completados; else familiares += r.agregados + r.completados; }
      continue;
    }
    if (k === "observaciones") {
      const a = String(actual || "").trim(), n = String(v).trim();
      if (!a) { cambios[k] = n; campos++; }
      else if (!normal(a).includes(normal(n))) { cambios[k] = `${a}\n${n}`; campos++; }
      continue;
    }
    if (typeof v === "object" && !Array.isArray(v)) {           // nacimiento, conyuge
      if (vacio(actual)) { cambios[k] = v; campos++; continue; }
      const sub = {};
      for (const [sk, sv] of Object.entries(v)) if (!vacio(sv) && vacio(actual?.[sk])) sub[sk] = sv;
      if (Object.keys(sub).length) { cambios[k] = sub; campos += Object.keys(sub).length; }
      continue;
    }
    if (vacio(actual)) { cambios[k] = v; campos++; }
  }
  return { cambios: Object.keys(cambios).length ? cambios : null, campos, hijos, familiares, protegidos };
}

/** Stands: solo campos vacíos; nunca el propietario, el estado ni el historial. */
export function completarStand(existente, nuevo) {
  const cambios = {};
  for (const [k, v] of Object.entries(nuevo || {})) {
    if (["propietarioId", "estado", "historial", "codigo"].includes(k) || vacio(v)) continue;
    if (vacio(existente?.[k])) cambios[k] = v;
  }
  return Object.keys(cambios).length ? cambios : null;
}

/**
 * Aplica una semilla/respaldo en modo completar sobre el almacén.
 * @param {import("./almacen.js").Almacen} almacen
 * @param {{ asociados: {id,data}[], stands: {id,data}[], pagos?: {id,data}[], incidencias?: {id,data}[] }} entrada
 */
export function completarTodo(almacen, entrada) {
  const r = { asociadosActualizados: 0, asociadosNuevos: 0, campos: 0, hijos: 0, familiares: 0, protegidos: 0, standsNuevos: 0, standsActualizados: 0, pagosNuevos: 0, incidenciasNuevas: 0 };
  const existentes = almacen.listar("asociados");
  const porDni = new Map(existentes.filter((d) => /^\d{8}$/.test(String(d.data.dni || ""))).map((d) => [String(d.data.dni), d.id]));
  const ids = new Set(existentes.map((d) => d.id));
  const mapa = new Map(); // id del archivo → id en el servidor
  for (const { id, data } of entrada.asociados || []) {
    const dni = String(data?.dni || "");
    let destino = porDni.get(dni) || (ids.has(id) ? id : null);
    if (!destino) {
      destino = ids.has(id) ? `${id}-${Math.random().toString(36).slice(2, 6)}` : id;
      almacen.establecer("asociados", destino, { ...data, creadoAt: data.creadoAt || new Date().toISOString(), actualizadoAt: new Date().toISOString() });
      ids.add(destino); if (/^\d{8}$/.test(dni)) porDni.set(dni, destino);
      r.asociadosNuevos++; mapa.set(id, destino); continue;
    }
    mapa.set(id, destino);
    const act = almacen.obtener("asociados", destino)?.data;
    const c = completarAsociado(act, data);
    r.campos += c.campos; r.hijos += c.hijos; r.familiares += c.familiares; r.protegidos += c.protegidos;
    if (c.cambios) { almacen.actualizar("asociados", destino, { ...c.cambios, actualizadoAt: new Date().toISOString() }); r.asociadosActualizados++; }
  }
  for (const { id, data } of entrada.stands || []) {
    const act = almacen.obtener("stands", id)?.data;
    if (!act) {
      const prop = data.propietarioId ? (mapa.get(data.propietarioId) || data.propietarioId) : null;
      almacen.establecer("stands", id, { ...data, propietarioId: prop }); r.standsNuevos++; continue;
    }
    const c = completarStand(act, data);
    if (c) { almacen.actualizar("stands", id, c); r.standsActualizados++; }
  }
  for (const col of ["pagos", "incidencias"]) for (const { id, data } of entrada[col] || []) {
    if (!almacen.obtener(col, id)) { almacen.establecer(col, id, data); r[col === "pagos" ? "pagosNuevos" : "incidenciasNuevas"]++; }
  }
  return r;
}
