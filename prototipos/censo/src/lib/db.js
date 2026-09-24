// Capa de datos — ÚNICA puerta a la base (como src/lib/db.ts en Radar).
// Ninguna pantalla ni servicio llama a claude.use("db") por su cuenta: todo pasa
// por aquí. Si mañana la base cambia (Postgres, Supabase, la API de Radar),
// solo se reescribe este archivo.

export const COLECCIONES = ["asociados", "stands", "pagos", "incidencias"];

let conexion = null;

/** Conecta con la base del artifact. Resuelve null si esta vista no la tiene. */
export function conectar() {
  if (!conexion) {
    conexion = window.claude?.use ? window.claude.use("db") : Promise.resolve(null);
  }
  return conexion;
}

async function base() {
  const db = await conectar();
  if (!db) throw { code: "sin_base", message: "No hay conexión con la base de datos." };
  return db;
}

// Reintenta una vez ante un corte momentáneo de la plataforma.
async function conReintento(fn) {
  try {
    return await fn();
  } catch (e) {
    if (e?.code !== "unavailable") throw e;
    await new Promise((r) => setTimeout(r, 400 + Math.random() * 600));
    return fn();
  }
}

/**
 * Escucha todas las colecciones en vivo (se suscribe UNA sola vez).
 * onDatos recibe { asociados, stands, pagos, incidencias, cargado }.
 * Devuelve la función para dejar de escuchar, o null si no hay base.
 */
export async function escucharTodo(onDatos, onError) {
  const db = await conectar();
  if (!db) return null;
  const estado = { asociados: [], stands: [], pagos: [], incidencias: [] };
  const recibido = new Set();
  const subs = COLECCIONES.map((col) =>
    db.collection(col).onSnapshot(
      (snap) => {
        estado[col] = snap.docs.filter((d) => d.exists).map((d) => ({ id: d.id, ...d.data() }));
        recibido.add(col);
        onDatos({ ...estado, cargado: recibido.size === COLECCIONES.length });
      },
      (e) => onError?.(e),
    ),
  );
  return () => subs.forEach((u) => u());
}

/** Id nuevo para un documento de la colección. */
export async function nuevoId(col) {
  const db = await base();
  return db.collection(col).doc().id;
}

// ---- Asociados ----
export async function guardarAsociado(id, datos) {
  const db = await base();
  return conReintento(() => db.doc(`asociados/${id}`).set(datos));
}
export async function actualizarAsociado(id, parcial) {
  const db = await base();
  return conReintento(() => db.doc(`asociados/${id}`).update(parcial));
}

// ---- Stands ----
export async function leerStand(codigo) {
  const db = await base();
  const snap = await conReintento(() => db.doc(`stands/${codigo}`).get());
  return snap.exists ? { id: snap.id, ...snap.data() } : null;
}
export async function guardarStand(codigo, datos) {
  const db = await base();
  return conReintento(() => db.doc(`stands/${codigo}`).set(datos));
}
export async function actualizarStand(codigo, parcial) {
  const db = await base();
  return conReintento(() => db.doc(`stands/${codigo}`).update(parcial));
}

// ---- Pagos (un documento por stand y año) ----
export function idPagos(stand, anio) {
  return `${stand}_${anio}`;
}
export async function escribirRegistroPago(stand, anio, clave, registro) {
  const db = await base();
  const ref = db.doc(`pagos/${idPagos(stand, anio)}`);
  const snap = await conReintento(() => ref.get());
  if (snap.exists) {
    // update fusiona objetos anidados: solo toca registros[clave].
    return conReintento(() => ref.update({ registros: { [clave]: registro } }));
  }
  return conReintento(() => ref.set({ stand, anio, registros: { [clave]: registro } }));
}

// ---- Incidencias ----
export async function guardarIncidencia(id, datos) {
  const db = await base();
  return conReintento(() => db.doc(`incidencias/${id}`).set(datos));
}
export async function actualizarIncidencia(id, parcial) {
  const db = await base();
  return conReintento(() => db.doc(`incidencias/${id}`).update(parcial));
}

// ---- Mantenimiento ----
export async function borrarDocumento(col, id) {
  const db = await base();
  return conReintento(() => db.doc(`${col}/${id}`).delete());
}
