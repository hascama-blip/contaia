import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import { AsyncLocalStorage } from "async_hooks";
import { hoyLima } from "./fechas";
import { cifrar, descifrar, esCifrado } from "./cifrado";
import { esRucDemo } from "./demo";
import type { AsociacionContenido, RatingAgg, Sugerencia } from "./asociacion";
import { CONTENIDO_DEFAULT, normalizarContenido } from "./asociacion";
import type {
  Cliente,
  Documento,
  Diagnostico,
  SunatInfo,
  SireResumen,
  BuzonResumen,
  BuzonMensaje,
  DeclaracionMensual,
  DeclaracionAnual,
  Deuda,
  CredencialesSire,
  ProveedorCuenta,
  Usuario,
  Aviso,
  Pago,
  AlertasUsuario,
  VigilanciaBuzon,
  DeudaF36Tabla,
  SeguimientoBuzon,
  AccionAuditoria,
  SolicitudRTT,
  EstadoRTT,
  SolicitudRentas,
  AceptacionLegal,
} from "./types";

// Almacenamiento simple basado en un único archivo JSON.
// Suficiente para un MVP de un solo proceso; sustituible por una BD real
// (Postgres/SQLite) implementando la misma interfaz.

// Directorio de datos. En producción se monta un DISCO PERSISTENTE de Render
// y se apunta aquí con la variable DATA_DIR (p. ej. /var/data) para que los
// clientes NO se borren en cada despliegue. En local cae a ./data.
export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(process.cwd(), "data");
export const STORE_PATH = path.join(DATA_DIR, "store.json");
export const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
export const BACKUPS_DIR = path.join(DATA_DIR, "backups");

interface Store {
  clientes: Cliente[];
  /** Contenido editable del sitio público de la Asociación Mutualista. */
  asociacion?: AsociacionContenido;
  /** Valoraciones por curso (id de curso → {suma, conteo}). */
  asociacionRatings?: Record<string, RatingAgg>;
  /** Sugerencias de próximos cursos (público → las revisa el editor). */
  asociacionSugerencias?: Sugerencia[];
  /** Usuarios que inician sesión (cada uno ve solo sus empresas). */
  users?: Usuario[];
  /** Memoria del estudio: RUC del proveedor → cuenta contable. */
  cuentasProveedor?: Record<string, ProveedorCuenta>;
  /** Memoria de honorarios: emisor+concepto → cuentas del asiento (aprendido de
   *  la plantilla del mes anterior). Clave = "<emisor>::<CONCEPTO NORMALIZADO>". */
  cuentasHonorarios?: Record<string, CuentaHonorario>;
  /** Memorias de cuentas POR ESTUDIO (id del admin): proveedores y honorarios.
   *  Las globales `cuentasProveedor`/`cuentasHonorarios` quedan como memoria del
   *  supremo (datos anteriores a la separación por estudio). */
  memoriasEstudio?: Record<string, { proveedores?: Record<string, ProveedorCuenta>; honorarios?: Record<string, CuentaHonorario> }>;
  /** Caché de rubro por RUC (para consultar decolecta 1 sola vez por RUC). */
  rubrosProveedor?: Record<string, { razonSocial: string; actividad: string; at: string }>;
  /** Bitácora de auditoría: acciones de todos los usuarios (la ve el líder). */
  acciones?: AccionAuditoria[];
  /** Registro GLOBAL de RUCs tomados: cada empresa pertenece a un solo estudio
   *  en toda la plataforma (evita crear cuentas falsas para reconsultar). */
  rucsRegistrados?: Record<string, { studioId: string; clienteId: string; ownerNombre?: string; at: string }>;
  /** Configuración global de la plataforma (la administra el supremo). */
  config?: {
    browserWsUrl?: string;
    rttDominio?: string;
    rttSecret?: string;
    /** Integraciones antibloqueo SUNAT (captcha + proxy residencial). */
    capsolverKey?: string;
    proxyServer?: string;
    proxyUser?: string;
    proxyPass?: string;
  };
  /** Solicitudes de RTT (Reporte Tributario para Terceros) con su trazabilidad. */
  rtt?: SolicitudRTT[];
  /** Bitácora de los últimos correos recibidos por el webhook del RTT (diagnóstico). */
  rttWebhookLog?: { at: string; ruc: string; tienePdf: boolean; tieneXml: boolean; resultado: string; from?: string }[];
  /** Solicitudes del Reporte de Rentas y Retenciones (4ta/5ta) por cliente. */
  rentas?: SolicitudRentas[];
  /** Visor Tributario: token por usuario + capturas + matriz (cuadro año×mes). */
  visor?: { tokens?: Record<string, string>; capturas?: VisorCaptura[]; matriz?: Record<string, VisorMatriz[]> };
  /** Avisos informativos publicados por el supremo (panel Notificaciones). */
  avisos?: Aviso[];
  /** Pagos de planes por la pasarela (pendientes, pagados, rechazados). */
  pagos?: Pago[];
  /** Alertas (Telegram/correo): registro de lo ya enviado y estado de la tarea nocturna. */
  alertas?: {
    /** clave de alerta → fecha ISO en que se envió (para no repetir). */
    enviadas?: Record<string, string>;
    /** Último update_id procesado de Telegram (getUpdates). */
    telegramOffset?: number;
    /** Última ejecución de la tarea nocturna (YYYY-MM-DD) y su resumen. */
    ultimaNocturna?: string;
    ultimaNocturnaAt?: string;
    ultimaNocturnaResumen?: string;
  };
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
    if (!store.rucsRegistrados) store.rucsRegistrados = {};
    // Compatibilidad: clientes creados antes de SIRE/buzón no tienen el campo.
    for (const c of store.clientes) {
      if (!Array.isArray(c.documentos)) c.documentos = [];
      if (!Array.isArray(c.sire)) c.sire = [];
      if (c.buzon === undefined) c.buzon = null;
      if (!Array.isArray(c.declaraciones)) c.declaraciones = [];
      if (!Array.isArray(c.declaracionesAnuales)) c.declaracionesAnuales = [];
      if (!Array.isArray(c.deudas)) c.deudas = [];
      if (c.credSire === undefined) c.credSire = null;
    }
    descifrarSecretos(store);
    return store;
  } catch {
    return { clientes: [], users: [], cuentasProveedor: {}, rubrosProveedor: {}, acciones: [] };
  }
}

// ---- Sitio Asociación Mutualista -------------------------------------------
/** Contenido del sitio público (o el default si aún no se editó). */
export async function getAsociacion(): Promise<AsociacionContenido> {
  const store = await readStore();
  return store.asociacion ?? CONTENIDO_DEFAULT;
}
/** Guarda el contenido editado (normalizado). */
export async function setAsociacion(contenido: any): Promise<AsociacionContenido> {
  return conBloqueoStore(async () => {
  const store = await readStore();
  store.asociacion = normalizarContenido(contenido);
  await writeStore(store);
  return store.asociacion;
});
}

/** Todas las valoraciones (id curso → {suma, conteo}). */
export async function getRatings(): Promise<Record<string, RatingAgg>> {
  const store = await readStore();
  return store.asociacionRatings ?? {};
}
/** Agrega una valoración (1..5) a un curso y devuelve el agregado del curso. */
export async function addRating(cursoId: string, valor: number): Promise<RatingAgg> {
  return conBloqueoStore(async () => {
  const v = Math.max(1, Math.min(5, Math.round(valor)));
  const store = await readStore();
  if (!store.asociacionRatings) store.asociacionRatings = {};
  const prev = store.asociacionRatings[cursoId] ?? { sum: 0, count: 0 };
  const next = { sum: prev.sum + v, count: prev.count + 1 };
  store.asociacionRatings[cursoId] = next;
  await writeStore(store);
  return next;
});
}
/** Sugerencias de próximos cursos (más recientes primero). */
export async function getSugerencias(): Promise<Sugerencia[]> {
  const store = await readStore();
  return (store.asociacionSugerencias ?? []).slice().reverse();
}
export async function addSugerencia(sug: Sugerencia): Promise<void> {
  return conBloqueoStore(async () => {
  const store = await readStore();
  if (!Array.isArray(store.asociacionSugerencias)) store.asociacionSugerencias = [];
  store.asociacionSugerencias.push(sug);
  if (store.asociacionSugerencias.length > 500) store.asociacionSugerencias = store.asociacionSugerencias.slice(-500);
  await writeStore(store);
});
}

// ---- Usuarios --------------------------------------------------------------

/** Actualiza campos de un usuario por id (parche superficial). */
export async function updateUserById(
  id: string,
  patch: Partial<Pick<Usuario, "passHash" | "rol" | "estado" | "nombre" | "parentId" | "decididoAt" | "soloRtp">>
): Promise<Usuario | null> {
  return conBloqueoStore(async () => {
  const store = await readStore();
  const u = (store.users ?? []).find((x) => x.id === id);
  if (!u) return null;
  Object.assign(u, patch);
  await writeStore(store);
  return u;
});
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
  soloRtp?: boolean;
  /** false = registro con verificación de correo pendiente (no puede entrar aún). */
  emailVerificado?: boolean;
  /** Constancia de aceptación de las políticas (registro). */
  aceptacion?: AceptacionLegal;
}): Promise<Usuario> {
  return conBloqueoStore(async () => {
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
    ...(data.soloRtp ? { soloRtp: true } : {}),
    ...(data.emailVerificado === false ? { emailVerificado: false } : {}),
    ...(data.aceptacion ? { aceptaciones: [data.aceptacion] } : {}),
  };
  store.users.push(user);
  await writeStore(store);
  return user;
});
}

// ---- Cupo del módulo gratis: 3 consultas por ventana de 7 días -------------

const LIMITE_USOS = 3;
const VENTANA_USOS = 7 * 24 * 60 * 60 * 1000;

function calcUsos(u: Usuario) {
  // Ilimitado si es el supremo, tiene un plan de paga (regular+) o módulos (legacy).
  const pago =
    u.rol === "supremo" ||
    (!!u.plan && u.plan !== "basico") ||
    (u.modulos?.length ?? 0) > 0;
  const desde = u.usosGratis?.desde ?? "";
  const t = desde ? new Date(desde).getTime() : 0;
  const expirado = !t || Date.now() - t >= VENTANA_USOS;
  const usados = expirado ? 0 : (u.usosGratis?.usados ?? 0);
  const restantes = Math.max(0, LIMITE_USOS - usados);
  const renuevaAt = t && !expirado ? new Date(t + VENTANA_USOS).toISOString() : null;
  return { pago, usados, restantes, renuevaAt, expirado };
}

/** Estado del cupo gratis de un estudio (sin consumir). */
export async function estadoUsos(
  adminId: string
): Promise<{ ilimitado: boolean; restantes: number; renuevaAt: string | null }> {
  const u = await getUserById(adminId);
  if (!u) return { ilimitado: true, restantes: LIMITE_USOS, renuevaAt: null };
  const c = calcUsos(u);
  return { ilimitado: c.pago, restantes: c.restantes, renuevaAt: c.renuevaAt };
}

/** Consume 1 uso del cupo gratis (los pagos no consumen). */
export async function consumirUso(adminId: string): Promise<void> {
  return conBloqueoStore(async () => {
  const store = await readStore();
  const u = (store.users ?? []).find((x) => x.id === adminId);
  if (!u) return;
  const c = calcUsos(u);
  if (c.pago) return; // ilimitado (supremo / plan de paga / módulos)
  const desde = c.expirado ? new Date().toISOString() : (u.usosGratis?.desde as string);
  const usados = c.expirado ? 1 : (u.usosGratis?.usados ?? 0) + 1;
  u.usosGratis = { usados, desde };
  await writeStore(store);
});
}

// ---- Cupos del mes por estudio (generaciones por empresa+paso y comprobantes)

/** Mes en curso en Lima ("YYYY-MM"): los cupos se reinician el día 1. */
export function mesLima(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima", year: "numeric", month: "2-digit" }).format(d).slice(0, 7);
}

/** Cupos del mes en curso del estudio (vacío si cambió de mes). */
export async function getCuposMes(adminId: string): Promise<{ usos: Record<string, number>; lotes: Record<string, string>; comprobantes: number }> {
  const u = await getUserById(adminId);
  const mes = mesLima();
  if (!u?.cupos || u.cupos.mes !== mes) return { usos: {}, lotes: {}, comprobantes: 0 };
  return { usos: { ...u.cupos.usos }, lotes: { ...(u.cupos.lotes ?? {}) }, comprobantes: u.cupos.comprobantes ?? 0 };
}

function cuposDelMes(u: Usuario) {
  const mes = mesLima();
  if (!u.cupos || u.cupos.mes !== mes) u.cupos = { mes, usos: {}, lotes: {}, comprobantes: 0 };
  if (!u.cupos.lotes) u.cupos.lotes = {};
  return u.cupos;
}

/** Suma 1 generación a "RUC:paso". Si viene `lote` y esa tanda ya se contó,
 *  no suma (p. ej. el SIRE de 12 periodos = 1 sola generación). Devuelve los usados. */
export async function sumarCupo(adminId: string, clave: string, lote?: string): Promise<number> {
  return conBloqueoStore(async () => {
  const store = await readStore();
  const u = (store.users ?? []).find((x) => x.id === adminId);
  if (!u) return 0;
  const c = cuposDelMes(u);
  if (lote) {
    const kl = `${clave}:${lote}`;
    if (c.lotes![kl]) return c.usos[clave] ?? 0;
    c.lotes![kl] = new Date().toISOString();
    // Poda: solo se guardan las tandas del mes, con tope de 300.
    const ks = Object.keys(c.lotes!);
    if (ks.length > 300) for (const k of ks.slice(0, ks.length - 300)) delete c.lotes![k];
  }
  c.usos[clave] = (c.usos[clave] ?? 0) + 1;
  await writeStore(store);
  return c.usos[clave];
});
}

/** Suma `n` comprobantes descargados en el mes. Devuelve el acumulado. */
export async function sumarComprobantesMes(adminId: string, n: number): Promise<number> {
  return conBloqueoStore(async () => {
  if (!(n > 0)) return (await getCuposMes(adminId)).comprobantes;
  const store = await readStore();
  const u = (store.users ?? []).find((x) => x.id === adminId);
  if (!u) return 0;
  const c = cuposDelMes(u);
  c.comprobantes = (c.comprobantes ?? 0) + n;
  await writeStore(store);
  return c.comprobantes;
});
}

/** Límites pactados del Plan Empresas (los fija el supremo). */
export async function setLimitesCotizados(userId: string, lim: { generaciones?: number; comprobantes?: number } | null): Promise<Usuario | null> {
  return conBloqueoStore(async () => {
  const store = await readStore();
  const u = (store.users ?? []).find((x) => x.id === userId && !x.parentId && x.rol !== "supremo");
  if (!u) return null;
  u.limitesCotizados = lim ?? undefined;
  await writeStore(store);
  return u;
});
}

// ---- Pagos de planes (pasarela) ---------------------------------------------

export async function crearPago(p: Omit<Pago, "id" | "creadoAt" | "estado">): Promise<Pago> {
  return conBloqueoStore(async () => {
  const store = await readStore();
  if (!Array.isArray(store.pagos)) store.pagos = [];
  const pago: Pago = { ...p, id: newId(), estado: "pendiente", creadoAt: new Date().toISOString() };
  store.pagos.unshift(pago);
  // Poda de pendientes viejos (más de 30 días sin pagar).
  const lim = Date.now() - 30 * 86400000;
  store.pagos = store.pagos.filter((x) => x.estado !== "pendiente" || new Date(x.creadoAt).getTime() > lim);
  await writeStore(store);
  return pago;
});
}

export async function getPago(id: string): Promise<Pago | null> {
  const store = await readStore();
  return (store.pagos ?? []).find((p) => p.id === id) ?? null;
}

export async function listPagos(userId?: string): Promise<Pago[]> {
  const store = await readStore();
  const l = store.pagos ?? [];
  return userId ? l.filter((p) => p.userId === userId) : l;
}

/** Personas (estudios) distintas que ya pagaron con precio de lanzamiento. */
export async function contarLanzamiento(): Promise<number> {
  const store = await readStore();
  const ids = new Set<string>();
  for (const p of store.pagos ?? []) if (p.estado === "pagado" && p.lanzamiento) ids.add(p.userId);
  for (const u of store.users ?? []) if (u.precioLanzamiento) ids.add(u.id);
  return ids.size;
}

export async function marcarPago(id: string, cambios: Partial<Pick<Pago, "estado" | "referencia" | "detalle">>): Promise<Pago | null> {
  return conBloqueoStore(async () => {
  const store = await readStore();
  const p = (store.pagos ?? []).find((x) => x.id === id);
  if (!p || p.estado === "pagado") return p ?? null;
  Object.assign(p, cambios);
  await writeStore(store);
  return p;
});
}

const sumarDias = (iso: string, dias: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
};

/** Acredita un pago (IDEMPOTENTE: si ya estaba pagado no hace nada) y activa
 *  el plan del estudio por `dias`. Si renueva el MISMO plan aún vigente, los
 *  días se suman a su vencimiento; si cambia de plan, la vigencia corre desde hoy.
 *  Devuelve { pago, nuevo } (nuevo=false si ya estaba acreditado). */
export async function acreditarPago(
  id: string,
  datos: { referencia?: string; montoCentimos?: number; detalle?: string },
  dias = 30,
): Promise<{ pago: Pago | null; nuevo: boolean; error?: string }> {
  return conBloqueoStore(async () => {
  const store = await readStore();
  const p = (store.pagos ?? []).find((x) => x.id === id);
  if (!p) return { pago: null, nuevo: false, error: "Pago no encontrado." };
  if (p.estado === "pagado") return { pago: p, nuevo: false };
  if (datos.montoCentimos !== undefined && datos.montoCentimos < p.montoCentimos) {
    p.estado = "rechazado";
    p.detalle = `Monto recibido ${datos.montoCentimos} < esperado ${p.montoCentimos}.`;
    await writeStore(store);
    return { pago: p, nuevo: false, error: p.detalle };
  }
  const u = (store.users ?? []).find((x) => x.id === p.userId);
  if (!u) return { pago: p, nuevo: false, error: "Usuario no encontrado." };
  const hoy = hoyLima();
  const vigente = !!u.planVence && u.planVence >= hoy && (u.plan ?? "basico") !== "basico";
  if (u.plan === p.plan && vigente) {
    // Renovación del mismo plan: los días se suman al vencimiento actual.
    u.planVence = sumarDias(u.planVence!, dias);
  } else {
    // Cambio de plan: corre desde hoy y los días que quedaban del plan anterior
    // se convierten según el valor de cada plan (Premium vale el doble que
    // Regular): subir de Regular con 20 días restantes suma 10 días de Premium.
    const PESO: Record<string, number> = { regular: 1, premium: 2, equipo: 2 };
    let credito = 0;
    if (vigente && PESO[u.plan as string]) {
      const restantes = Math.max(0, Math.round((Date.parse(`${u.planVence}T00:00:00Z`) - Date.parse(`${hoy}T00:00:00Z`)) / 86400000));
      credito = Math.floor((restantes * PESO[u.plan as string]) / PESO[p.plan]);
    }
    u.plan = p.plan;
    u.planVence = sumarDias(hoy, dias + credito);
  }
  if (p.lanzamiento) u.precioLanzamiento = true;
  p.estado = "pagado";
  p.pagadoAt = new Date().toISOString();
  p.vigenteHasta = u.planVence;
  if (datos.referencia) p.referencia = datos.referencia;
  if (datos.detalle) p.detalle = datos.detalle;
  await writeStore(store);
  return { pago: p, nuevo: true };
});
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
  return conBloqueoStore(async () => {
  const store = await readStore();
  const n = (store.users ?? []).length;
  // Reset total de cuentas: borra usuarios, clientes y el registro global de
  // RUCs (si no, quedan huérfanos y al re-registrar sale "ya existe"). Se
  // conserva la config de plataforma (p. ej. la URL del navegador remoto).
  store.users = [];
  store.clientes = [];
  store.rucsRegistrados = {};
  store.acciones = [];
  await writeStore(store);
  return n;
});
}

/** Cambia la contraseña (hash) de un usuario y limpia cualquier token de reset. */
export async function setPasswordUsuario(userId: string, passHash: string): Promise<Usuario | null> {
  return conBloqueoStore(async () => {
  const store = await readStore();
  const u = (store.users ?? []).find((x) => x.id === userId);
  if (!u) return null;
  u.passHash = passHash;
  u.sesionVersion = (u.sesionVersion ?? 0) + 1; // cierra las sesiones abiertas
  u.resetTokenHash = undefined;
  u.resetTokenExp = undefined;
  u.codigoHash = undefined; u.codigoExp = undefined; u.codigoTipo = undefined; u.codigoIntentos = undefined;
  await writeStore(store);
  return u;
});
}

// ---- Códigos de 6 dígitos (verificación de correo / cambio de contraseña) ---

/** Guarda un código (hash + vencimiento + tipo) y reinicia intentos. */
export async function setCodigoUsuario(userId: string, d: { hash: string; exp: string; tipo: "verificacion" | "reset" | "acceso" }): Promise<void> {
  return conBloqueoStore(async () => {
  const store = await readStore();
  const u = (store.users ?? []).find((x) => x.id === userId);
  if (!u) return;
  u.codigoHash = d.hash; u.codigoExp = d.exp; u.codigoTipo = d.tipo;
  u.codigoIntentos = 0; u.codigoEnviadoAt = new Date().toISOString();
  await writeStore(store);
});
}
/** Invalida el código vigente (conserva la hora del último envío para el throttle). */
export async function limpiarCodigoUsuario(userId: string): Promise<void> {
  return conBloqueoStore(async () => {
  const store = await readStore();
  const u = (store.users ?? []).find((x) => x.id === userId);
  if (!u) return;
  u.codigoHash = undefined; u.codigoExp = undefined; u.codigoTipo = undefined; u.codigoIntentos = undefined;
  await writeStore(store);
});
}
/** Suma un intento fallido y devuelve el total. */
export async function incIntentosCodigo(userId: string): Promise<number> {
  return conBloqueoStore(async () => {
  const store = await readStore();
  const u = (store.users ?? []).find((x) => x.id === userId);
  if (!u) return 0;
  u.codigoIntentos = (u.codigoIntentos ?? 0) + 1;
  await writeStore(store);
  return u.codigoIntentos;
});
}
/** Marca el correo como verificado y limpia el código. */
export async function marcarEmailVerificado(userId: string): Promise<Usuario | null> {
  return conBloqueoStore(async () => {
  const store = await readStore();
  const u = (store.users ?? []).find((x) => x.id === userId);
  if (!u) return null;
  u.emailVerificado = true;
  u.codigoHash = undefined; u.codigoExp = undefined; u.codigoTipo = undefined; u.codigoIntentos = undefined;
  await writeStore(store);
  return u;
});
}

/** Guarda el token de recuperación (hash + expiración) de un usuario. */
export async function setResetTokenUsuario(userId: string, hash: string, exp: string): Promise<void> {
  return conBloqueoStore(async () => {
  const store = await readStore();
  const u = (store.users ?? []).find((x) => x.id === userId);
  if (!u) return;
  u.resetTokenHash = hash;
  u.resetTokenExp = exp;
  await writeStore(store);
});
}

/** El supremo desbloquea/bloquea los módulos de paga de un estudio. */
export async function setModulosUsuario(
  userId: string,
  modulos: string[]
): Promise<Usuario | null> {
  return conBloqueoStore(async () => {
  const store = await readStore();
  const u = (store.users ?? []).find((x) => x.id === userId && !x.parentId && x.rol !== "supremo");
  if (!u) return null;
  u.modulos = Array.from(new Set(modulos));
  await writeStore(store);
  return u;
});
}

/** El supremo asigna el PLAN de un estudio (basico/regular/premium/equipo) y,
 *  opcionalmente, su vencimiento (YYYY-MM-DD; "" = sin vencimiento). */
export async function setPlanUsuario(
  userId: string,
  plan: "basico" | "regular" | "premium" | "equipo",
  planVence?: string
): Promise<Usuario | null> {
  return conBloqueoStore(async () => {
  const store = await readStore();
  const u = (store.users ?? []).find((x) => x.id === userId && !x.parentId && x.rol !== "supremo");
  if (!u) return null;
  u.plan = plan;
  if (planVence !== undefined) u.planVence = planVence || undefined;
  if (plan === "basico") u.planVence = undefined;
  await writeStore(store);
  return u;
});
}

/** Cambia solo el vencimiento del plan ("" = sin vencimiento). */
export async function setPlanVenceUsuario(userId: string, planVence: string): Promise<Usuario | null> {
  return conBloqueoStore(async () => {
  const store = await readStore();
  const u = (store.users ?? []).find((x) => x.id === userId && !x.parentId && x.rol !== "supremo");
  if (!u) return null;
  u.planVence = planVence || undefined;
  await writeStore(store);
  return u;
});
}

// --- Alertas por usuario (Telegram / correo) ---------------------------------
export async function setAlertasUsuario(userId: string, patch: Partial<AlertasUsuario>): Promise<Usuario | null> {
  return conBloqueoStore(async () => {
  const store = await readStore();
  const u = (store.users ?? []).find((x) => x.id === userId);
  if (!u) return null;
  u.alertas = { ...(u.alertas ?? {}), ...patch };
  // Limpia claves vacías para no dejar basura.
  for (const k of Object.keys(u.alertas) as (keyof AlertasUsuario)[]) if (u.alertas[k] === undefined) delete u.alertas[k];
  await writeStore(store);
  return u;
});
}
/** Usuario que tiene pendiente el código de vinculación de Telegram. */
export async function getUserPorCodigoTelegram(codigo: string): Promise<Usuario | null> {
  const store = await readStore();
  const lim = Date.now() - 15 * 60 * 1000;
  return (store.users ?? []).find((u) => u.alertas?.telegramCodigo && u.alertas.telegramCodigo === codigo && new Date(u.alertas.telegramCodigoAt ?? 0).getTime() >= lim) ?? null;
}
/** Admins (dueños de estudio), para recorrer en la tarea nocturna. */
export async function listAdmins(): Promise<Usuario[]> {
  const store = await readStore();
  return (store.users ?? []).filter((u) => !u.parentId && u.rol !== "supremo" && !u.soloRtp);
}

// --- Vigilancia nocturna del buzón (por empresa) -----------------------------
export async function setVigilancia(clienteId: string, v: VigilanciaBuzon | null): Promise<Cliente | null> {
  return conBloqueoStore(async () => {
  const store = await readStore();
  const c = store.clientes.find((x) => x.id === clienteId);
  if (!c) return null;
  c.vigilancia = v;
  await writeStore(store);
  return c;
});
}
export async function patchVigilancia(clienteId: string, patch: Partial<VigilanciaBuzon>): Promise<void> {
  return conBloqueoStore(async () => {
  const store = await readStore();
  const c = store.clientes.find((x) => x.id === clienteId);
  if (!c?.vigilancia) return;
  Object.assign(c.vigilancia, patch);
  await writeStore(store);
});
}
export async function listClientesVigilados(): Promise<Cliente[]> {
  const store = await readStore();
  return store.clientes.filter((c) => c.vigilancia?.activo);
}

// --- Registro de alertas enviadas / estado de la tarea nocturna ---------------
export async function alertaYaEnviada(clave: string): Promise<boolean> {
  const store = await readStore();
  return Boolean(store.alertas?.enviadas?.[clave]);
}
export async function marcarAlertaEnviada(clave: string): Promise<void> {
  return conBloqueoStore(async () => {
  const store = await readStore();
  if (!store.alertas) store.alertas = {};
  if (!store.alertas.enviadas) store.alertas.enviadas = {};
  store.alertas.enviadas[clave] = new Date().toISOString();
  // Poda: conserva 90 días.
  const lim = Date.now() - 90 * 86400000;
  for (const [k, v] of Object.entries(store.alertas.enviadas)) if (new Date(v).getTime() < lim) delete store.alertas.enviadas[k];
  await writeStore(store);
});
}
export async function getEstadoAlertas(): Promise<NonNullable<Store["alertas"]>> {
  const store = await readStore();
  return store.alertas ?? {};
}
export async function setEstadoAlertas(patch: Partial<NonNullable<Store["alertas"]>>): Promise<void> {
  return conBloqueoStore(async () => {
  const store = await readStore();
  store.alertas = { ...(store.alertas ?? {}), ...patch };
  await writeStore(store);
});
}

// --- Avisos informativos (los publica el supremo; los ven todas las cuentas) ---
export async function listAvisos(soloVigentes = true): Promise<Aviso[]> {
  const store = await readStore();
  const hoy = new Date().toISOString().slice(0, 10);
  const todos = (store.avisos ?? []).slice().sort((a, b) => b.at.localeCompare(a.at));
  return soloVigentes ? todos.filter((a) => !a.hasta || a.hasta >= hoy) : todos;
}
export async function addAviso(titulo: string, texto: string, hasta?: string): Promise<Aviso> {
  return conBloqueoStore(async () => {
  const store = await readStore();
  if (!store.avisos) store.avisos = [];
  const aviso: Aviso = { id: crypto.randomUUID(), titulo, texto, at: new Date().toISOString(), hasta: hasta || undefined };
  store.avisos.unshift(aviso);
  store.avisos = store.avisos.slice(0, 50);
  await writeStore(store);
  return aviso;
});
}
export async function deleteAviso(id: string): Promise<void> {
  return conBloqueoStore(async () => {
  const store = await readStore();
  store.avisos = (store.avisos ?? []).filter((a) => a.id !== id);
  await writeStore(store);
});
}

/** El supremo aprueba o rechaza el acceso de un estudio. */
export async function setEstadoUsuario(
  userId: string,
  estado: "pendiente" | "aprobado" | "rechazado"
): Promise<Usuario | null> {
  return conBloqueoStore(async () => {
  const store = await readStore();
  const u = (store.users ?? []).find((x) => x.id === userId && !x.parentId && x.rol !== "supremo");
  if (!u) return null;
  u.estado = estado;
  u.decididoAt = new Date().toISOString();
  await writeStore(store);
  return u;
});
}

/** Sub-usuarios (operadores) de un admin/estudio. */
export async function listSubUsuarios(adminId: string): Promise<Usuario[]> {
  const store = await readStore();
  return (store.users ?? [])
    .filter((u) => u.parentId === adminId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Cuántos operadores tiene cada estudio (parentId → cantidad). */
export async function conteoOperadores(): Promise<Record<string, number>> {
  const store = await readStore();
  const out: Record<string, number> = {};
  for (const u of store.users ?? []) {
    if (u.parentId) out[u.parentId] = (out[u.parentId] ?? 0) + 1;
  }
  return out;
}

/** Elimina un sub-usuario, solo si pertenece a ese admin. */
export async function deleteSubUsuario(adminId: string, userId: string): Promise<boolean> {
  return conBloqueoStore(async () => {
  const store = await readStore();
  const i = (store.users ?? []).findIndex((u) => u.id === userId && u.parentId === adminId);
  if (i < 0) return false;
  store.users!.splice(i, 1);
  await writeStore(store);
  return true;
});
}

// ---- Empresas de SIMULACIÓN (supremo, demos/videos) ----------------------------

/** Reemplaza las empresas de simulación del estudio por las dadas (ids "demo-…"). */
export async function guardarEmpresasDemo(clientes: Cliente[]): Promise<number> {
  return conBloqueoStore(async () => {
  const store = await readStore();
  const ids = new Set(clientes.map((c) => c.id));
  store.clientes = store.clientes.filter((c) => !ids.has(c.id)).concat(clientes);
  await writeStore(store);
  return clientes.length;
});
}

/** Elimina TODAS las empresas de simulación (ids "demo-…"). */
export async function borrarEmpresasDemo(ownerId: string, userId: string, rucsDemo: string[]): Promise<number> {
  return conBloqueoStore(async () => {
  const store = await readStore();
  const antes = store.clientes.length;
  // Solo las empresas demo de ESTE estudio (cada cuenta con permiso tiene las suyas).
  store.clientes = store.clientes.filter((c) => !(c.id.startsWith("demo-") && c.ownerId === ownerId));
  const n = antes - store.clientes.length;
  // Cuadros del Visor de las empresas demo de este usuario (por su RUC ficticio).
  const rucs = new Set(rucsDemo);
  if (store.visor?.matriz?.[userId]) store.visor.matriz[userId] = store.visor.matriz[userId].filter((m) => !rucs.has(String(m.ruc ?? "")));
  await writeStore(store);
  return n;
});
}

// ---- Aceptación de políticas ------------------------------------------------

/** Guarda la constancia de aceptación de las políticas (no borra las anteriores). */
export async function registrarAceptacion(userId: string, a: AceptacionLegal): Promise<Usuario | null> {
  return conBloqueoStore(async () => {
  const store = await readStore();
  const u = store.users?.find((x) => x.id === userId);
  if (!u) return null;
  u.aceptaciones = [...(u.aceptaciones ?? []), a].slice(-20);
  await writeStore(store);
  return u;
});
}

/** Constancias de aceptación de todos los usuarios (para la evidencia del supremo). */
export async function listarAceptaciones(): Promise<{ usuario: Pick<Usuario, "id" | "nombre" | "email" | "rol" | "parentId">; a: AceptacionLegal }[]> {
  const store = await readStore();
  return (store.users ?? []).flatMap((u) =>
    (u.aceptaciones ?? []).map((a) => ({ usuario: { id: u.id, nombre: u.nombre, email: u.email, rol: u.rol, parentId: u.parentId }, a })),
  );
}

// ---- Bitácora de auditoría -------------------------------------------------

const MAX_ACCIONES = 5000; // tope para no inflar el store.json indefinidamente.

/** Registra una acción en la bitácora (la ve el líder del estudio). */
export async function registrarAccion(
  data: Omit<AccionAuditoria, "id" | "at">
): Promise<void> {
  return conBloqueoStore(async () => {
  const store = await readStore();
  if (!Array.isArray(store.acciones)) store.acciones = [];
  store.acciones.push({ id: newId(), at: new Date().toISOString(), ...data });
  // Conserva solo las más recientes (poda las más viejas si excede el tope).
  if (store.acciones.length > MAX_ACCIONES) {
    store.acciones = store.acciones.slice(store.acciones.length - MAX_ACCIONES);
  }
  await writeStore(store);
});
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

// ---- Configuración global (la administra el supremo) -----------------------

/** URL del navegador remoto (Browserless) guardada en la app. Sirve como
 *  alternativa a la variable de entorno BROWSER_WS_URL cuando el hosting no la
 *  inyecta bien. La variable de entorno tiene prioridad si existe. */
export async function getBrowserWsUrl(): Promise<string> {
  const store = await readStore();
  return store.config?.browserWsUrl?.trim() ?? "";
}

export async function setBrowserWsUrl(url: string): Promise<void> {
  return conBloqueoStore(async () => {
  const store = await readStore();
  if (!store.config) store.config = {};
  store.config.browserWsUrl = url.trim();
  await writeStore(store);
});
}

// ---- Integraciones antibloqueo SUNAT (captcha + proxy) ---------------------
// El supremo las carga desde su panel (o por variables de entorno, que tienen
// prioridad). Sirven para evadir el captcha (CapSolver) y el bloqueo por IP
// (proxy residencial). Los secretos NO se exponen enteros en la UI.

export interface IntegracionesConfig {
  capsolverKey: string;
  proxyServer: string;
  proxyUser: string;
  proxyPass: string;
}

/** Config efectiva (entorno tiene prioridad; si no, lo guardado en la app). */
export async function getIntegraciones(): Promise<IntegracionesConfig> {
  const store = await readStore();
  const c = store.config ?? {};
  return {
    capsolverKey: (process.env.CAPSOLVER_KEY || c.capsolverKey || "").trim(),
    proxyServer: (process.env.PROXY_SERVER || c.proxyServer || "").trim(),
    proxyUser: (process.env.PROXY_USERNAME || c.proxyUser || "").trim(),
    proxyPass: (process.env.PROXY_PASSWORD || c.proxyPass || "").trim(),
  };
}

/** Guarda las integraciones (solo lo que venga definido). "" borra el valor. */
export async function setIntegraciones(patch: Partial<IntegracionesConfig>): Promise<void> {
  return conBloqueoStore(async () => {
  const store = await readStore();
  if (!store.config) store.config = {};
  if (patch.capsolverKey !== undefined) store.config.capsolverKey = patch.capsolverKey.trim();
  if (patch.proxyServer !== undefined) store.config.proxyServer = patch.proxyServer.trim();
  if (patch.proxyUser !== undefined) store.config.proxyUser = patch.proxyUser.trim();
  if (patch.proxyPass !== undefined) store.config.proxyPass = patch.proxyPass.trim();
  await writeStore(store);
});
}

// ---- RTT: Reporte Tributario para Terceros (trazabilidad + webhook) ---------

/** Config del RTT: dominio del sub-address y secreto del webhook. La variable
 *  de entorno tiene prioridad (RTT_DOMINIO / RTT_WEBHOOK_SECRET). */
export async function getRttConfig(): Promise<{ dominio: string; secret: string }> {
  const store = await readStore();
  return {
    dominio: (process.env.RTT_DOMINIO || store.config?.rttDominio || "").trim(),
    secret: (process.env.RTT_WEBHOOK_SECRET || store.config?.rttSecret || "").trim(),
  };
}
export async function setRttConfig(cfg: { dominio?: string; secret?: string }): Promise<void> {
  return conBloqueoStore(async () => {
  const store = await readStore();
  if (!store.config) store.config = {};
  if (cfg.dominio !== undefined) store.config.rttDominio = cfg.dominio.trim();
  if (cfg.secret !== undefined) store.config.rttSecret = cfg.secret.trim();
  await writeStore(store);
});
}

const RTT_DIR = path.join(UPLOADS_DIR, "rtt");

/** Crea una solicitud de RTT (estado inicial "creado"). */
export async function crearSolicitudRTT(datos: {
  ruc: string; razonSocial?: string; emailDestino: string; solicitadoPor?: string;
}): Promise<SolicitudRTT> {
  return conBloqueoStore(async () => {
  const store = await readStore();
  if (!Array.isArray(store.rtt)) store.rtt = [];
  const now = new Date().toISOString();
  const sol: SolicitudRTT = {
    id: crypto.randomUUID(),
    ruc: datos.ruc,
    razonSocial: datos.razonSocial,
    emailDestino: datos.emailDestino,
    estado: "creado",
    historial: [{ estado: "creado", at: now }],
    creadoEn: now,
    actualizadoEn: now,
    solicitadoPor: datos.solicitadoPor,
  };
  store.rtt.push(sol);
  await writeStore(store);
  return sol;
});
}

/** Cambia el estado de una solicitud y registra la transición. */
export async function setEstadoRTT(id: string, estado: EstadoRTT, nota?: string, extra?: Partial<SolicitudRTT>): Promise<SolicitudRTT | null> {
  return conBloqueoStore(async () => {
  const store = await readStore();
  const sol = (store.rtt ?? []).find((s) => s.id === id);
  if (!sol) return null;
  const now = new Date().toISOString();
  sol.estado = estado;
  sol.actualizadoEn = now;
  sol.historial.push({ estado, at: now, nota });
  if (extra) Object.assign(sol, extra);
  await writeStore(store);
  return sol;
});
}

export async function getSolicitudRTT(id: string): Promise<SolicitudRTT | null> {
  const store = await readStore();
  return (store.rtt ?? []).find((s) => s.id === id) ?? null;
}

/** Lista solicitudes RTT (opcionalmente de un usuario). */
export async function listarSolicitudesRTT(solicitadoPor?: string): Promise<SolicitudRTT[]> {
  const store = await readStore();
  let lista = store.rtt ?? [];
  if (solicitadoPor) lista = lista.filter((s) => s.solicitadoPor === solicitadoPor);
  return [...lista].sort((a, b) => b.creadoEn.localeCompare(a.creadoEn));
}

/** Nº de solicitudes creadas HOY para un RUC (límite SUNAT: 3/día). */
export async function contarRTTHoy(ruc: string): Promise<number> {
  const store = await readStore();
  const hoy = new Date().toISOString().slice(0, 10);
  return (store.rtt ?? []).filter((s) => s.ruc === ruc && s.creadoEn.slice(0, 10) === hoy).length;
}

/**
 * WEBHOOK: cruza el correo entrante por RUC y guarda el PDF/XML. Busca la
 * solicitud más reciente de ese RUC en "en_proceso" (o "recibido"), guarda los
 * archivos y la pasa a "listo". Devuelve la solicitud o null si no hay match.
 */
export async function guardarArchivosRTTPorRuc(
  ruc: string,
  archivos: { pdf?: Buffer; xml?: Buffer }
): Promise<SolicitudRTT | null> {
  return conBloqueoStore(async () => {
  await fs.mkdir(RTT_DIR, { recursive: true });
  const store = await readStore();
  const candidatas = (store.rtt ?? [])
    .filter((s) => s.ruc === ruc && (s.estado === "en_proceso" || s.estado === "recibido" || s.estado === "pendiente"))
    .sort((a, b) => b.creadoEn.localeCompare(a.creadoEn));
  const sol = candidatas[0];
  if (!sol) return null;
  const base = `${ruc}-${Date.now()}`;
  const now = new Date().toISOString();
  if (archivos.pdf) { await fs.writeFile(path.join(RTT_DIR, `${base}.pdf`), archivos.pdf); sol.rutaPdf = `${base}.pdf`; }
  if (archivos.xml) { await fs.writeFile(path.join(RTT_DIR, `${base}.xml`), archivos.xml); sol.rutaXml = `${base}.xml`; }
  sol.estado = "listo";
  sol.actualizadoEn = now;
  sol.historial.push({ estado: "recibido", at: now, nota: "correo capturado por webhook" });
  sol.historial.push({ estado: "listo", at: now });
  await writeStore(store);
  return sol;
});
}

/** Registra un evento del webhook (para verificar que el correo llegó). */
export async function registrarWebhookRTT(ev: { ruc?: string; tienePdf?: boolean; tieneXml?: boolean; resultado: string; from?: string }): Promise<void> {
  return conBloqueoStore(async () => {
  const store = await readStore();
  if (!Array.isArray(store.rttWebhookLog)) store.rttWebhookLog = [];
  store.rttWebhookLog.unshift({
    at: new Date().toISOString(),
    ruc: ev.ruc ?? "",
    tienePdf: !!ev.tienePdf,
    tieneXml: !!ev.tieneXml,
    resultado: ev.resultado,
    from: ev.from,
  });
  store.rttWebhookLog = store.rttWebhookLog.slice(0, 25);
  await writeStore(store);
});
}
export async function getWebhookLogRTT(): Promise<Store["rttWebhookLog"]> {
  const store = await readStore();
  return store.rttWebhookLog ?? [];
}

/** Lee un archivo RTT guardado (pdf/xml) por nombre. */
export async function leerArchivoRTT(nombre: string): Promise<Buffer | null> {
  try { return await fs.readFile(path.join(RTT_DIR, path.basename(nombre))); } catch { return null; }
}

// ---- Reporte de Rentas y Retenciones (4ta/5ta) --------------------------------
const RENTAS_DIR = path.join(UPLOADS_DIR, "rentas");

/** Crea o ACTUALIZA la solicitud de rentas de un cliente (una por cliente).
 *  La deja "en_proceso" esperando el correo de SUNAT. */
export async function upsertSolicitudRentas(datos: {
  clienteId: string; ruc: string; emailDestino: string; solicitadoPor?: string;
}): Promise<SolicitudRentas> {
  return conBloqueoStore(async () => {
  const store = await readStore();
  if (!Array.isArray(store.rentas)) store.rentas = [];
  const now = new Date().toISOString();
  let s = store.rentas.find((x) => x.clienteId === datos.clienteId);
  if (s) {
    s.ruc = datos.ruc; s.emailDestino = datos.emailDestino; s.estado = "en_proceso"; s.error = undefined; s.actualizadoEn = now;
  } else {
    s = { id: crypto.randomUUID(), clienteId: datos.clienteId, ruc: datos.ruc, emailDestino: datos.emailDestino, estado: "en_proceso", creadoEn: now, actualizadoEn: now, solicitadoPor: datos.solicitadoPor };
    store.rentas.push(s);
  }
  await writeStore(store);
  return s;
});
}

export async function setEstadoRentas(clienteId: string, estado: SolicitudRentas["estado"], extra?: Partial<SolicitudRentas>): Promise<SolicitudRentas | null> {
  return conBloqueoStore(async () => {
  const store = await readStore();
  const s = (store.rentas ?? []).find((x) => x.clienteId === clienteId);
  if (!s) return null;
  s.estado = estado; s.actualizadoEn = new Date().toISOString();
  if (extra) Object.assign(s, extra);
  await writeStore(store);
  return s;
});
}

export async function getSolicitudRentas(clienteId: string): Promise<SolicitudRentas | null> {
  const store = await readStore();
  return (store.rentas ?? []).find((x) => x.clienteId === clienteId) ?? null;
}

export async function leerPdfRentas(nombre: string): Promise<Buffer | null> {
  try { return await fs.readFile(path.join(RENTAS_DIR, path.basename(nombre))); } catch { return null; }
}

/** WEBHOOK: cruza el correo del reporte de rentas por RUC, guarda el PDF, lo
 *  PARSEA y deja la solicitud "listo". Devuelve la solicitud o null si no hay
 *  una "en_proceso" para ese RUC. */
export async function guardarReporteRentasPorRuc(ruc: string, pdf: Buffer): Promise<SolicitudRentas | null> {
  return conBloqueoStore(async () => {
  const store = await readStore();
  const s = (store.rentas ?? []).find((x) => x.ruc === ruc && (x.estado === "en_proceso" || x.estado === "listo"));
  if (!s) return null;
  await fs.mkdir(RENTAS_DIR, { recursive: true });
  const base = `${ruc}-${Date.now()}.pdf`;
  await fs.writeFile(path.join(RENTAS_DIR, base), pdf);
  let reporte: any = null;
  try {
    const { textoDePdf, parseReporteRentas } = await import("./reporteRentas");
    reporte = parseReporteRentas(await textoDePdf(pdf));
  } catch { /* si el parseo falla, igual queda el PDF descargable */ }
  s.rutaPdf = base; s.reporte = reporte; s.estado = "listo"; s.error = undefined; s.actualizadoEn = new Date().toISOString();
  await writeStore(store);
  return s;
});
}

// ---- Comprobantes XML: persistencia de lo extraído por cliente + periodo ------
// Cada comprobante extraído se guarda como un JSON en disco (con su XML/PDF en
// base64). Así, si se cae el internet o se recarga la página, se recuperan y no
// hay que volver a extraerlos. NO va al store.json (para no inflarlo).
const COMPROBANTES_DIR = path.join(UPLOADS_DIR, "comprobantes");
const sanRuta = (s: string) => String(s || "").replace(/[^\w.-]/g, "_").slice(0, 60) || "x";

/** Guarda un comprobante extraído (factura completa) en disco. */
export async function guardarComprobanteExtraido(clienteId: string, periodo: string, factura: any): Promise<void> {
  if (!/^\d{6}$/.test(periodo) || !factura) return;
  const dir = path.join(COMPROBANTES_DIR, sanRuta(clienteId), periodo);
  await fs.mkdir(dir, { recursive: true });
  const sn = sanRuta(factura.serieNumero || `${factura.serie}-${factura.numero}`);
  await fs.writeFile(path.join(dir, `${sn}.json`), JSON.stringify(factura)).catch(() => {});
}

/** Lista los comprobantes ya extraídos (facturas completas) de un cliente+periodo. */
export async function listarComprobantesExtraidos(clienteId: string, periodo: string): Promise<any[]> {
  if (!/^\d{6}$/.test(periodo)) return [];
  const dir = path.join(COMPROBANTES_DIR, sanRuta(clienteId), periodo);
  let files: string[];
  try { files = await fs.readdir(dir); } catch { return []; }
  const out: any[] = [];
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    try { out.push(JSON.parse(await fs.readFile(path.join(dir, f), "utf-8"))); } catch { /* corrupto: se ignora */ }
  }
  return out;
}

/** Crea o ACTUALIZA la solicitud de RTT de un RUC (una sola por usuario+RUC).
 *  Si ya existe, la reusa: la pone "en_proceso", CONSERVA el archivo previo (para
 *  no perder el último reporte si la regeneración fallara) y limpia el error.
 *  Así nunca se acumulan casillas: siempre hay una por empresa. */
export async function upsertSolicitudRTT(datos: {
  ruc: string; razonSocial?: string; emailDestino: string; solicitadoPor?: string;
}): Promise<SolicitudRTT> {
  return conBloqueoStore(async () => {
  const store = await readStore();
  if (!Array.isArray(store.rtt)) store.rtt = [];
  const now = new Date().toISOString();
  let sol = store.rtt.find((s) => s.ruc === datos.ruc && s.solicitadoPor === datos.solicitadoPor);
  if (sol) {
    sol.razonSocial = datos.razonSocial ?? sol.razonSocial;
    sol.emailDestino = datos.emailDestino;
    sol.estado = "en_proceso";
    sol.error = undefined;
    sol.actualizadoEn = now;
    sol.historial.push({ estado: "en_proceso", at: now, nota: "regeneración" });
  } else {
    sol = {
      id: crypto.randomUUID(),
      ruc: datos.ruc,
      razonSocial: datos.razonSocial,
      emailDestino: datos.emailDestino,
      estado: "en_proceso",
      historial: [{ estado: "en_proceso", at: now }],
      creadoEn: now,
      actualizadoEn: now,
      solicitadoPor: datos.solicitadoPor,
    };
    store.rtt.push(sol);
  }
  await writeStore(store);
  return sol;
});
}

/** Resuelve un fallo de generación SIN dejar casilla roja: si había un reporte
 *  previo, vuelve a "listo" (se conserva el anterior); si nunca hubo, BORRA la
 *  casilla. Devuelve true si quedó un reporte descargable. */
export async function resolverFalloRTT(id: string): Promise<boolean> {
  return conBloqueoStore(async () => {
  const store = await readStore();
  if (!Array.isArray(store.rtt)) return false;
  const i = store.rtt.findIndex((s) => s.id === id);
  if (i < 0) return false;
  const sol = store.rtt[i];
  const now = new Date().toISOString();
  if (sol.rutaPdf || sol.rutaXml) {
    sol.estado = "listo";
    sol.error = undefined;
    sol.actualizadoEn = now;
    sol.historial.push({ estado: "listo", at: now, nota: "se conserva el reporte anterior" });
    await writeStore(store);
    return true;
  }
  store.rtt.splice(i, 1); // nunca tuvo reporte → no dejar casilla
  await writeStore(store);
  return false;
});
}

/** Limpia la lista de RTT: quita casillas en "error" y resuelve las atascadas
 *  (>N min): con archivo → "listo"; sin archivo → se borran. Nunca deja casillas
 *  rojas ni colgadas. Devuelve nº de casillas afectadas. */
// Retención de los reportes RTT: se guardan 7 días y luego se borran (con sus
// archivos PDF/XML). Configurable por RTT_RETENCION_DIAS.
const RTT_RETENCION_DIAS = Math.max(1, Number(process.env.RTT_RETENCION_DIAS ?? "7") || 7);

export async function limpiarRTT(minutos = 30): Promise<number> {
  return conBloqueoStore(async () => {
  const store = await readStore();
  if (!Array.isArray(store.rtt)) return 0;
  const limite = Date.now() - minutos * 60_000;
  const limiteRetencion = Date.now() - RTT_RETENCION_DIAS * 24 * 60 * 60_000;
  const now = new Date().toISOString();
  let dirty = false;
  const borrarArchivos = (s: SolicitudRTT) => {
    for (const r of [s.rutaPdf, s.rutaXml]) if (r) fs.unlink(r).catch(() => {});
  };
  store.rtt = store.rtt.filter((s) => {
    // Retención: cualquier reporte con más de N días fuera (borra sus archivos).
    const nacido = new Date(s.creadoEn).getTime();
    if (Number.isFinite(nacido) && nacido < limiteRetencion) { borrarArchivos(s); dirty = true; return false; }
    const conArchivo = !!(s.rutaPdf || s.rutaXml);
    if (s.estado === "error") {
      if (conArchivo) { s.estado = "listo"; s.error = undefined; s.actualizadoEn = now; dirty = true; return true; }
      dirty = true; return false; // error sin archivo → fuera
    }
    if (["en_proceso", "pendiente", "recibido", "creado"].includes(s.estado) && new Date(s.actualizadoEn).getTime() < limite) {
      if (conArchivo) { s.estado = "listo"; s.actualizadoEn = now; dirty = true; return true; }
      dirty = true; return false; // atascada sin archivo → fuera
    }
    return true;
  });
  if (dirty) await writeStore(store);
  return dirty ? 1 : 0;
});
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
  return conBloqueoStore(async () => {
  const keys = Object.keys(entradas);
  if (keys.length === 0) return;
  const store = await readStore();
  if (!store.rubrosProveedor) store.rubrosProveedor = {};
  for (const ruc of keys) {
    store.rubrosProveedor[ruc] = { ...entradas[ruc], at: new Date().toISOString() };
  }
  await writeStore(store);
});
}

// `estudio` = id del admin del estudio; sin él (supremo) se usa la memoria global.
export async function getCuentasProveedor(estudio?: string): Promise<Record<string, ProveedorCuenta>> {
  const store = await readStore();
  if (estudio) return store.memoriasEstudio?.[estudio]?.proveedores ?? {};
  return store.cuentasProveedor ?? {};
}

// --- Memoria de cuentas de honorarios (aprendida del mes anterior) ------------
export interface CuentaHonorario {
  emisor: string;    // RUC/DNI del emisor
  concepto: string;  // concepto normalizado (GLOSA MOVIMIENTO)
  ctaPagar: string;  // cuenta por pagar (fila H)
  ctaGasto: string;  // cuenta de gasto (fila D)
  centro: string;    // centro de costos (fila D)
  destino: string;   // destino de compra
  at: string;
}

export async function getCuentasHonorarios(estudio?: string): Promise<Record<string, CuentaHonorario>> {
  const store = await readStore();
  if (estudio) return store.memoriasEstudio?.[estudio]?.honorarios ?? {};
  return store.cuentasHonorarios ?? {};
}

/** Aprende/actualiza el mapa de cuentas de honorarios (merge en la memoria). */
export async function mergeCuentasHonorarios(
  entradas: Record<string, Omit<CuentaHonorario, "at">>,
  estudio?: string,
): Promise<number> {
  return conBloqueoStore(async () => {
  const store = await readStore();
  let destino: Record<string, CuentaHonorario>;
  if (estudio) {
    if (!store.memoriasEstudio) store.memoriasEstudio = {};
    const m = (store.memoriasEstudio[estudio] ??= {});
    destino = m.honorarios ??= {};
  } else {
    destino = store.cuentasHonorarios ??= {};
  }
  let n = 0;
  const now = new Date().toISOString();
  for (const [k, v] of Object.entries(entradas)) {
    destino[k] = { ...v, at: now };
    n++;
  }
  await writeStore(store);
  return n;
});
}

/** Aprende/actualiza cuentas por proveedor (merge en la memoria del estudio). */
export async function setCuentasProveedor(
  nuevas: ProveedorCuenta[],
  estudio?: string,
): Promise<Record<string, ProveedorCuenta>> {
  return conBloqueoStore(async () => {
  const store = await readStore();
  let destino: Record<string, ProveedorCuenta>;
  if (estudio) {
    if (!store.memoriasEstudio) store.memoriasEstudio = {};
    const m = (store.memoriasEstudio[estudio] ??= {});
    destino = m.proveedores ??= {};
  } else {
    destino = store.cuentasProveedor ??= {};
  }
  for (const p of nuevas) {
    if (!/^\d{11}$/.test(p.ruc)) continue;
    destino[p.ruc] = { ...p, fuente: "aprendido", actualizadoAt: new Date().toISOString() };
  }
  await writeStore(store);
  return destino;
});
}

// --- Backup automático: 1 snapshot del store por día (conserva los últimos 14) ---
const SNAPSHOTS_A_CONSERVAR = 14;
let ultimoSnapshotDia = "";
async function snapshotDiario(raw: string): Promise<void> {
  const dia = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  if (ultimoSnapshotDia === dia) return; // ya se hizo hoy (chequeo barato en memoria)
  ultimoSnapshotDia = dia;
  try {
    await fs.mkdir(BACKUPS_DIR, { recursive: true });
    const destino = path.join(BACKUPS_DIR, `store-${dia}.json`);
    try {
      await fs.access(destino); // ya existe (otro proceso/reinicio): no sobrescribir
    } catch {
      await fs.writeFile(destino, raw, "utf-8");
    }
    // Poda: conserva solo los últimos N snapshots.
    const files = (await fs.readdir(BACKUPS_DIR))
      .filter((f) => /^store-\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .sort();
    for (const f of files.slice(0, Math.max(0, files.length - SNAPSHOTS_A_CONSERVAR))) {
      await fs.unlink(path.join(BACKUPS_DIR, f)).catch(() => {});
    }
  } catch {
    ultimoSnapshotDia = ""; // reintenta en el próximo write
  }
}

// ---- Secretos cifrados en el archivo de datos ----------------------------------
// En DISCO (store.json y sus copias) van cifrados con AES-256-GCM: el
// client_secret del API SIRE de cada cliente y las claves de integraciones de
// la configuración. En MEMORIA el resto del código los ve en claro: se
// descifran al leer el store y se cifran al escribirlo.
const SECRETOS_CONFIG = new Set(["browserWsUrl", "rttSecret", "capsolverKey", "proxyPass"]);
let avisoLlave = false;

function descifrarCampo(v: string): string {
  try { return descifrar(v); }
  catch {
    // Llave distinta a la que cifró (cambió VIGILANCIA_KEY/AUTH_SECRET): se deja
    // el dato cifrado tal cual (no se pierde si se restaura la llave).
    if (!avisoLlave) { avisoLlave = true; console.error("[seguridad] No se pudo descifrar un secreto guardado: ¿cambió VIGILANCIA_KEY o AUTH_SECRET?"); }
    return v;
  }
}

function descifrarSecretos(store: Store): void {
  for (const c of store.clientes ?? []) {
    if (c.credSire && esCifrado(c.credSire.clientSecret)) c.credSire.clientSecret = descifrarCampo(c.credSire.clientSecret);
  }
  const cfg = store.config as Record<string, unknown> | undefined;
  if (cfg) for (const k of Array.from(SECRETOS_CONFIG)) if (esCifrado(cfg[k])) cfg[k] = descifrarCampo(cfg[k] as string);
}

/** Serializa el store cifrando los secretos (sin tocar el objeto en memoria). */
function serializarStore(store: Store): string {
  return JSON.stringify(store, function (this: any, k: string, v: unknown) {
    if (typeof v !== "string" || !v || esCifrado(v)) return v;
    if (k === "clientSecret" && this && typeof this === "object" && "clientId" in this) return cifrar(v);
    if (this === store.config && SECRETOS_CONFIG.has(k)) return cifrar(v);
    return v;
  }, 2);
}

// ---- Transacciones sobre el store ---------------------------------------------
// Cada función que LEE → MODIFICA → ESCRIBE el store corre dentro de
// conBloqueoStore: una a la vez, en orden de llegada. Antes dos operaciones
// simultáneas leían la misma versión y la última en escribir borraba los
// cambios de la otra (p. ej. un pago acreditado o una empresa nueva). Es
// reentrante: si una transacción llama a otra, la interna corre directo.
// El estado vive en globalThis para que todas las rutas compartan el mismo
// candado aunque Next cargue el módulo más de una vez.
const gBloqueo = globalThis as unknown as { __radarCtxStore?: AsyncLocalStorage<boolean>; __radarColaStore?: Promise<void> };
const ctxStore: AsyncLocalStorage<boolean> = gBloqueo.__radarCtxStore ?? (gBloqueo.__radarCtxStore = new AsyncLocalStorage<boolean>());

export async function conBloqueoStore<T>(fn: () => Promise<T>): Promise<T> {
  if (ctxStore.getStore()) return fn(); // ya estamos dentro de una transacción
  const anterior = gBloqueo.__radarColaStore ?? Promise.resolve();
  let liberar!: () => void;
  const turno = new Promise<void>((r) => (liberar = r));
  gBloqueo.__radarColaStore = anterior.then(() => turno);
  await anterior;
  try {
    return await ctxStore.run(true, fn);
  } finally {
    liberar();
  }
}

// Cola simple: serializa las escrituras del store para evitar entrelazados.
let writeCola: Promise<void> = Promise.resolve();
async function writeStore(store: Store): Promise<void> {
  const tarea = writeCola.then(async () => {
    await ensureDirs();
    const raw = serializarStore(store);
    // Escritura ATÓMICA: temporal + rename (evita dejar el JSON a medio escribir
    // si dos escrituras coinciden, lo que corrompía el store).
    const tmp = `${STORE_PATH}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    await fs.writeFile(tmp, raw, "utf-8");
    await fs.rename(tmp, STORE_PATH);
    void snapshotDiario(raw);
  });
  // La cola no debe romperse si una escritura falla.
  writeCola = tarea.catch(() => {});
  return tarea;
}

export function newId(): string {
  return crypto.randomUUID();
}

/** Lista las empresas del usuario (o todas si no se pasa ownerId). */
export async function listClientes(ownerId?: string, opts: { todos?: boolean } = {}): Promise<Cliente[]> {
  const store = await readStore();
  let lista = ownerId
    ? store.clientes.filter((c) => c.ownerId === ownerId)
    : store.clientes;
  // MODO GRABACIÓN del dueño: solo las empresas de simulación (oculta las reales en
  // todas las listas, el dashboard y los selectores). `todos` lo ignora (tarea nocturna).
  if (ownerId && !opts.todos) {
    const dueno = store.users?.find((u) => u.id === ownerId);
    if (dueno?.modoGrabacionHasta && dueno.modoGrabacionHasta > new Date().toISOString()) lista = lista.filter((c) => c.demo);
  }
  return lista.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Habilita / quita el MODO SIMULACIÓN a una cuenta (por correo). Al habilitar le
 *  asigna el plan Empresas (todos los módulos salvo los utilitarios) sin vencimiento. */
export async function setPermisoDemo(email: string, activar: boolean): Promise<Usuario | null> {
  return conBloqueoStore(async () => {
  const store = await readStore();
  const e = email.trim().toLowerCase();
  const u = (store.users ?? []).find((x) => x.email.toLowerCase() === e && x.rol !== "supremo");
  if (!u) return null;
  if (activar) {
    u.permisoDemo = true;
    if (!u.parentId) { u.plan = "equipo"; u.planVence = undefined; }
  } else {
    delete u.permisoDemo;
    delete u.modoGrabacionHasta;
  }
  await writeStore(store);
  return u;
});
}

/** Cuentas con el modo simulación habilitado. */
export async function listPermisosDemo(): Promise<{ id: string; nombre: string; email: string; plan?: string }[]> {
  const store = await readStore();
  return (store.users ?? []).filter((u) => u.permisoDemo).map((u) => ({ id: u.id, nombre: u.nombre, email: u.email, plan: u.plan }));
}

/** Activa (por `horas`) o desactiva (null) el modo grabación de un usuario. */
export async function setModoGrabacion(userId: string, horas: number | null): Promise<string | null> {
  return conBloqueoStore(async () => {
  const store = await readStore();
  const u = store.users?.find((x) => x.id === userId);
  if (!u) return null;
  if (horas && horas > 0) u.modoGrabacionHasta = new Date(Date.now() + horas * 3600_000).toISOString();
  else delete u.modoGrabacionHasta;
  await writeStore(store);
  return u.modoGrabacionHasta ?? null;
});
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

// ---- Registro GLOBAL de RUCs (unicidad en toda la plataforma) --------------

/** ¿Quién tiene tomado este RUC en toda la plataforma? Devuelve el estudio dueño
 *  o null si está libre. Considera el registro global y, por compatibilidad, los
 *  clientes ya existentes (aunque sean previos al registro). */
export async function duenoDeRuc(
  ruc: string
): Promise<{ studioId: string; ownerNombre?: string } | null> {
  return conBloqueoStore(async () => {
  const store = await readStore();
  const r = ruc.trim();
  const reg = store.rucsRegistrados?.[r];
  if (reg) {
    // Auto-limpieza: si el registro apunta a un estudio o cliente que ya NO
    // existe (huérfano de una eliminación previa), se libera el RUC.
    const estudioVive = (store.users ?? []).some((u) => u.id === reg.studioId);
    // La empresa del dueño sigue viva (la copia de otro, p. ej. del supremo, no cuenta).
    const clienteVive = store.clientes.some((c) => c.id === reg.clienteId || (c.ruc === r && c.ownerId === reg.studioId));
    if (estudioVive && clienteVive) return { studioId: reg.studioId, ownerNombre: reg.ownerNombre };
    delete store.rucsRegistrados![r];
    await writeStore(store);
  }
  // Compatibilidad (empresas previas al registro global). Las copias del
  // supremo no adueñan el RUC: no bloquean a los demás usuarios.
  // Copias del supremo y de la cuenta "Utilitarios RTP": no adueñan el RUC.
  const supremos = new Set((store.users ?? []).filter((u) => u.rol === "supremo" || u.soloRtp === true).map((u) => u.id));
  const c = store.clientes.find((x) => x.ruc === r && x.ownerId && !supremos.has(x.ownerId) && (store.users ?? []).some((u) => u.id === x.ownerId));
  if (c && c.ownerId) return { studioId: c.ownerId };
  return null;
});
}

/** Marca el RUC como tomado por un estudio (idempotente). */
export async function registrarRucGlobal(
  ruc: string,
  studioId: string,
  clienteId: string,
  ownerNombre?: string
): Promise<void> {
  return conBloqueoStore(async () => {
  const store = await readStore();
  if (!store.rucsRegistrados) store.rucsRegistrados = {};
  store.rucsRegistrados[ruc.trim()] = { studioId, clienteId, ownerNombre, at: new Date().toISOString() };
  await writeStore(store);
});
}

/** Libera un RUC del registro global (al eliminar la empresa). Si se indica
 *  `clienteId`, solo lo libera si el registro es de ESA empresa (borrar la copia
 *  del supremo no libera el RUC del dueño). */
export async function liberarRucGlobal(ruc: string, clienteId?: string): Promise<void> {
  return conBloqueoStore(async () => {
  const store = await readStore();
  const reg = store.rucsRegistrados?.[ruc.trim()];
  if (reg && (!clienteId || reg.clienteId === clienteId)) {
    delete store.rucsRegistrados![ruc.trim()];
    await writeStore(store);
  }
});
}

/** Guarda las credenciales SIRE del cliente (sin la Clave SOL). */
export async function setCredSire(
  clienteId: string,
  cred: CredencialesSire
): Promise<Cliente | null> {
  return conBloqueoStore(async () => {
  const store = await readStore();
  const cliente = store.clientes.find((c) => c.id === clienteId);
  if (!cliente) return null;
  cliente.credSire = cred;
  await writeStore(store);
  return cliente;
});
}

export async function createCliente(data: {
  razonSocial: string;
  ruc: string;
  email: string;
  telefono: string;
  sunat?: SunatInfo | null;
  ownerId?: string;
  negocio?: "con" | "sin";
}): Promise<Cliente> {
  return conBloqueoStore(async () => {
  const store = await readStore();
  const cliente: Cliente = {
    id: newId(),
    ownerId: data.ownerId,
    razonSocial: data.razonSocial.trim(),
    ruc: data.ruc.trim(),
    negocio: /^(10|15)/.test(data.ruc.trim()) ? (data.negocio === "sin" ? "sin" : data.negocio === "con" ? "con" : undefined) : undefined,
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
});
}

/** Guarda el último reporte de ITF consultado (para mostrarlo en el informe). */
export async function setItfReporte(clienteId: string, itf: { ejercicio: string; filas: any[]; total: number } | null): Promise<void> {
  return conBloqueoStore(async () => {
  const store = await readStore();
  const cliente = store.clientes.find((c) => c.id === clienteId);
  if (!cliente) return;
  cliente.itf = itf ? { ...itf, consultadoEn: new Date().toISOString() } : null;
  await writeStore(store);
});
}

export async function updateCliente(
  id: string,
  patch: Partial<Pick<Cliente, "razonSocial" | "ruc" | "email" | "telefono" | "negocio">>
): Promise<Cliente | null> {
  return conBloqueoStore(async () => {
  const store = await readStore();
  const cliente = store.clientes.find((c) => c.id === id);
  if (!cliente) return null;
  // Lista blanca: solo estos campos (antes se copiaba cualquier cosa del cuerpo).
  const { negocio, razonSocial, ruc, email, telefono } = patch as any;
  if (typeof razonSocial === "string" && razonSocial.trim()) cliente.razonSocial = razonSocial.trim().slice(0, 200);
  if (typeof email === "string") cliente.email = email.trim().slice(0, 200);
  if (typeof telefono === "string") cliente.telefono = telefono.trim().slice(0, 50);
  if (typeof ruc === "string" && /^\d{11}$/.test(ruc.trim()) && ruc.trim() !== cliente.ruc) {
    // Cambio de RUC (se había registrado otra empresa por error): los datos
    // traídos de SUNAT eran del RUC anterior, se limpian.
    cliente.ruc = ruc.trim();
    cliente.sunat = null;
    cliente.diagnostico = null;
    cliente.sire = [];
    cliente.buzon = null;
    cliente.sireEstado = null;
    delete cliente.sireDetalle;
    delete cliente.buzonAdjuntos;
    cliente.deudasF36 = null;
    cliente.itf = null;
    if (!/^(10|15)/.test(cliente.ruc)) delete cliente.negocio;
  }
  // "negocio" (con/sin) solo aplica a persona natural (RUC 10 o 15).
  if (negocio !== undefined) {
    if (/^(10|15)/.test(cliente.ruc) && (negocio === "con" || negocio === "sin")) cliente.negocio = negocio;
  }
  await writeStore(store);
  return cliente;
});
}

export async function deleteCliente(id: string): Promise<boolean> {
  return conBloqueoStore(async () => {
  const store = await readStore();
  const before = store.clientes.length;
  store.clientes = store.clientes.filter((c) => c.id !== id);
  if (store.clientes.length === before) return false;
  await writeStore(store);
  return true;
});
}

export async function setSunatInfo(
  clienteId: string,
  sunat: SunatInfo
): Promise<Cliente | null> {
  return conBloqueoStore(async () => {
  const store = await readStore();
  const cliente = store.clientes.find((c) => c.id === clienteId);
  if (!cliente) return null;
  // Preserva las fechas ingresadas a mano (decolecta no las entrega): si la
  // nueva consulta no trae inscripción/inicio, conserva las que ya había.
  cliente.sunat = {
    ...sunat,
    fechaInscripcion: sunat.fechaInscripcion ?? cliente.sunat?.fechaInscripcion,
    fechaInicioActividades: sunat.fechaInicioActividades ?? cliente.sunat?.fechaInicioActividades,
  };
  await writeStore(store);
  return cliente;
});
}

/** Actualiza SOLO las fechas (inscripción / inicio de actividades) del SUNAT del
 *  cliente, sin re-consultar. decolecta no las entrega → se ingresan a mano. */
export async function setFechasSunat(
  clienteId: string,
  fechas: { fechaInscripcion?: string; fechaInicioActividades?: string }
): Promise<Cliente | null> {
  return conBloqueoStore(async () => {
  const store = await readStore();
  const cliente = store.clientes.find((c) => c.id === clienteId);
  if (!cliente || !cliente.sunat) return null;
  if (fechas.fechaInscripcion !== undefined) cliente.sunat.fechaInscripcion = fechas.fechaInscripcion || undefined;
  if (fechas.fechaInicioActividades !== undefined) cliente.sunat.fechaInicioActividades = fechas.fechaInicioActividades || undefined;
  await writeStore(store);
  return cliente;
});
}

export async function addDocumento(
  clienteId: string,
  doc: Documento
): Promise<Cliente | null> {
  return conBloqueoStore(async () => {
  const store = await readStore();
  const cliente = store.clientes.find((c) => c.id === clienteId);
  if (!cliente) return null;
  cliente.documentos.push(doc);
  await writeStore(store);
  return cliente;
});
}

export async function updateDocumento(
  clienteId: string,
  docId: string,
  patch: Partial<Documento>
): Promise<Documento | null> {
  return conBloqueoStore(async () => {
  const store = await readStore();
  const cliente = store.clientes.find((c) => c.id === clienteId);
  if (!cliente) return null;
  const doc = cliente.documentos.find((d) => d.id === docId);
  if (!doc) return null;
  Object.assign(doc, patch);
  await writeStore(store);
  return doc;
});
}

export async function setSireResumen(
  clienteId: string,
  resumen: SireResumen
): Promise<Cliente | null> {
  return conBloqueoStore(async () => {
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
});
}

export async function setSireDetalleCache(
  clienteId: string,
  tipo: "ventas" | "compras",
  periodo: string,
  bloque: { columnas: string[]; filas: string[][]; comprobantes: number }
): Promise<void> {
  return conBloqueoStore(async () => {
  const store = await readStore();
  const cliente = store.clientes.find((c) => c.id === clienteId);
  if (!cliente) return;
  if (!cliente.sireDetalle) cliente.sireDetalle = {};
  cliente.sireDetalle[`${tipo}-${periodo}`] = { ...bloque, at: new Date().toISOString() };
  await writeStore(store);
});
}

export async function addDeclaracion(
  clienteId: string,
  decl: DeclaracionMensual
): Promise<Cliente | null> {
  return conBloqueoStore(async () => {
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
});
}

export async function deleteDeclaracion(
  clienteId: string,
  declId: string
): Promise<Cliente | null> {
  return conBloqueoStore(async () => {
  const store = await readStore();
  const cliente = store.clientes.find((c) => c.id === clienteId);
  if (!cliente) return null;
  cliente.declaraciones = (cliente.declaraciones ?? []).filter((d) => d.id !== declId);
  await writeStore(store);
  return cliente;
});
}

export async function addDeclaracionAnual(
  clienteId: string,
  decl: DeclaracionAnual
): Promise<Cliente | null> {
  return conBloqueoStore(async () => {
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
});
}

export async function deleteDeclaracionAnual(
  clienteId: string,
  declId: string
): Promise<Cliente | null> {
  return conBloqueoStore(async () => {
  const store = await readStore();
  const cliente = store.clientes.find((c) => c.id === clienteId);
  if (!cliente) return null;
  cliente.declaracionesAnuales = (cliente.declaracionesAnuales ?? []).filter(
    (d) => d.id !== declId
  );
  await writeStore(store);
  return cliente;
});
}

export async function addDeuda(clienteId: string, deuda: Deuda): Promise<Cliente | null> {
  return conBloqueoStore(async () => {
  const store = await readStore();
  const cliente = store.clientes.find((c) => c.id === clienteId);
  if (!cliente) return null;
  if (!Array.isArray(cliente.deudas)) cliente.deudas = [];
  cliente.deudas.unshift(deuda);
  await writeStore(store);
  return cliente;
});
}

export async function deleteDeuda(clienteId: string, deudaId: string): Promise<Cliente | null> {
  return conBloqueoStore(async () => {
  const store = await readStore();
  const cliente = store.clientes.find((c) => c.id === clienteId);
  if (!cliente) return null;
  cliente.deudas = (cliente.deudas ?? []).filter((d) => d.id !== deudaId);
  await writeStore(store);
  return cliente;
});
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
  return conBloqueoStore(async () => {
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
});
}

/** Registra una descarga (incluida la servida desde caché): actualiza la fecha
 *  y quién la hizo. Devuelve la metadata actualizada (o null si no existe). */
export async function registrarDescargaBuzon(
  clienteId: string,
  codMensaje: string,
  usuario?: { id: string; nombre: string }
): Promise<{ descargadaAt: string; descargadoPorNombre?: string } | null> {
  return conBloqueoStore(async () => {
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
});
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
  return conBloqueoStore(async () => {
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
});
}

/** Marca el pedido de deuda recién generado (queda "en proceso" en SUNAT). */
export async function setDeudaGenerado(
  clienteId: string,
  info?: { numPedido?: string; fechaPedido?: string }
): Promise<void> {
  return conBloqueoStore(async () => {
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
});
}

/** Actualiza el ESTADO del pedido (trazabilidad de la fase asíncrona). */
export async function setDeudaEstadoF36(
  clienteId: string,
  info: { estado: "sin-pedido" | "en-proceso" | "listo" | "vencido"; numPedido?: string; fechaPedido?: string; estadoTexto?: string; accion?: string }
): Promise<Cliente | null> {
  return conBloqueoStore(async () => {
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
});
}

export async function clearSire(clienteId: string): Promise<Cliente | null> {
  return conBloqueoStore(async () => {
  const store = await readStore();
  const cliente = store.clientes.find((c) => c.id === clienteId);
  if (!cliente) return null;
  cliente.sire = [];
  await writeStore(store);
  return cliente;
});
}

// ---- Seguimiento de mensajes del buzón (plazo de atención + comentario) ----

const MS_DIA = 24 * 60 * 60 * 1000;

export async function setSeguimientoBuzon(
  clienteId: string,
  datos: { codMensaje: string; asunto: string; fecha: string; origen?: "notificaciones" | "mensajes"; diasAtencion: number; comentario: string; creadoPorId?: string; creadoPorNombre?: string }
): Promise<SeguimientoBuzon | null> {
  return conBloqueoStore(async () => {
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
});
}

export async function atenderSeguimientoBuzon(
  clienteId: string,
  codMensaje: string,
  atendido: boolean
): Promise<boolean> {
  return conBloqueoStore(async () => {
  const store = await readStore();
  const cliente = store.clientes.find((c) => c.id === clienteId);
  const seg = cliente?.seguimientosBuzon?.find((s) => s.codMensaje === codMensaje);
  if (!seg) return false;
  seg.atendido = atendido;
  await writeStore(store);
  return true;
});
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
      // Comentario sin plazo (diasAtencion=0) NO genera recordatorio.
      if (s.atendido || !(s.diasAtencion > 0)) continue;
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
  return conBloqueoStore(async () => {
  const store = await readStore();
  const cliente = store.clientes.find((c) => c.id === clienteId);
  if (!cliente) return null;
  cliente.buzon = buzon;
  await writeStore(store);
  return cliente;
});
}

// Fecha de un mensaje del buzón ("dd/mm/aaaa hh:mm:ss" o ISO) → epoch, para ordenar.
function tsMensaje(f: string): number {
  const s = String(f || "").trim();
  const m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)).getTime();
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : 0;
}

/**
 * FUSIONA los mensajes recién consultados con los ya guardados (el buzón es un
 * HISTORIAL: nunca se pierde lo anterior; cada actualización solo AGREGA los
 * nuevos). Devuelve los mensajes nuevos (no vistos antes) y el total acumulado.
 */
export async function mergeBuzon(
  clienteId: string,
  recientes: BuzonMensaje[],
  consultadoAt = new Date().toISOString()
): Promise<{ nuevos: BuzonMensaje[]; mensajes: BuzonMensaje[]; cliente: Cliente | null }> {
  return conBloqueoStore(async () => {
  const store = await readStore();
  const cliente = store.clientes.find((c) => c.id === clienteId);
  if (!cliente) return { nuevos: [], mensajes: [], cliente: null };
  const previos = cliente.buzon?.mensajes?.length
    ? cliente.buzon.mensajes
    : [...(cliente.buzon?.peligrosos ?? []), ...(cliente.buzon?.urgentes ?? [])];
  const porId = new Map<string, BuzonMensaje>();
  for (const m of previos) if (m?.id) porId.set(m.id, m);
  const nuevos: BuzonMensaje[] = [];
  for (const m of recientes) {
    if (!m?.id) continue;
    if (!porId.has(m.id)) nuevos.push(m);
    porId.set(m.id, { ...(porId.get(m.id) ?? {}), ...m }); // lo reciente refresca leído/adjuntos
  }
  const mensajes = Array.from(porId.values())
    .sort((a, b) => tsMensaje(b.fecha) - tsMensaje(a.fecha))
    .slice(0, 1000);
  cliente.buzon = {
    mensajes,
    peligrosos: mensajes.filter((m) => m.nivel === "peligroso"),
    urgentes: mensajes.filter((m) => m.nivel === "urgente"),
    totalMensajes: mensajes.length,
    consultadoAt,
  };
  await writeStore(store);
  return { nuevos, mensajes, cliente };
});
}

/** Guarda el estado de presentación SIRE (presentado/no presentado por periodo). */
export async function setSireEstado(
  clienteId: string,
  estados: { periodo: string; presentadoVentas: boolean | null; presentadoCompras: boolean | null }[],
  noObligado?: boolean
): Promise<Cliente | null> {
  return conBloqueoStore(async () => {
  const store = await readStore();
  const cliente = store.clientes.find((c) => c.id === clienteId);
  if (!cliente) return null;
  cliente.sireEstado = { estados, noObligado: Boolean(noObligado), at: new Date().toISOString() };
  await writeStore(store);
  return cliente;
});
}

export async function setDiagnostico(
  clienteId: string,
  diagnostico: Diagnostico
): Promise<Cliente | null> {
  return conBloqueoStore(async () => {
  const store = await readStore();
  const cliente = store.clientes.find((c) => c.id === clienteId);
  if (!cliente) return null;
  cliente.diagnostico = diagnostico;
  await writeStore(store);
  return cliente;
});
}

// ---- Visor Tributario (extensión de navegador) -----------------------------

export interface VisorCaptura {
  id: string;
  userId: string;
  at: string;
  url: string;
  titulo: string;
  tipo: string;        // "sire" | "dj-mensual" | "dj-anual" | "otro"
  resumen?: string;    // línea corta interpretada
  texto?: string;      // texto crudo capturado (recortado)
  datos?: any;         // JSON capturado de la respuesta de SUNAT (si hubo)
}

// Token STATELESS: derivado del userId + AUTH_SECRET (no se guarda en el store,
// así no hay carrera de escritura que lo pierda). Formato: <userIdB64url>.<hmac>.
const VISOR_SECRET = process.env.AUTH_SECRET || "radar-visor-secret-fallback";
function visorTokenFor(userId: string): string {
  const uid = Buffer.from(userId).toString("base64url");
  const mac = crypto.createHmac("sha256", VISOR_SECRET).update("visor:" + userId).digest("hex").slice(0, 24);
  return `${uid}.${mac}`;
}

/** Token del Visor del usuario (estable, no se persiste). */
export async function getVisorToken(userId: string): Promise<string> {
  return visorTokenFor(userId);
}

/** Stateless: no hay rotación real; devuelve el mismo token. */
export async function rotarVisorToken(userId: string): Promise<string> {
  return visorTokenFor(userId);
}

/** Usuario dueño de un token (verifica el HMAC). */
export async function visorUserByToken(token: string): Promise<string | null> {
  const [uid64, mac] = (token || "").trim().split(".");
  if (!uid64 || !mac) return null;
  let userId = "";
  try { userId = Buffer.from(uid64, "base64url").toString("utf8"); } catch { return null; }
  if (!userId) return null;
  const exp = crypto.createHmac("sha256", VISOR_SECRET).update("visor:" + userId).digest("hex").slice(0, 24);
  return exp === mac ? userId : null;
}

/** Guarda una captura (máx. 200 por usuario). */
export async function addVisorCaptura(c: Omit<VisorCaptura, "id" | "at">): Promise<VisorCaptura> {
  return conBloqueoStore(async () => {
  const store = await readStore();
  if (!store.visor) store.visor = {};
  if (!store.visor.capturas) store.visor.capturas = [];
  const cap: VisorCaptura = { ...c, id: crypto.randomUUID(), at: new Date().toISOString() };
  store.visor.capturas.unshift(cap);
  // Poda: conserva las últimas 200 de este usuario.
  const suyas = store.visor.capturas.filter((x) => x.userId === cap.userId);
  if (suyas.length > 200) {
    const sobran = new Set(suyas.slice(200).map((x) => x.id));
    store.visor.capturas = store.visor.capturas.filter((x) => !sobran.has(x.id));
  }
  await writeStore(store);
  return cap;
});
}

export async function listVisorCapturas(userId: string): Promise<VisorCaptura[]> {
  const store = await readStore();
  return (store.visor?.capturas ?? []).filter((c) => c.userId === userId);
}

export async function clearVisorCapturas(userId: string): Promise<void> {
  return conBloqueoStore(async () => {
  const store = await readStore();
  if (!store.visor?.capturas) return;
  store.visor.capturas = store.visor.capturas.filter((c) => c.userId !== userId);
  await writeStore(store);
});
}

// ---- Visor: matriz año×mes (SIRE / DJ mensual / DJ anual) -------------------

export interface VisorMatriz {
  empresa: string;
  ruc: string;
  tipo: string;                              // "sire" | "dj-mensual" | "dj-anual"
  celdas: Record<string, "P" | "NP">;        // "YYYY-MM" -> Presentó / No Presentó
  anios: Record<string, "P" | "NP">;         // "YYYY" -> estado a nivel año
  at: string;
}

const claveMatriz = (empresa: string, ruc: string, tipo: string) =>
  `${(empresa || ruc || "?").trim().toLowerCase()}|${tipo}`;

const clonMatriz = (m: VisorMatriz): VisorMatriz =>
  ({ empresa: m.empresa, ruc: m.ruc, tipo: m.tipo, celdas: { ...m.celdas }, anios: { ...m.anios }, at: m.at });

/** Funde `extra` dentro de `base`. Lo más reciente (por `at`) gana en las celdas en conflicto. */
function fundirMatriz(base: VisorMatriz, extra: VisorMatriz) {
  const extraNuevo = (extra.at || "") >= (base.at || "");
  for (const [k, v] of Object.entries(extra.celdas)) if (!(k in base.celdas) || extraNuevo) base.celdas[k] = v;
  for (const [k, v] of Object.entries(extra.anios)) if (!(k in base.anios) || extraNuevo) base.anios[k] = v;
  if (!base.empresa && extra.empresa) base.empresa = extra.empresa;
  if (!base.ruc && extra.ruc) base.ruc = extra.ruc;
  if ((extra.at || "") > (base.at || "")) base.at = extra.at;
}

/**
 * Normaliza la matriz: una sola entrada por empresa+tipo. Las capturas "sin
 * identificar" (sin empresa/RUC) se pegan a la entrada identificada más reciente
 * del mismo tipo — así el SIRE o la DJ mensual nunca quedan partidos en dos filas.
 * Devuelve las identificadas primero (empresa detectada = al inicio).
 */
function coalesceMatriz(lista: VisorMatriz[]): VisorMatriz[] {
  const porTipo = new Map<string, VisorMatriz[]>();
  for (const m of lista) (porTipo.get(m.tipo) ?? porTipo.set(m.tipo, []).get(m.tipo)!).push(m);

  const out: VisorMatriz[] = [];
  for (const [tipo, arr] of porTipo) {
    const ord = [...arr].sort((a, b) => (a.at || "").localeCompare(b.at || "")); // viejo → nuevo
    const ident = new Map<string, VisorMatriz>();
    const sinId: VisorMatriz[] = [];
    for (const m of ord) {
      if (m.empresa || m.ruc) {
        const k = claveMatriz(m.empresa, m.ruc, tipo);
        const base = ident.get(k);
        if (base) fundirMatriz(base, m); else ident.set(k, clonMatriz(m));
      } else sinId.push(m);
    }
    const identArr = [...ident.values()];
    if (sinId.length) {
      const destino = [...identArr].sort((a, b) => (b.at || "").localeCompare(a.at || ""))[0];
      if (destino) { for (const s of sinId) fundirMatriz(destino, s); }
      else { const base = clonMatriz(sinId[0]); for (const s of sinId.slice(1)) fundirMatriz(base, s); out.push(base); }
    }
    out.push(...identArr);
  }
  // Identificadas primero, luego alfabético por empresa.
  return out.sort((a, b) => {
    const ai = a.empresa || a.ruc ? 0 : 1, bi = b.empresa || b.ruc ? 0 : 1;
    if (ai !== bi) return ai - bi;
    return (a.empresa || a.ruc).localeCompare(b.empresa || b.ruc) || a.tipo.localeCompare(b.tipo);
  });
}

/** Mezcla (upsert) lo que envió la extensión en la matriz del usuario. */
export async function upsertVisorMatriz(userId: string, d: {
  empresa?: string; ruc?: string; tipo?: string;
  celdas?: Record<string, "P" | "NP">; anios?: Record<string, "P" | "NP">;
}): Promise<VisorMatriz> {
  return conBloqueoStore(async () => {
  const store = await readStore();
  if (!store.visor) store.visor = {};
  if (!store.visor.matriz) store.visor.matriz = {};
  const lista = store.visor.matriz[userId] ?? (store.visor.matriz[userId] = []);
  const empresa = (d.empresa || "").trim();
  const ruc = (d.ruc || "").trim();
  const tipo = d.tipo || "sire";
  const identificado = Boolean(empresa || ruc);
  const clave = claveMatriz(empresa, ruc, tipo);
  // Objetivo: entrada de la misma empresa+tipo; si esta captura no trae empresa,
  // reutiliza la última entrada identificada del mismo tipo (evita duplicar).
  let m = identificado ? lista.find((x) => x.tipo === tipo && claveMatriz(x.empresa, x.ruc, tipo) === clave) : null;
  // Solo una captura SIN empresa se funde con la última identificada; una empresa
  // nueva tiene su propia fila (antes se mezclaba con la de otra empresa).
  if (!m && !identificado) {
    const mismos = lista.filter((x) => x.tipo === tipo);
    m = mismos.find((x) => x.empresa || x.ruc) || mismos[mismos.length - 1] || null;
  }
  if (!m) { m = { empresa, ruc, tipo, celdas: {}, anios: {}, at: "" }; lista.push(m); }
  if (empresa && !m.empresa) m.empresa = empresa;
  if (ruc && !m.ruc) m.ruc = ruc;
  Object.assign(m.celdas, d.celdas ?? {});
  Object.assign(m.anios, d.anios ?? {});
  m.at = new Date().toISOString();
  // Normaliza: una fila por empresa+tipo; lo "sin identificar" se funde con la
  // empresa detectada y las identificadas quedan al inicio.
  const limpia = coalesceMatriz(lista);
  store.visor.matriz[userId] = limpia.length > 40 ? limpia.slice(-40) : limpia;
  await writeStore(store);
  const claveM = claveMatriz(m.empresa, m.ruc, tipo);
  return store.visor.matriz[userId].find((x) => x.tipo === tipo && claveMatriz(x.empresa, x.ruc, tipo) === claveM) || m;
});
}

export async function getVisorMatriz(userId: string): Promise<VisorMatriz[]> {
  const store = await readStore();
  const lista = coalesceMatriz(store.visor?.matriz?.[userId] ?? []);
  // MODO GRABACIÓN: solo los cuadros de las empresas de simulación.
  const u = store.users?.find((x) => x.id === userId);
  if (u?.modoGrabacionHasta && u.modoGrabacionHasta > new Date().toISOString()) return lista.filter((m) => esRucDemo(String(m.ruc ?? "")));
  return lista;
}

export async function clearVisorMatriz(userId: string): Promise<void> {
  return conBloqueoStore(async () => {
  const store = await readStore();
  if (store.visor?.matriz) { delete store.visor.matriz[userId]; await writeStore(store); }
});
}
