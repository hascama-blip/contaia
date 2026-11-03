import { Client } from "pg";
import { promises as fs } from "fs";
import path from "path";
import { DATA_DIR, STORE_PATH, BACKUPS_DIR } from "./db";
import type { Cliente, Usuario, BuzonMensaje } from "./types";

// ============================================================
//  Importar la base Postgres de la web VIEJA (AWS/RDS) al store.json
// ============================================================
// La versión anterior guardaba en Postgres con las tablas de db/schema.sql
// (usuarios, clientes, cred_sire, sire_resumenes, buzon_*, declaraciones_*,
// deudas, cuentas_proveedor, acciones, rucs_registrados, config). Este módulo
// se conecta con la URL de esa base, lee lo que exista (tolera tablas o
// columnas que falten) y arma el objeto Store de la web nueva. Los archivos
// (PDFs) no están en la base: se restauran aparte con el ZIP de uploads.

export interface ResumenTablas { tabla: string; filas: number; columnas: string[] }
export interface ResultadoImport {
  usuarios: number; clientes: number; mensajesBuzon: number; seguimientos: number;
  declaraciones: number; declaracionesAnuales: number; deudas: number; acciones: number;
  cuentasProveedor: number; rucsRegistrados: number;
  tablasLeidas: string[]; tablasAusentes: string[]; avisos: string[];
}

const camel = (s: string) => s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
const iso = (v: any): string | undefined => (v == null ? undefined : v instanceof Date ? v.toISOString() : String(v));
const num = (v: any): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const json = (v: any): any => { if (v == null) return v; if (typeof v === "string") { try { return JSON.parse(v); } catch { return v; } } return v; };
/** Fila de Postgres → objeto camelCase con fechas ISO y jsonb parseado. */
function fila(row: Record<string, any>): Record<string, any> {
  const o: Record<string, any> = {};
  for (const [k, v] of Object.entries(row)) o[camel(k)] = v instanceof Date ? v.toISOString() : json(v);
  return o;
}

async function conectar(url: string): Promise<Client> {
  const ssl = /sslmode=disable/i.test(url) ? undefined : { rejectUnauthorized: false };
  const c = new Client({ connectionString: url, ssl, connectionTimeoutMillis: 15000, statement_timeout: 120000 });
  await c.connect();
  return c;
}

/** Solo prueba: lista las bases del servidor y, de la base conectada, sus tablas,
 *  filas y columnas (para ver si el esquema coincide). Si la base de la URL no
 *  existe, reintenta contra "postgres" solo para poder listar las bases. */
export async function inspeccionarPostgres(url: string): Promise<{ version: string; baseConectada: string; bases: string[]; tablas: ResumenTablas[]; aviso?: string }> {
  let c: Client;
  let aviso: string | undefined;
  try { c = await conectar(url); }
  catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!/does not exist/i.test(msg)) throw e;
    // La base indicada no existe: conectar a "postgres" para listar las que hay.
    const u = new URL(url);
    u.pathname = "/postgres";
    c = await conectar(u.toString());
    aviso = `${msg}. Estas son las bases que sí existen; cambia el nombre al final de la URL.`;
  }
  try {
    const v = await c.query("select version()");
    let baseConectada = "";
    let bases: string[] = [];
    try { baseConectada = String((await c.query("select current_database() as db")).rows[0]?.db ?? ""); } catch { /* */ }
    try { bases = (await c.query("select datname from pg_database where not datistemplate and datname <> 'rdsadmin' order by 1")).rows.map((r: any) => String(r.datname)); } catch { /* */ }
    const t = await c.query(`select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by 1`);
    const tablas: ResumenTablas[] = [];
    for (const r of t.rows) {
      const tabla = String(r.table_name);
      const cols = await c.query(`select column_name from information_schema.columns where table_schema='public' and table_name=$1 order by ordinal_position`, [tabla]);
      let filas = 0;
      try { filas = Number((await c.query(`select count(*)::int as n from "${tabla}"`)).rows[0]?.n ?? 0); } catch { /* */ }
      tablas.push({ tabla, filas, columnas: cols.rows.map((x: any) => String(x.column_name)) });
    }
    return { version: String(v.rows[0]?.version ?? "").split(" on ")[0], baseConectada, bases, tablas, aviso };
  } finally { await c.end().catch(() => {}); }
}

/**
 * Lee la base vieja y devuelve el Store listo. No escribe nada en disco: eso lo
 * hace `aplicarImport` (con copia previa del store actual).
 */
export async function leerStoreDesdePostgres(url: string): Promise<{ store: any; resumen: ResultadoImport }> {
  const c = await conectar(url);
  const existentes = new Set<string>(
    (await c.query(`select table_name from information_schema.tables where table_schema='public'`)).rows.map((r: any) => String(r.table_name))
  );
  const leidas: string[] = []; const ausentes: string[] = []; const avisos: string[] = [];
  const tabla = async (nombre: string, orden = ""): Promise<Record<string, any>[]> => {
    if (!existentes.has(nombre)) { ausentes.push(nombre); return []; }
    leidas.push(nombre);
    try { return (await c.query(`select * from "${nombre}" ${orden}`)).rows.map(fila); }
    catch (e) { avisos.push(`${nombre}: ${e instanceof Error ? e.message : "error al leer"}`); return []; }
  };

  try {
    // ---- Usuarios ----
    const users: Usuario[] = (await tabla("usuarios", "order by created_at")).map((r) => {
      const u: any = {
        id: String(r.id), nombre: r.nombre ?? "", email: String(r.email ?? "").toLowerCase(), passHash: r.passHash ?? "",
        createdAt: r.createdAt ?? new Date().toISOString(), rol: r.rol ?? "admin",
        parentId: r.parentId ?? undefined, estado: r.estado ?? undefined, decididoAt: r.decididoAt ?? undefined,
        modulos: Array.isArray(r.modulos) ? r.modulos : undefined,
        resetTokenHash: r.resetTokenHash ?? undefined, resetTokenExp: r.resetTokenExp ?? undefined,
        usosGratis: r.usosGratisDesde ? { usados: num(r.usosGratisUsados), desde: r.usosGratisDesde } : undefined,
      };
      // Columnas que pueden existir en versiones posteriores del esquema.
      for (const k of ["plan", "planVence", "soloRtp", "emailVerificado", "alertas"]) if (r[k] != null) u[k] = r[k];
      // La web vieja marcaba "puede_crear_equipo"; en la nueva eso es el Plan de Equipo.
      if (r.puedeCrearEquipo === true) u.plan = "equipo";
      if (u.rol === "supremo") u.estado = "aprobado";
      return u;
    });
    // Usos gratis por módulo (tabla aparte en la web vieja) → cupo único por estudio.
    const usos = new Map<string, { usados: number; desde: string }>();
    for (const r of await tabla("usos_gratis")) {
      const k = String(r.studioId ?? "");
      const prev = usos.get(k) ?? { usados: 0, desde: r.desde ?? new Date().toISOString() };
      prev.usados += num(r.usados);
      if (r.desde && r.desde < prev.desde) prev.desde = r.desde;
      usos.set(k, prev);
    }
    for (const u of users) { const x = usos.get(u.id); if (x && !u.usosGratis) u.usosGratis = x; }

    // ---- Clientes ----
    const clientes: Cliente[] = (await tabla("clientes", "order by created_at")).map((r) => ({
      id: String(r.id), ownerId: r.ownerId ?? undefined, razonSocial: r.razonSocial ?? "", ruc: String(r.ruc ?? "").trim(),
      negocio: r.negocio ?? undefined, email: r.email ?? "", telefono: r.telefono ?? "", createdAt: r.createdAt ?? new Date().toISOString(),
      sunat: r.sunat ?? null, documentos: [], diagnostico: r.diagnostico ?? null, sire: [], buzon: null,
      itf: r.itf ?? null,
      declaraciones: [], declaracionesAnuales: [], deudas: [], credSire: null,
    }));
    const porId = new Map(clientes.map((c) => [c.id, c]));
    const de = (r: Record<string, any>) => porId.get(String(r.clienteId));

    // ---- Credenciales SIRE (sin Clave SOL) ----
    for (const r of await tabla("cred_sire")) { const cl = de(r); if (cl) cl.credSire = { solUser: r.solUser ?? "", clientId: r.clientId ?? "", clientSecret: r.clientSecret ?? "", guardadoAt: r.guardadoAt ?? new Date().toISOString() }; }

    // ---- SIRE resúmenes ----
    for (const r of await tabla("sire_resumenes", "order by periodo")) {
      const cl = de(r); if (!cl) continue;
      cl.sire.push({
        periodo: String(r.periodo).trim(),
        ventas: { comprobantes: num(r.vComprobantes), baseImponible: num(r.vBase), igv: num(r.vIgv), inafectoExonerado: num(r.vInafecto), importeTotal: num(r.vTotal) },
        compras: { comprobantes: num(r.cComprobantes), baseImponible: num(r.cBase), igv: num(r.cIgv), inafectoExonerado: num(r.cInafecto), importeTotal: num(r.cTotal) },
        presentadoVentas: Boolean(r.presentadoVentas), presentadoCompras: Boolean(r.presentadoCompras),
        fuente: r.fuente === "simulado" ? "simulado" : "oficial", consultadoAt: r.consultadoAt ?? new Date().toISOString(),
      });
    }
    // ---- SIRE estado presentado ----
    const estados = new Map<string, { estados: any[]; at: string }>();
    for (const r of await tabla("sire_estados", "order by periodo")) {
      const cl = de(r); if (!cl) continue;
      const e = estados.get(cl.id) ?? { estados: [], at: "" };
      e.estados.push({ periodo: String(r.periodo).trim(), presentadoVentas: r.presentadoVentas ?? null, presentadoCompras: r.presentadoCompras ?? null });
      if ((r.consultadoAt ?? "") > e.at) e.at = r.consultadoAt;
      estados.set(cl.id, e);
    }
    for (const [id, e] of estados) { const cl = porId.get(id); if (cl) cl.sireEstado = { estados: e.estados, at: e.at || new Date().toISOString() }; }

    // ---- Buzón ----
    let nMensajes = 0;
    const buz = new Map<string, { mensajes: BuzonMensaje[]; at: string }>();
    for (const r of await tabla("buzon_mensajes")) {
      const cl = de(r); if (!cl) continue;
      const b = buz.get(cl.id) ?? { mensajes: [], at: "" };
      const nivel = (["peligroso", "urgente", "otro"].includes(r.nivel) ? r.nivel : "otro") as BuzonMensaje["nivel"];
      b.mensajes.push({ id: String(r.codMensaje), fecha: r.fecha ?? "", asunto: r.asunto ?? "", tipo: r.tipo ?? "", nivel, urgente: nivel === "urgente", leido: Boolean(r.leido), origen: r.origen ?? undefined, adjuntos: r.adjuntos == null ? undefined : num(r.adjuntos) });
      if ((r.consultadoAt ?? "") > b.at) b.at = r.consultadoAt;
      buz.set(cl.id, b); nMensajes++;
    }
    for (const [id, b] of buz) {
      const cl = porId.get(id)!;
      cl.buzon = { mensajes: b.mensajes, peligrosos: b.mensajes.filter((m) => m.nivel === "peligroso"), urgentes: b.mensajes.filter((m) => m.nivel === "urgente"), totalMensajes: b.mensajes.length, consultadoAt: b.at || new Date().toISOString() };
    }
    for (const r of await tabla("buzon_adjuntos")) {
      const cl = de(r); if (!cl) continue;
      if (!cl.buzonAdjuntos) cl.buzonAdjuntos = {};
      cl.buzonAdjuntos[String(r.codMensaje)] = { archivo: r.archivo ?? "", nombre: r.nombre ?? "", at: r.at ?? new Date().toISOString(), size: num(r.size), descargadaAt: r.descargadaAt ?? undefined, descargadoPorId: r.descargadoPorId ?? undefined, descargadoPorNombre: r.descargadoPorNombre ?? undefined };
    }
    let nSeg = 0;
    for (const r of await tabla("buzon_seguimientos")) {
      const cl = de(r); if (!cl) continue;
      if (!cl.seguimientosBuzon) cl.seguimientosBuzon = [];
      cl.seguimientosBuzon.push({ codMensaje: String(r.codMensaje), asunto: r.asunto ?? "", fecha: r.fecha ?? "", origen: r.origen ?? undefined, diasAtencion: num(r.diasAtencion), comentario: r.comentario ?? "", creadoAt: r.creadoAt ?? new Date().toISOString(), fechaLimite: r.fechaLimite ?? r.creadoAt ?? new Date().toISOString(), atendido: Boolean(r.atendido), creadoPorId: r.creadoPorId ?? undefined, creadoPorNombre: r.creadoPorNombre ?? undefined });
      nSeg++;
    }

    // ---- Declaraciones ----
    let nDecl = 0, nAnual = 0, nDeudas = 0;
    for (const r of await tabla("declaraciones_mensuales", "order by periodo")) {
      const cl = de(r); if (!cl) continue;
      cl.declaraciones.push({ id: String(r.id), periodo: String(r.periodo).trim(), ruc: r.ruc?.trim() ?? undefined, formulario: r.formulario ?? undefined, ventasBase: num(r.ventasBase), ventasIgv: num(r.ventasIgv), comprasBase: num(r.comprasBase), comprasIgv: num(r.comprasIgv), ventasDetalle: r.ventasDetalle ?? undefined, comprasDetalle: r.comprasDetalle ?? undefined, casillas: Array.isArray(r.casillas) ? r.casillas : [], fuente: r.fuente === "manual" ? "manual" : "pdf", archivoNombre: r.archivoNombre ?? undefined, cargadoAt: r.cargadoAt ?? new Date().toISOString(), noPresento: Boolean(r.noPresento) });
      nDecl++;
    }
    for (const r of await tabla("declaraciones_anuales", "order by ejercicio")) {
      const cl = de(r); if (!cl) continue;
      cl.declaracionesAnuales.push({ id: String(r.id), ejercicio: String(r.ejercicio).trim(), ruc: r.ruc?.trim() ?? undefined, razonSocial: r.razonSocial ?? undefined, formulario: r.formulario ?? undefined, valores: r.valores ?? {}, fuente: r.fuente === "manual" ? "manual" : "pdf", archivoNombre: r.archivoNombre ?? undefined, cargadoAt: r.cargadoAt ?? new Date().toISOString() });
      nAnual++;
    }
    for (const r of await tabla("deudas", "order by creado_at")) {
      const cl = de(r); if (!cl) continue;
      cl.deudas.push({ id: String(r.id), tipo: r.tipo ?? "", seccion: r.seccion ?? undefined, codigoTributo: r.codigoTributo ?? undefined, numero: r.numero ?? undefined, descripcion: r.descripcion ?? "", monto: num(r.monto), periodo: r.periodo ?? undefined, entidad: r.entidad ?? undefined, fuente: r.fuente === "ocr" ? "ocr" : "manual", ocrTexto: r.ocrTexto ?? undefined, creadoAt: r.creadoAt ?? new Date().toISOString() });
      nDeudas++;
    }
    for (const r of await tabla("deudas_f36")) {
      const cl = de(r); if (!cl) continue;
      cl.deudasF36 = { tablas: Array.isArray(r.tablas) ? r.tablas : [], at: r.at ?? undefined, generadoAt: r.generadoAt ?? undefined, nota: r.nota ?? undefined, numPedido: r.numPedido ?? undefined, fechaPedido: r.fechaPedido ?? undefined, estado: r.estado ?? undefined, estadoTexto: r.estadoTexto ?? undefined, accion: r.accion ?? undefined, verificadoAt: r.verificadoAt ?? undefined };
    }

    // ---- Caché del Detalle SIRE (propuesta por tipo-periodo) ----
    for (const r of await tabla("sire_detalle_cache")) {
      const cl = de(r); if (!cl) continue;
      if (!cl.sireDetalle) cl.sireDetalle = {};
      cl.sireDetalle[`${r.tipo}-${String(r.periodo).trim()}`] = {
        columnas: Array.isArray(r.columnas) ? r.columnas : [], filas: Array.isArray(r.filas) ? r.filas : [],
        comprobantes: num(r.comprobantes), at: r.at ?? new Date().toISOString(),
      };
    }

    // ---- RTT y Rentas (solicitudes + bitácora del webhook) ----
    const rtt = (await tabla("rtt_solicitudes", "order by creado_en")).map((r) => ({
      id: String(r.id ?? `${r.clienteId}-${r.ruc}-${r.creadoEn ?? ""}`), ruc: String(r.ruc ?? "").trim(), razonSocial: porId.get(String(r.clienteId))?.razonSocial,
      emailDestino: r.emailDestino ?? "", estado: r.estado ?? "creado",
      historial: Array.isArray(r.historial) ? r.historial : [{ estado: r.estado ?? "creado", at: r.creadoEn ?? new Date().toISOString(), nota: "importado de la web anterior" }],
      creadoEn: r.creadoEn ?? new Date().toISOString(), actualizadoEn: r.actualizadoEn ?? r.creadoEn ?? new Date().toISOString(),
      rutaPdf: r.rutaPdf ?? undefined, rutaXml: r.rutaXml ?? undefined, error: r.error ?? undefined, solicitadoPor: r.solicitadoPor ?? undefined,
    }));
    const rentas = (await tabla("rentas_solicitudes", "order by creado_en")).map((r) => ({
      id: String(r.id ?? `${r.clienteId}-${r.ruc}-${r.creadoEn ?? ""}`), clienteId: String(r.clienteId ?? ""), ruc: String(r.ruc ?? "").trim(),
      emailDestino: r.emailDestino ?? "", estado: (["en_proceso", "listo", "error"].includes(r.estado) ? r.estado : "en_proceso"),
      reporte: r.reporte ?? undefined, rutaPdf: r.rutaPdf ?? undefined, error: r.error ?? undefined,
      creadoEn: r.creadoEn ?? new Date().toISOString(), actualizadoEn: r.actualizadoEn ?? r.creadoEn ?? new Date().toISOString(), solicitadoPor: r.solicitadoPor ?? undefined,
    }));
    const rttWebhookLog = (await tabla("rtt_webhook_log", "order by creado_en desc limit 200")).map((r) => ({
      at: r.creadoEn ?? new Date().toISOString(), ruc: String(r.ruc ?? ""), tienePdf: Boolean(r.tienePdf), tieneXml: Boolean(r.tieneXml),
      resultado: r.resultado ?? "", from: r.fromEmail ?? undefined,
    }));

    // ---- Plataforma ----
    const cuentasProveedor: Record<string, any> = {};
    for (const r of await tabla("cuentas_proveedor")) cuentasProveedor[String(r.ruc).trim()] = { ruc: String(r.ruc).trim(), razonSocial: r.razonSocial ?? undefined, rubro: r.rubro ?? undefined, cuenta: r.cuenta ?? "", nombreCuenta: r.nombreCuenta ?? undefined, fuente: r.fuente === "aprendido" ? "aprendido" : "sugerido", actualizadoAt: r.actualizadoAt ?? new Date().toISOString() };
    const rubrosProveedor: Record<string, any> = {};
    for (const r of await tabla("rubros_proveedor")) rubrosProveedor[String(r.ruc).trim()] = { razonSocial: r.razonSocial ?? "", actividad: r.actividad ?? "", at: r.at ?? new Date().toISOString() };
    const acciones = (await tabla("acciones", "order by at desc limit 5000")).map((r) => ({ id: String(r.id), at: r.at ?? new Date().toISOString(), studioId: String(r.studioId ?? ""), usuarioId: String(r.usuarioId ?? ""), usuarioNombre: r.usuarioNombre ?? "", rol: r.rol ?? undefined, area: r.area ?? "", accion: r.accion ?? "", clienteId: r.clienteId ?? undefined, clienteNombre: r.clienteNombre ?? undefined, detalle: r.detalle ?? undefined }));
    const rucsRegistrados: Record<string, any> = {};
    for (const r of await tabla("rucs_registrados")) rucsRegistrados[String(r.ruc).trim()] = { studioId: String(r.studioId ?? ""), clienteId: String(r.clienteId ?? ""), ownerNombre: r.ownerNombre ?? undefined, at: r.at ?? new Date().toISOString() };
    const config: Record<string, string> = {};
    for (const r of await tabla("config")) if (r.clave) config[camel(String(r.clave))] = String(r.valor ?? "");

    // Consistencia: cada cliente debe tener dueño existente (si no, va al supremo).
    const idsUsers = new Set(users.map((u) => u.id));
    const supremo = users.find((u) => u.rol === "supremo");
    let huerfanos = 0;
    for (const cl of clientes) if (cl.ownerId && !idsUsers.has(cl.ownerId)) { huerfanos++; if (supremo) cl.ownerId = supremo.id; }
    if (huerfanos) avisos.push(`${huerfanos} empresa(s) sin dueño válido: se asignaron al supremo.`);
    // Registro global de RUCs: completar con los clientes si la tabla no existía.
    for (const cl of clientes) if (cl.ruc && !rucsRegistrados[cl.ruc]) rucsRegistrados[cl.ruc] = { studioId: cl.ownerId ?? "", clienteId: cl.id, at: cl.createdAt };

    const store = { clientes, users, cuentasProveedor, rubrosProveedor, acciones, rucsRegistrados, config, rtt, rentas, rttWebhookLog };
    // Tablas de la base vieja que el importador no conoce (para no perder nada sin saberlo).
    const conocidas = new Set([...leidas, ...ausentes, "_prisma_migrations"]);
    const desconocidas = Array.from(existentes).filter((t) => !conocidas.has(t));
    if (desconocidas.length) avisos.push(`Tablas no importadas (no las conoce el importador): ${desconocidas.join(", ")}`);
    if (rtt.length || rentas.length) avisos.push(`RTT: ${rtt.length} solicitud(es) · Rentas: ${rentas.length} · bitácora webhook: ${rttWebhookLog.length}. Los PDF/XML de RTT y rentas viven en uploads/rtt y uploads/rentas de la web vieja.`);
    return {
      store,
      resumen: {
        usuarios: users.length, clientes: clientes.length, mensajesBuzon: nMensajes, seguimientos: nSeg,
        declaraciones: nDecl, declaracionesAnuales: nAnual, deudas: nDeudas, acciones: acciones.length,
        cuentasProveedor: Object.keys(cuentasProveedor).length, rucsRegistrados: Object.keys(rucsRegistrados).length,
        tablasLeidas: leidas, tablasAusentes: ausentes, avisos,
      },
    };
  } finally { await c.end().catch(() => {}); }
}

/**
 * Escribe el store importado. `modo`:
 *  - "reemplazar": el store importado pasa a ser la base (lo actual se respalda).
 *  - "fusionar": agrega usuarios (por correo) y empresas (por RUC) que no existan
 *    en la base actual; lo que ya existe se conserva tal cual.
 */
export async function aplicarImport(importado: any, modo: "reemplazar" | "fusionar"): Promise<{ usuariosNuevos: number; clientesNuevos: number; respaldo: string }> {
  await fs.mkdir(BACKUPS_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const respaldo = `store-antes-importar-${ts}.json`;
  let actual: any = { clientes: [], users: [] };
  try { actual = JSON.parse(await fs.readFile(STORE_PATH, "utf-8")); await fs.writeFile(path.join(BACKUPS_DIR, respaldo), JSON.stringify(actual, null, 2)); } catch { /* sin store previo */ }

  let final: any;
  let usuariosNuevos = 0, clientesNuevos = 0;
  if (modo === "reemplazar") {
    final = { ...actual, ...importado };
    // Conserva lo que la base vieja no tenía (p. ej. avisos, alertas, RTT…).
    for (const k of Object.keys(actual)) if (!(k in importado)) final[k] = actual[k];
    usuariosNuevos = importado.users?.length ?? 0; clientesNuevos = importado.clientes?.length ?? 0;
  } else {
    final = { ...actual };
    final.users = Array.isArray(actual.users) ? [...actual.users] : [];
    final.clientes = Array.isArray(actual.clientes) ? [...actual.clientes] : [];
    const emails = new Set(final.users.map((u: any) => String(u.email).toLowerCase()));
    const idsUsuarios = new Map<string, string>(); // id viejo → id final (si el correo ya existía)
    for (const u of importado.users ?? []) {
      const ex = final.users.find((x: any) => String(x.email).toLowerCase() === u.email);
      if (ex) { idsUsuarios.set(u.id, ex.id); continue; }
      final.users.push(u); emails.add(u.email); usuariosNuevos++;
    }
    const rucs = new Set(final.clientes.map((c: any) => c.ruc));
    for (const c of importado.clientes ?? []) {
      if (rucs.has(c.ruc)) continue;
      const owner = c.ownerId ? idsUsuarios.get(c.ownerId) ?? c.ownerId : c.ownerId;
      final.clientes.push({ ...c, ownerId: owner }); rucs.add(c.ruc); clientesNuevos++;
    }
    for (const k of ["cuentasProveedor", "rubrosProveedor", "rucsRegistrados"]) final[k] = { ...(importado[k] ?? {}), ...(actual[k] ?? {}) };
    final.acciones = [...(importado.acciones ?? []), ...(actual.acciones ?? [])].slice(0, 5000);
    final.config = { ...(importado.config ?? {}), ...(actual.config ?? {}) };
    // Listas por id: se agregan las que no existan.
    for (const k of ["rtt", "rentas"]) {
      const ids = new Set((actual[k] ?? []).map((x: any) => x.id));
      final[k] = [...(actual[k] ?? []), ...((importado[k] ?? []).filter((x: any) => !ids.has(x.id)))];
    }
    final.rttWebhookLog = [...(importado.rttWebhookLog ?? []), ...(actual.rttWebhookLog ?? [])].slice(0, 200);
  }
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(STORE_PATH, JSON.stringify(final, null, 2), "utf-8");
  return { usuariosNuevos, clientesNuevos, respaldo };
}
