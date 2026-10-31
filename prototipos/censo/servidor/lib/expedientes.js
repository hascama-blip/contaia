// Importación de expedientes de socios nuevos desde un ZIP, sin dependencias.
//
// Estructura esperada dentro del ZIP (una carpeta por persona; puede haber una carpeta raíz encima):
//   <raíz opcional>/<Nombres Apellidos - Puesto 1234>/<01 - Documento>.pdf
//   <raíz opcional>/<Nombres Apellidos - Puestos 1234, 1235 y 1236>/...
//   <raíz opcional>/<Nombres Apellidos - Puesto sin indicar>/...
//
// Por cada persona: si ya está en el padrón (mismo nombre), los documentos se agregan a su
// ficha; si no, se crea la ficha marcada "por revisar" (sin N° ni DNI: se completan después).
// Los puestos sin dueño se asignan; los que ya tienen dueño NO se cambian: queda una observación
// para registrar el traspaso desde la ficha del stand (así el comprador hereda el N°).
// Es idempotente: subir el mismo ZIP (o varias partes) no duplica fichas ni documentos.
import zlib from "node:zlib";
import { nuevoId } from "./almacen.js";

// ---------------------------------------------------------------------------
// ZIP (solo lo necesario: directorio central, entradas "stored" y "deflate")
// ---------------------------------------------------------------------------
const EOCD = 0x06054b50, CENTRAL = 0x02014b50, LOCAL = 0x04034b50;
const errorZip = (message) => ({ status: 400, message, code: "invalid_argument" });

/** Devuelve las entradas (archivos, no carpetas) con `leer()` para obtener su contenido. */
export function leerZip(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw errorZip("El archivo no es un ZIP válido.");
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) { if (buf.readUInt32LE(i) === EOCD) { eocd = i; break; } }
  if (eocd < 0) throw errorZip("El archivo no es un ZIP válido (no se encontró el directorio).");
  const total = buf.readUInt16LE(eocd + 10), inicioCentral = buf.readUInt32LE(eocd + 16);
  if (total === 0xffff || inicioCentral === 0xffffffff) throw errorZip("ZIP64 no admitido: divide el archivo en partes más pequeñas (menos de 4 GB y de 65 000 archivos).");
  const entradas = [];
  let p = inicioCentral;
  for (let k = 0; k < total; k++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CENTRAL) throw errorZip("ZIP dañado (directorio central).");
    const flags = buf.readUInt16LE(p + 8), metodo = buf.readUInt16LE(p + 10);
    const comprimido = buf.readUInt32LE(p + 20), tamano = buf.readUInt32LE(p + 24);
    const nLen = buf.readUInt16LE(p + 28), eLen = buf.readUInt16LE(p + 30), cLen = buf.readUInt16LE(p + 32);
    const inicioLocal = buf.readUInt32LE(p + 42);
    const nombreBuf = buf.subarray(p + 46, p + 46 + nLen);
    const nombre = (flags & 0x800) ? nombreBuf.toString("utf8") : decodificarNombre(nombreBuf);
    if (!nombre.endsWith("/")) entradas.push({ nombre, metodo, comprimido, tamano, inicioLocal });
    p += 46 + nLen + eLen + cLen;
  }
  const leer = (e) => {
    const q = e.inicioLocal;
    if (q + 30 > buf.length || buf.readUInt32LE(q) !== LOCAL) throw errorZip(`ZIP dañado (entrada ${e.nombre}).`);
    const nLen = buf.readUInt16LE(q + 26), eLen = buf.readUInt16LE(q + 28);
    const ini = q + 30 + nLen + eLen;
    const datos = buf.subarray(ini, ini + e.comprimido);
    if (e.metodo === 0) return Buffer.from(datos);
    if (e.metodo === 8) return zlib.inflateRawSync(datos);
    throw errorZip(`Compresión no admitida (método ${e.metodo}) en ${e.nombre}.`);
  };
  return entradas.map((e) => ({ ...e, leer: () => leer(e) }));
}

/** Nombres sin marca UTF-8: casi siempre son UTF-8 igual; si no, latin-1. */
function decodificarNombre(b) {
  const utf8 = b.toString("utf8");
  return utf8.includes("�") ? b.toString("latin1") : utf8;
}

// ---------------------------------------------------------------------------
// Carpetas y nombres
// ---------------------------------------------------------------------------
export const normal = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const claveTokens = (s) => normal(s).split(" ").filter(Boolean).sort().join(" ");
const tieneNumero = (a) => { const n = String(a?.numero || "").trim(); return !!n && !/^s\/n/i.test(n); };
const etiqueta = (a) => (tieneNumero(a) ? `N° ${String(a.numero).trim()}` : a?.estado === "transferido" ? "transferido" : "sin N°");
const nombreCompleto = (a) => `${a?.nombres || ""} ${a?.apellidoPaterno || ""} ${a?.apellidoMaterno || ""}`.replace(/\s+/g, " ").trim();

/** "Ana Pérez Quispe - Puestos 1234, 1235 y 1236" → { nombre, puestos: ["1234","1235","1236"], sinPuesto: false } */
export function interpretarCarpeta(carpeta) {
  const m = String(carpeta || "").match(/^(.*?)\s*[-–—]\s*puestos?\s+(.+)$/i) || String(carpeta || "").match(/^(.*?)\s*[-–—]\s*stands?\s+(.+)$/i);
  if (!m) return { nombre: String(carpeta || "").trim(), puestos: [], sinPuesto: true };
  const puestos = [...m[2].matchAll(/\d{3,5}/g)].map((x) => x[0]);
  return { nombre: m[1].trim(), puestos, sinPuesto: puestos.length === 0 };
}

const PARTICULAS = new Set(["de", "del", "la", "las", "los", "y", "e", "da", "do", "dos", "van", "von", "vda", "vda.", "viuda"]);
/** "María del Carmen Pérez Quispe" → nombres "María del Carmen", paterno "Pérez", materno "Quispe". Las dos últimas palabras (agrupando partículas) son los apellidos. */
export function dividirNombre(completo) {
  const palabras = String(completo || "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const tokens = []; let acumulado = [];
  for (const p of palabras) { acumulado.push(p); if (!PARTICULAS.has(p.toLowerCase())) { tokens.push(acumulado.join(" ")); acumulado = []; } }
  if (acumulado.length) { if (tokens.length) tokens[tokens.length - 1] += " " + acumulado.join(" "); else tokens.push(acumulado.join(" ")); }
  if (!tokens.length) return { nombres: "", apellidoPaterno: "", apellidoMaterno: "" };
  if (tokens.length === 1) return { nombres: tokens[0], apellidoPaterno: "", apellidoMaterno: "" };
  if (tokens.length === 2) return { nombres: tokens[0], apellidoPaterno: tokens[1], apellidoMaterno: "" };
  return { nombres: tokens.slice(0, -2).join(" "), apellidoPaterno: tokens[tokens.length - 2], apellidoMaterno: tokens[tokens.length - 1] };
}

const TIPOS = { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };
const tipoDe = (archivo) => TIPOS[String(archivo).split(".").pop().toLowerCase()] || null;
/** "01 - Contrato de compra-venta (2024).pdf" → "01 - Contrato de compra-venta (2024)" (el nombre del documento, tal cual, sin extensión). */
export const nombreDocumento = (archivo) => String(archivo || "").replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim() || "Documento";
const IGNORAR = /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db|desktop\.ini|INDICE\.md|LEEME\.md|README\.md)(\/|$)/i;

/** Agrupa las entradas del ZIP por carpeta de persona (la carpeta que contiene directamente los archivos). */
export function agruparPorPersona(entradas) {
  const personas = new Map(); const sueltos = [];
  for (const e of entradas) {
    if (IGNORAR.test(e.nombre)) continue;
    const partes = e.nombre.split("/").filter(Boolean);
    const archivo = partes.pop();
    if (!partes.length) { sueltos.push(archivo); continue; }
    const carpeta = partes[partes.length - 1];
    if (!personas.has(carpeta)) personas.set(carpeta, { carpeta, archivos: [] });
    personas.get(carpeta).archivos.push({ archivo, entrada: e });
  }
  for (const p of personas.values()) p.archivos.sort((a, b) => a.archivo.localeCompare(b.archivo, "es", { numeric: true, sensitivity: "base" }));
  return { personas: [...personas.values()], sueltos };
}

/** Ficha mínima del padrón para una persona nueva (misma forma que `fichaVacia()` del portal). */
function fichaNueva(nombre, carpeta, ahora, por) {
  const d = dividirNombre(nombre);
  return {
    numero: "", nombres: d.nombres, apellidoPaterno: d.apellidoPaterno, apellidoMaterno: d.apellidoMaterno, dni: "",
    fechaNacimiento: "", nacimiento: { departamento: "", provincia: "", distrito: "" },
    ocupacion: "", instruccion: "", estadoCivil: "",
    direccion: "", distritoResidencia: "", celular: "", telefono: "", correo: "",
    fechaIngreso: "", estado: "activo", cuentaBancaria: "",
    conyuge: { nombre: "", dni: "", celular: "" }, hijos: [], familiares: [],
    observaciones: `Ficha creada desde el expediente de inscripción (${carpeta}) el ${ahora.slice(0, 10)}. Completar N° de asociado, DNI y datos; verificar nombres y apellidos.`,
    archivos: {}, documentos: [], compromiso: { estatutos: false, datos: false },
    censo: { estado: "pendiente", fecha: null, visita: null, por: por || null },
    revisar: true, origen: { expediente: carpeta },
    creadoAt: ahora, actualizadoAt: ahora, actualizadoPor: por || null,
  };
}

/**
 * Importa un ZIP de expedientes. Devuelve el informe por persona (sin tocar nada que ya tenga dueño).
 * @param {Buffer} zipBuf
 * Con `simular: true` solo revisa (quién ya está, qué se crearía, qué puestos chocan) y no guarda nada.
 * @param {{ almacen, guardarArchivo:(buf:Buffer,tipo:string,nombre:string)=>string, por?:string|null, galerias?:Record<string,string>, ahora?:string, maxArchivo?:number, simular?:boolean }} op
 */
export function importarExpedientes(zipBuf, { almacen, guardarArchivo, por = null, galerias = {}, ahora = new Date().toISOString(), maxArchivo = 64 * 1048576, simular = false }) {
  const { personas, sueltos } = agruparPorPersona(leerZip(zipBuf));
  if (!personas.length) throw errorZip("El ZIP no tiene carpetas de personas (una carpeta por socio con sus documentos dentro).");
  const asociados = almacen.listar("asociados");
  const totales = { personas: personas.length, fichasNuevas: 0, fichasExistentes: 0, omitidas: 0, documentosNuevos: 0, documentosRepetidos: 0, documentosOmitidos: 0, standsAsignados: 0, standsPendientes: 0 };
  const informe = { simulado: simular, totales, sueltos, personas: [] };
  for (const p of personas) {
    const { nombre, puestos, sinPuesto } = interpretarCarpeta(p.carpeta);
    const r = { carpeta: p.carpeta, nombre, puestos, accion: "", asociadoId: null, ficha: "", documentos: { nuevos: 0, repetidos: 0, omitidos: 0 }, stands: [], avisos: [] };
    // 1) ¿Ya está en el padrón? Mismo nombre (sin importar orden ni tildes); si no, apellidos + primer nombre.
    const clave = claveTokens(nombre);
    let candidatos = asociados.filter((a) => claveTokens(nombreCompleto(a.data)) === clave);
    if (!candidatos.length) {
      const d = dividirNombre(nombre), primer = normal(d.nombres).split(" ")[0];
      if (primer && d.apellidoPaterno) candidatos = asociados.filter((a) => normal(a.data.apellidoPaterno) === normal(d.apellidoPaterno) && normal(a.data.apellidoMaterno) === normal(d.apellidoMaterno) && normal(a.data.nombres).split(" ")[0] === primer);
      if (candidatos.length) r.avisos.push("Se tomó la ficha que coincide por apellidos y primer nombre: verificar que sea la misma persona.");
    }
    if (candidatos.length > 1) {
      const vigentes = candidatos.filter((a) => tieneNumero(a.data) && a.data.estado !== "transferido");
      if (vigentes.length === 1) candidatos = vigentes;
      else { r.accion = "omitida"; r.avisos.push(`Hay ${candidatos.length} fichas con ese nombre: no se tocó ninguna. Sube estos documentos desde la ficha correcta.`); totales.omitidas++; informe.personas.push(r); continue; }
    }
    let id, ficha;
    if (candidatos.length === 1) { id = candidatos[0].id; ficha = candidatos[0].data; r.accion = "existente"; totales.fichasExistentes++; }
    else { id = nuevoId(); ficha = fichaNueva(nombre, p.carpeta, ahora, por); if (!simular) almacen.establecer("asociados", id, ficha); asociados.push({ id, data: ficha }); r.accion = "creada"; totales.fichasNuevas++; }
    r.asociadoId = id; r.ficha = `${nombreCompleto(ficha)} (${etiqueta(ficha)})`;
    // 2) Documentos: se agregan con el nombre del archivo; los que ya están (mismo nombre) no se repiten.
    const docs = [...(ficha.documentos || [])];
    const yaEstan = new Set(docs.map((d) => normal(d.nombre)));
    for (const { archivo, entrada } of p.archivos) {
      const tipo = tipoDe(archivo);
      if (!tipo) { r.documentos.omitidos++; r.avisos.push(`"${archivo}": tipo no admitido (solo PDF e imágenes).`); continue; }
      const nombreDoc = nombreDocumento(archivo);
      if (yaEstan.has(normal(nombreDoc))) { r.documentos.repetidos++; continue; }
      if (entrada.tamano > maxArchivo) { r.documentos.omitidos++; r.avisos.push(`"${archivo}": pesa ${(entrada.tamano / 1048576).toFixed(0)} MB (máximo ${Math.round(maxArchivo / 1048576)} MB).`); continue; }
      let datos = null;
      if (!simular) { try { datos = entrada.leer(); } catch { r.documentos.omitidos++; r.avisos.push(`"${archivo}": no se pudo leer del ZIP.`); continue; } }
      const archivoId = simular ? "simulado" : guardarArchivo(datos, tipo, archivo);
      docs.push({ id: archivoId, nombre: nombreDoc, archivo, tipo, tamano: simular ? entrada.tamano : datos.length, subidoAt: ahora, por });
      yaEstan.add(normal(nombreDoc)); r.documentos.nuevos++;
    }
    totales.documentosNuevos += r.documentos.nuevos; totales.documentosRepetidos += r.documentos.repetidos; totales.documentosOmitidos += r.documentos.omitidos;
    // 3) Puestos: sin dueño → se asignan; con otro dueño → no se tocan, queda la observación para el traspaso.
    const obs = [];
    for (const codigo of puestos) {
      const s = almacen.obtener("stands", codigo);
      if (!s) {
        if (!galerias[codigo]) { r.stands.push({ codigo, resultado: "no está en el plano: revisar el número" }); r.avisos.push(`El puesto ${codigo} no está en el plano.`); continue; }
        if (!simular) almacen.establecer("stands", codigo, { codigo, galeria: galerias[codigo], area: null, giro: "", propietarioId: id, propietarioDesde: ahora.slice(0, 10), inquilino: null, estado: "propietario", historial: [], creadoAt: ahora, actualizadoAt: ahora });
        r.stands.push({ codigo, resultado: simular ? "se crearía y asignaría" : "creado y asignado" }); totales.standsAsignados++; continue;
      }
      const dueno = s.data.propietarioId;
      if (!dueno) { if (!simular) almacen.actualizar("stands", codigo, { propietarioId: id, propietarioDesde: ahora.slice(0, 10), actualizadoAt: ahora }); r.stands.push({ codigo, resultado: simular ? "se asignaría (está sin dueño)" : "asignado (estaba sin dueño)" }); totales.standsAsignados++; continue; }
      if (dueno === id) { r.stands.push({ codigo, resultado: "ya era suyo" }); continue; }
      const actual = asociados.find((a) => a.id === dueno);
      const quien = actual ? `${nombreCompleto(actual.data)} (${etiqueta(actual.data)})` : `otra ficha (${dueno})`;
      r.stands.push({ codigo, resultado: `a nombre de ${quien}: pendiente de traspaso` }); totales.standsPendientes++;
      obs.push(`El puesto ${codigo} figura a nombre de ${quien}: registrar el traspaso desde la ficha del stand para que herede el N°.`);
    }
    if (sinPuesto) { obs.push("El expediente no indica el puesto."); r.avisos.push("La carpeta no indica el puesto."); }
    // 4) Guardar la ficha (los documentos reemplazan la lista; las observaciones se agregan al final).
    const cambios = { documentos: docs, actualizadoAt: ahora };
    if (obs.length && !(r.accion === "existente" && obs.every((o) => String(ficha.observaciones || "").includes(o)))) {
      cambios.revisar = true;
      cambios.observaciones = [String(ficha.observaciones || "").trim(), `Expediente importado el ${ahora.slice(0, 10)}: ${obs.join(" ")}`].filter(Boolean).join("\n");
    }
    if (!simular) almacen.actualizar("asociados", id, cambios);
    informe.personas.push(r);
  }
  return informe;
}
