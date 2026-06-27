import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import type {
  Cliente,
  Documento,
  Diagnostico,
  SunatInfo,
  SireResumen,
  BuzonResumen,
  DeclaracionMensual,
  DeclaracionAnual,
  Deuda,
  CredencialesSire,
  ProveedorCuenta,
  Usuario,
  DeudaF36Tabla,
  SeguimientoBuzon,
  AccionAuditoria,
} from "./types";

// Almacenamiento simple basado en un único archivo JSON.
// Suficiente para un MVP de un solo proceso; sustituible por una BD real
// (Postgres/SQLite) implementando la misma interfaz.

// Directorio de datos. En producción se monta un DISCO PERSISTENTE de Render
// y se apunta aquí con la variable DATA_DIR (p. ej. /var/data) para que los
// clientes NO se borren en cada despliegue. En local cae a ./data.
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(process.cwd(), "data");
const STORE_PATH = path.join(DATA_DIR, "store.json");
export const UPLOADS_DIR = path.join(DATA_DIR, "uploads");

interface Store {
  clientes: Cliente[];
  /** Usuarios que inician sesión (cada uno ve solo sus empresas). */
  users?: Usuario[];
  /** Memoria del estudio: RUC del proveedor → cuenta contable. */
  cuentasProveedor?: Record<string, ProveedorCuenta>;
  /** Caché de rubro por RUC (para consultar decolecta 1 sola vez por RUC). */
  rubrosProveedor?: Record<string, { razonSocial: string; actividad: string; at: string }>;
  /** Bitácora de auditoría: acciones de todos los usuarios (la ve el líder). */
  acciones?: AccionAuditoria[];
}

async function ensureDirs() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
}

async function readStore(): Promise<Store> {
  await ensureDirs();
  try {
    const raw = await fs.readFile(STORE_PATH, "utf-8");
    const store = JSON.parse(raw) as Store;
    if (!store.cuentasProveedor) store.cuentasProveedor = {};
    if (!store.rubrosProveedor) store.rubrosProveedor = {};
    if (!Array.isArray(store.users)) store.users = [];
    if (!Array.isArray(store.acciones)) store.acciones = [];
    // Compatibilidad: clientes creados antes de SIRE/buzón no tienen el campo.
    for (const c of store.clientes) {
      if (!Array.isArray(c.sire)) c.sire = [];
      if (c.buzon === undefined) c.buzon = null;
      if (!Array.isArray(c.declaraciones)) c.declaraciones = [];
      if (!Array.isArray(c.declaracionesAnuales)) c.declaracionesAnuales = [];
      if (!Array.isArray(c.deudas)) c.deudas = [];
      if (c.credSire === undefined) c.credSire = null;
    }
    return store;
  } catch {
    return { clientes: [], users: [], cuentasProveedor: {}, rubrosProveedor: {}, acciones: [] };
  }
}

// ---- Usuarios --------------------------------------------------------------

/** Actualiza campos de un usuario por id (parche superficial). */
export async function updateUserById(
  id: string,
  patch: Partial<Pick<Usuario, "passHash" | "rol" | "estado" | "nombre" | "parentId" | "decididoAt">>
): Promise<Usuario | null> {
  const store = await readStore();
  const u = (store.users ?? []).find((x) => x.id === id);
  if (!u) return null;
  Object.assign(u, patch);
  await writeStore(store);
  return u;
}

export async function getUserById(id: string): Promise<Usuario | null> {
  const store = await readStore();
  return store.users?.find((u) => u.id === id) ?? null;
}

export async function getUserByEmail(email: string): Promise<Usuario | null> {
  const store = await readStore();
  const e = email.trim().toLowerCase();
  return store.users?.find((u) => u.email.toLowerCase() === e) ?? null;
}

export async function createUser(data: {
  nombre: string;
  email: string;
  passHash: string;
  rol?: "supremo" | "admin" | "operador";
  parentId?: string;
  estado?: "pendiente" | "aprobado" | "rechazado";
}): Promise<Usuario> {
  const store = await readStore();
  if (!store.users) store.users = [];
  const user: Usuario = {
    id: newId(),
    nombre: data.nombre.trim(),
    email: data.email.trim().toLowerCase(),
    passHash: data.passHash,
    createdAt: new Date().toISOString(),
    rol: data.rol ?? (data.parentId ? "operador" : "admin"),
    parentId: data.parentId,
    estado: data.estado,
  };
  store.users.push(user);
  await writeStore(store);
  return user;
}

// ---- Solicitudes de acceso (las gestiona el usuario supremo) ---------------

/** Estudios (admins) por estado de acceso. Excluye operadores y al supremo. */
export async function listSolicitudes(
  estado?: "pendiente" | "aprobado" | "rechazado"
): Promise<Usuario[]> {
  const store = await readStore();
  return (store.users ?? [])
    .filter((u) => !u.parentId && u.rol !== "supremo")
    .filter((u) => (estado ? (u.estado ?? "aprobado") === estado : true))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Borra TODOS los usuarios (cuentas). Devuelve cuántos eliminó. Luego se debe
 *  recrear el supremo con ensureSupremo(). Acción destructiva del supremo. */
export async function eliminarTodosLosUsuarios(): Promise<number> {
  const store = await readStore();
  const n = (store.users ?? []).length;
  store.users = [];
  await writeStore(store);
  return n;
}

/** El supremo aprueba o rechaza el acceso de un estudio. */
export async function setEstadoUsuario(
  userId: string,
  estado: "pendiente" | "aprobado" | "rechazado"
): Promise<Usuario | null> {
  const store = await readStore();
  const u = (store.users ?? []).find((x) => x.id === userId && !x.parentId && x.rol !== "supremo");
  if (!u) return null;
  u.estado = estado;
  u.decididoAt = new Date().toISOString();
  await writeStore(store);
  return u;
}

/** Sub-usuarios (operadores) de un admin/estudio. */
export async function listSubUsuarios(adminId: string): Promise<Usuario[]> {
  const store = await readStore();
  return (store.users ?? [])
    .filter((u) => u.parentId === adminId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Elimina un sub-usuario, solo si pertenece a ese admin. */
export async function deleteSubUsuario(adminId: string, userId: string): Promise<boolean> {
  const store = await readStore();
  const i = (store.users ?? []).findIndex((u) => u.id === userId && u.parentId === adminId);
  if (i < 0) return false;
  store.users!.splice(i, 1);
  await writeStore(store);
  return true;
}

// ---- Bitácora de auditoría -------------------------------------------------

const MAX_ACCIONES = 5000; // tope para no inflar el store.json indefinidamente.

/** Registra una acción en la bitácora (la ve el líder del estudio). */
export async function registrarAccion(
  data: Omit<AccionAuditoria, "id" | "at">
): Promise<void> {
  const store = await readStore();
  if (!Array.isArray(store.acciones)) store.acciones = [];
  store.acciones.push({ id: newId(), at: new Date().toISOString(), ...data });
  // Conserva solo las más recientes (poda las más viejas si excede el tope).
  if (store.acciones.length > MAX_ACCIONES) {
    store.acciones = store.acciones.slice(store.acciones.length - MAX_ACCIONES);
  }
  await writeStore(store);
}

/** Lista las acciones de un estudio (más recientes primero), con filtros. */
export async function listarAcciones(
  studioId: string,
  opts?: { limite?: number; usuarioId?: string; area?: string; clienteId?: string }
): Promise<AccionAuditoria[]> {
  const store = await readStore();
  let arr = (store.acciones ?? []).filter((a) => a.studioId === studioId);
  if (opts?.usuarioId) arr = arr.filter((a) => a.usuarioId === opts.usuarioId);
  if (opts?.area) arr = arr.filter((a) => a.area === opts.area);
  if (opts?.clienteId) arr = arr.filter((a) => a.clienteId === opts.clienteId);
  arr = arr.sort((a, b) => b.at.localeCompare(a.at));
  return typeof opts?.limite === "number" ? arr.slice(0, opts.limite) : arr;
}

/** Caché de rubro por RUC: decolecta se consulta 1 sola vez por RUC. */
export async function getRubros(): Promise<
  Record<string, { razonSocial: string; actividad: string; at: string }>
> {
  const store = await readStore();
  return store.rubrosProveedor ?? {};
}

export async function mergeRubros(
  entradas: Record<string, { razonSocial: string; actividad: string }>
): Promise<void> {
  const keys = Object.keys(entradas);
  if (keys.length === 0) return;
  const store = await readStore();
  if (!store.rubrosProveedor) store.rubrosProveedor = {};
  for (const ruc of keys) {
    store.rubrosProveedor[ruc] = { ...entradas[ruc], at: new Date().toISOString() };
  }
  await writeStore(store);
}

export async function getCuentasProveedor(): Promise<Record<string, ProveedorCuenta>> {
  const store = await readStore();
  return store.cuentasProveedor ?? {};
}

/** Aprende/actualiza cuentas por proveedor (merge en la memoria del estudio). */
export async function setCuentasProveedor(
  nuevas: ProveedorCuenta[]
): Promise<Record<string, ProveedorCuenta>> {
  const store = await readStore();
  if (!store.cuentasProveedor) store.cuentasProveedor = {};
  for (const p of nuevas) {
    if (!/^\d{11}$/.test(p.ruc)) continue;
    store.cuentasProveedor[p.ruc] = { ...p, fuente: "aprendido", actualizadoAt: new Date().toISOString() };
  }
  await writeStore(store);
  return store.cuentasProveedor;
}

async function writeStore(store: Store): Promise<void> {
  await ensureDirs();
  await fs.writeFile(STORE_PATH, JSON.stringify(store, null, 2), "utf-8");
}

export function newId(): string {
  return crypto.randomUUID();
}

/** Lista las empresas del usuario (o todas si no se pasa ownerId). */
export async function listClientes(ownerId?: string): Promise<Cliente[]> {
  const store = await readStore();
  const lista = ownerId
    ? store.clientes.filter((c) => c.ownerId === ownerId)
    : store.clientes;
  return lista.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getCliente(id: string): Promise<Cliente | null> {
  const store = await readStore();
  return store.clientes.find((c) => c.id === id) ?? null;
}

/** Empresa por id PERO solo si pertenece al usuario (aislamiento por usuario). */
export async function getClienteDeUsuario(
  id: string,
  ownerId: string
): Promise<Cliente | null> {
  const c = await getCliente(id);
  return c && c.ownerId === ownerId ? c : null;
}

/** Busca un cliente por RUC dentro del espacio del usuario (evitar duplicados). */
export async function getClienteByRuc(
  ruc: string,
  ownerId?: string
): Promise<Cliente | null> {
  const store = await readStore();
  const r = ruc.trim();
  return (
    store.clientes.find(
      (c) => c.ruc === r && (ownerId ? c.ownerId === ownerId : true)
    ) ?? null
  );
}

/** Guarda las credenciales SIRE del cliente (sin la Clave SOL). */
export async function setCredSire(
  clienteId: string,
  cred: CredencialesSire
): Promise<Cliente | null> {
  const store = await readStore();
  const cliente = store.clientes.find((c) => c.id === clienteId);
  if (!cliente) return null;
  cliente.credSire = cred;
  await writeStore(store);
  return cliente;
}

export async function createCliente(data: {
  razonSocial: string;
  ruc: string;
  email: string;
  telefono: string;
  sunat?: SunatInfo | null;
  ownerId?: string;
}): Promise<Cliente> {
  const store = await readStore();
  const cliente: Cliente = {
    id: newId(),
    ownerId: data.ownerId,
    razonSocial: data.razonSocial.trim(),
    ruc: data.ruc.trim(),
    email: data.email.trim(),
    telefono: data.telefono.trim(),
    createdAt: new Date().toISOString(),
    sunat: data.sunat ?? null,
    documentos: [],
    diagnostico: null,
    sire: [],
    buzon: null,
    declaraciones: [],
    declaracionesAnuales: [],
    deudas: [],
    credSire: null,
  };
  store.clientes.push(cliente);
  await writeStore(store);
  return cliente;
}

export async function updateCliente(
  id: string,
  patch: Partial<Pick<Cliente, "razonSocial" | "ruc" | "email" | "telefono">>
): Promise<Cliente | null> {
  const store = await readStore();
  const cliente = store.clientes.find((c) => c.id === id);
  if (!cliente) return null;
  Object.assign(cliente, patch);
  await writeStore(store);
  return cliente;
}

export async function deleteCliente(id: string): Promise<boolean> {
  const store = await readStore();
  const before = store.clientes.length;
  store.clientes = store.clientes.filter((c) => c.id !== id);
  if (store.clientes.length === before) return false;
  await writeStore(store);
  return true;
}

export async function setSunatInfo(
  clienteId: string,
  sunat: SunatInfo
): Promise<Cliente | null> {
  const store = await readStore();
  const cliente = store.clientes.find((c) => c.id === clienteId);
  if (!cliente) return null;
  cliente.sunat = sunat;
  await writeStore(store);
  return cliente;
}

export async function addDocumento(
  clienteId: string,
  doc: Documento
): Promise<Cliente | null> {
  const store = await readStore();
  const cliente = store.clientes.find((c) => c.id === clienteId);
  if (!cliente) return null;
  cliente.documentos.push(doc);
  await writeStore(store);
  return cliente;
}

export async function updateDocumento(
  clienteId: string,
  docId: string,
  patch: Partial<Documento>
): Promise<Documento | null> {
  const store = await readStore();
  const cliente = store.clientes.find((c) => c.id === clienteId);
  if (!cliente) return null;
  const doc = cliente.documentos.find((d) => d.id === docId);
  if (!doc) return null;
  Object.assign(doc, patch);
  await writeStore(store);
  return doc;
}

export async function setSireResumen(
  clienteId: string,
  resumen: SireResumen
): Promise<Cliente | null> {
  const store = await readStore();
  const cliente = store.clientes.find((c) => c.id === clienteId);
  if (!cliente) return null;
  if (!Array.isArray(cliente.sire)) cliente.sire = [];
  // Reemplaza el resumen del mismo periodo si ya existía.
  cliente.sire = cliente.sire.filter((s) => s.periodo !== resumen.periodo);
  cliente.sire.push(resumen);
  cliente.sire.sort((a, b) => b.periodo.localeCompare(a.periodo));
  await writeStore(store);
  return cliente;
}

export async function addDeclaracion(
  clienteId: string,
  decl: DeclaracionMensual
): Promise<Cliente | null> {
  const store = await readStore();
  const cliente = store.clientes.find((c) => c.id === clienteId);
  if (!cliente) return null;
  if (!Array.isArray(cliente.declaraciones)) cliente.declaraciones = [];
  // Reemplaza la declaración del mismo periodo si ya existía.
  cliente.declaraciones = cliente.declaraciones.filter((d) => d.periodo !== decl.periodo);
  cliente.declaraciones.push(decl);
  cliente.declaraciones.sort((a, b) => b.periodo.localeCompare(a.periodo));
  await writeStore(store);
  return cliente;
}

export async function deleteDeclaracion(
  clienteId: string,
  declId: string
): Promise<Cliente | null> {
  const store = await readStore();
  const cliente = store.clientes.find((c) => c.id === clienteId);
  if (!cliente) return null;
  cliente.declaraciones = (cliente.declaraciones ?? []).filter((d) => d.id !== declId);
  await writeStore(store);
  return cliente;
}

export async function addDeclaracionAnual(
  clienteId: string,
  decl: DeclaracionAnual
): Promise<Cliente | null> {
  const store = await readStore();
  const cliente = store.clientes.find((c) => c.id === clienteId);
  if (!cliente) return null;
  if (!Array.isArray(cliente.declaracionesAnuales)) cliente.declaracionesAnuales = [];
  // Reemplaza la del mismo ejercicio si ya existía.
  cliente.declaracionesAnuales = cliente.declaracionesAnuales.filter(
    (d) => d.ejercicio !== decl.ejercicio
  );
  cliente.declaracionesAnuales.push(decl);
  cliente.declaracionesAnuales.sort((a, b) => a.ejercicio.localeCompare(b.ejercicio));
  await writeStore(store);
  return cliente;
}

export async function deleteDeclaracionAnual(
  clienteId: string,
  declId: string
): Promise<Cliente | null> {
  const store = await readStore();
  const cliente = store.clientes.find((c) => c.id === clienteId);
  if (!cliente) return null;
  cliente.declaracionesAnuales = (cliente.declaracionesAnuales ?? []).filter(
    (d) => d.id !== declId
  );
  await writeStore(store);
  return cliente;
}

export async function addDeuda(clienteId: string, deuda: Deuda): Promise<Cliente | null> {
  const store = await readStore();
  const cliente = store.clientes.find((c) => c.id === clienteId);
  if (!cliente) return null;
  if (!Array.isArray(cliente.deudas)) cliente.deudas = [];
  cliente.deudas.unshift(deuda);
  await writeStore(store);
  return cliente;
}

export async function deleteDeuda(clienteId: string, deudaId: string): Promise<Cliente | null> {
  const store = await readStore();
  const cliente = store.clientes.find((c) => c.id === clienteId);
  if (!cliente) return null;
  cliente.deudas = (cliente.deudas ?? []).filter((d) => d.id !== deudaId);
  await writeStore(store);
  return cliente;
}

// ---- Caché de PDFs del buzón ----------------------------------------------

/** Guarda el PDF de un mensaje en uploads y registra su metadato en el cliente. */
export async function setBuzonAdjunto(
  clienteId: string,
  codMensaje: string,
  pdf: Buffer,
  nombre: string,
  usuario?: { id: string; nombre: string }
): Promise<void> {
  await ensureDirs();
  const archivo = `buzon_${clienteId}_${codMensaje}.pdf`;
  await fs.writeFile(path.join(UPLOADS_DIR, archivo), pdf);
  const store = await readStore();
  const cliente = store.clientes.find((c) => c.id === clienteId);
  if (!cliente) return;
  if (!cliente.buzonAdjuntos) cliente.buzonAdjuntos = {};
  const ahora = new Date().toISOString();
  cliente.buzonAdjuntos[codMensaje] = {
    archivo,
    nombre: nombre || `mensaje-${codMensaje}.pdf`,
    at: ahora,
    size: pdf.length,
    descargadaAt: ahora,
    descargadoPorId: usuario?.id,
    descargadoPorNombre: usuario?.nombre,
  };
  await writeStore(store);
}

/** Registra una descarga (incluida la servida desde caché): actualiza la fecha
 *  y quién la hizo. Devuelve la metadata actualizada (o null si no existe). */
export async function registrarDescargaBuzon(
  clienteId: string,
  codMensaje: string,
  usuario?: { id: string; nombre: string }
): Promise<{ descargadaAt: string; descargadoPorNombre?: string } | null> {
  const store = await readStore();
  const cliente = store.clientes.find((c) => c.id === clienteId);
  const meta = cliente?.buzonAdjuntos?.[codMensaje];
  if (!cliente || !meta) return null;
  const ahora = new Date().toISOString();
  meta.descargadaAt = ahora;
  meta.descargadoPorId = usuario?.id;
  meta.descargadoPorNombre = usuario?.nombre;
  await writeStore(store);
  return { descargadaAt: ahora, descargadoPorNombre: usuario?.nombre };
}

/** Lee el PDF cacheado de un mensaje (o null si no está). */
export async function getBuzonAdjunto(
  clienteId: string,
  codMensaje: string
): Promise<{ pdf: Buffer; nombre: string } | null> {
  const cliente = await getCliente(clienteId);
  const meta = cliente?.buzonAdjuntos?.[codMensaje];
  if (!meta) return null;
  try {
    const pdf = await fs.readFile(path.join(UPLOADS_DIR, meta.archivo));
    return { pdf, nombre: meta.nombre };
  } catch {
    return null;
  }
}

/** Guarda (reemplaza) las deudas F36 extraídas del portal SOL. */
export async function setDeudasF36(clienteId: string, tablas: DeudaF36Tabla[], nota?: string): Promise<void> {
  const store = await readStore();
  const cliente = store.clientes.find((c) => c.id === clienteId);
  if (!cliente) return;
  cliente.deudasF36 = {
    ...(cliente.deudasF36 ?? {}),
    tablas,
    at: new Date().toISOString(),
    nota: nota || undefined,
    estado: "extraido",
    verificadoAt: new Date().toISOString(),
  };
  await writeStore(store);
}

/** Marca el pedido de deuda recién generado (queda "en proceso" en SUNAT). */
export async function setDeudaGenerado(
  clienteId: string,
  info?: { numPedido?: string; fechaPedido?: string }
): Promise<void> {
  const store = await readStore();
  const cliente = store.clientes.find((c) => c.id === clienteId);
  if (!cliente) return;
  cliente.deudasF36 = {
    ...(cliente.deudasF36 ?? {}),
    tablas: cliente.deudasF36?.tablas ?? [],
    generadoAt: new Date().toISOString(),
    numPedido: info?.numPedido ?? cliente.deudasF36?.numPedido,
    fechaPedido: info?.fechaPedido ?? cliente.deudasF36?.fechaPedido,
    estado: "en-proceso",
    verificadoAt: new Date().toISOString(),
  };
  await writeStore(store);
}

/** Actualiza el ESTADO del pedido (trazabilidad de la fase asíncrona). */
export async function setDeudaEstadoF36(
  clienteId: string,
  info: { estado: "sin-pedido" | "en-proceso" | "listo" | "vencido"; numPedido?: string; fechaPedido?: string; estadoTexto?: string; accion?: string }
): Promise<Cliente | null> {
  const store = await readStore();
  const cliente = store.clientes.find((c) => c.id === clienteId);
  if (!cliente) return null;
  cliente.deudasF36 = {
    ...(cliente.deudasF36 ?? {}),
    tablas: cliente.deudasF36?.tablas ?? [],
    estado: info.estado,
    numPedido: info.numPedido ?? cliente.deudasF36?.numPedido,
    fechaPedido: info.fechaPedido ?? cliente.deudasF36?.fechaPedido,
    estadoTexto: info.estadoTexto,
    accion: info.accion,
    verificadoAt: new Date().toISOString(),
  };
  await writeStore(store);
  return cliente;
}

export async function clearSire(clienteId: string): Promise<Cliente | null> {
  const store = await readStore();
  const cliente = store.clientes.find((c) => c.id === clienteId);
  if (!cliente) return null;
  cliente.sire = [];
  await writeStore(store);
  return cliente;
}

// ---- Seguimiento de mensajes del buzón (plazo de atención + comentario) ----

const MS_DIA = 24 * 60 * 60 * 1000;

export async function setSeguimientoBuzon(
  clienteId: string,
  datos: { codMensaje: string; asunto: string; fecha: string; origen?: "notificaciones" | "mensajes"; diasAtencion: number; comentario: string; creadoPorId?: string; creadoPorNombre?: string }
): Promise<SeguimientoBuzon | null> {
  const store = await readStore();
  const cliente = store.clientes.find((c) => c.id === clienteId);
  if (!cliente) return null;
  if (!cliente.seguimientosBuzon) cliente.seguimientosBuzon = [];
  const creadoAt = new Date().toISOString();
  const seg: SeguimientoBuzon = {
    codMensaje: datos.codMensaje,
    asunto: datos.asunto,
    fecha: datos.fecha,
    origen: datos.origen,
    diasAtencion: datos.diasAtencion,
    comentario: datos.comentario ?? "",
    creadoAt,
    fechaLimite: new Date(Date.now() + datos.diasAtencion * MS_DIA).toISOString(),
    atendido: false,
    creadoPorId: datos.creadoPorId,
    creadoPorNombre: datos.creadoPorNombre,
  };
  const i = cliente.seguimientosBuzon.findIndex((s) => s.codMensaje === datos.codMensaje);
  if (i >= 0) cliente.seguimientosBuzon[i] = seg;
  else cliente.seguimientosBuzon.push(seg);
  await writeStore(store);
  return seg;
}

export async function atenderSeguimientoBuzon(
  clienteId: string,
  codMensaje: string,
  atendido: boolean
): Promise<boolean> {
  const store = await readStore();
  const cliente = store.clientes.find((c) => c.id === clienteId);
  const seg = cliente?.seguimientosBuzon?.find((s) => s.codMensaje === codMensaje);
  if (!seg) return false;
  seg.atendido = atendido;
  await writeStore(store);
  return true;
}

/** Recordatorios del usuario: seguimientos no atendidos, con su empresa, marcando
 *  los vencidos (fechaLimite <= ahora). Ordenados por fecha límite ascendente. */
export async function getRecordatorios(
  ownerId: string
): Promise<Array<SeguimientoBuzon & { clienteId: string; razonSocial: string; ruc: string; vencido: boolean }>> {
  const store = await readStore();
  const now = Date.now();
  const out: Array<SeguimientoBuzon & { clienteId: string; razonSocial: string; ruc: string; vencido: boolean }> = [];
  for (const c of store.clientes) {
    if (c.ownerId && c.ownerId !== ownerId) continue;
    for (const s of c.seguimientosBuzon ?? []) {
      if (s.atendido) continue;
      out.push({ ...s, clienteId: c.id, razonSocial: c.razonSocial, ruc: c.ruc, vencido: new Date(s.fechaLimite).getTime() <= now });
    }
  }
  out.sort((a, b) => new Date(a.fechaLimite).getTime() - new Date(b.fechaLimite).getTime());
  return out;
}

export async function setBuzon(
  clienteId: string,
  buzon: BuzonResumen
): Promise<Cliente | null> {
  const store = await readStore();
  const cliente = store.clientes.find((c) => c.id === clienteId);
  if (!cliente) return null;
  cliente.buzon = buzon;
  await writeStore(store);
  return cliente;
}

export async function setDiagnostico(
  clienteId: string,
  diagnostico: Diagnostico
): Promise<Cliente | null> {
  const store = await readStore();
  const cliente = store.clientes.find((c) => c.id === clienteId);
  if (!cliente) return null;
  cliente.diagnostico = diagnostico;
  await writeStore(store);
  return cliente;
}
