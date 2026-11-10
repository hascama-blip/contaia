// Actualizar el padrón con fichas del Libro de Padrón transcritas (archivo JSON preparado aparte,
// con la foto de cada ficha). Lógica pura: decide, ficha por ficha, qué se cambia. La misma
// decisión sirve para la revisión sin guardar (ops simuladas sobre una copia) y para aplicar
// (ops reales en src/api/actualizarFichas.js), así lo que se revisa es lo que se guarda.
//
// Reglas:
//  - La persona se busca por DNI; si no, por nombre completo (sin importar orden ni tildes).
//  - Identidad (nombres, apellidos, DNI, nacimiento, fecha de ingreso, N°): solo se completa lo
//    vacío; si difiere, se avisa y NO se cambia (puede ser un error de lectura de la letra a mano).
//  - Contacto y situación (dirección, celular, correo, ocupación, instrucción, estado civil,
//    cónyuge): la ficha es más reciente, se reemplaza. Hijos y familiares se combinan por nombre.
//  - Stands: libre → se asigna; de la misma persona → nada; de otra persona → si la ficha es de
//    alguien nuevo en el libro (sin N°) o con ingreso posterior al del dueño actual, se registra
//    el TRASPASO (el anterior queda en el historial, como «Registrar venta o traspaso»). Si no,
//    queda como conflicto para revisar a mano.
//  - Si dos fichas del archivo piden el mismo stand, primero va la antigua (con N°) y luego la
//    nueva: así el historial queda antiguo → nuevo.
import { normalizar, nombreCompleto, tieneNumero, standsPorAsociado, existeStand, galeriaDeCodigo, etiquetaNumero } from "./padron.js";
import { numeroAHeredar } from "./propietarios.js";
import { LISTAS } from "../config.js";

export const TIPO_ARCHIVO = "censo-fichas-libro";
export const NOMBRE_DOCUMENTO = "Ficha del libro de padrón";

const t = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
const dig = (v) => String(v ?? "").replace(/\D/g, "");
const esDni = (v) => /^\d{8}$/.test(dig(v));
const esFecha = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));
const igual = (a, b) => normalizar(t(a)) === normalizar(t(b));
/** Clave de nombre: palabras sin tildes, ordenadas (el orden nombres/apellidos no importa). */
const claveNombre = (s) => normalizar(s).replace(/[^a-z0-9ñ ]/g, " ").split(/\s+/).filter(Boolean).sort().join(" ");
const nombreDeFicha = (f) => `${t(f.apellidoPaterno)} ${t(f.apellidoMaterno)}, ${t(f.nombres)}`.replace(/^ ,|\s+,/g, ",").trim();

/** "Soltera" → "Soltero(a)", "Universitario" → "Universitaria"… (los catálogos del formulario). */
function aCatalogo(valor, lista) {
  const v = normalizar(t(valor));
  if (!v) return "";
  const raiz = (s) => normalizar(s).replace(/\(a\)$/, "").replace(/[ao]$/, "");
  return lista.find((x) => normalizar(x) === v || raiz(x) === raiz(v) || v.startsWith(raiz(x))) || t(valor);
}
const ESTADO_CIVIL = (v) => aCatalogo(v, LISTAS.estadoCivil);
const INSTRUCCION = (v) => { const n = normalizar(t(v)); return n.startsWith("universitari") ? "Universitaria" : n.startsWith("tecnic") ? "Técnico" : aCatalogo(v, LISTAS.instruccion); };

/** Valida el archivo y devuelve { fichas, omitidas, fechaDocumento, origen }. */
export function leerArchivoFichas(json) {
  if (!json || json.tipo !== TIPO_ARCHIVO || !Array.isArray(json.fichas)) {
    throw new Error("Este archivo no es una actualización de fichas del libro de padrón.");
  }
  const fechaDocumento = esFecha(json.fechaDocumento) ? json.fechaDocumento : "";
  const fichas = json.fichas.map((f, i) => {
    const stands = [...new Set((f.stands || []).map((c) => t(c)).filter(Boolean))];
    const malos = stands.filter((c) => !existeStand(c));
    return {
      ...f,
      id: t(f.id) || `f${i + 1}`,
      numero: t(f.numero),
      dni: dig(f.dni),
      stands: stands.filter((c) => existeStand(c)),
      standsInvalidos: malos,
      cuentas: f.cuentas || {},
      fechaIngreso: esFecha(f.fechaIngreso) ? f.fechaIngreso : "",
      hijos: Array.isArray(f.hijos) ? f.hijos : [],
      familiares: Array.isArray(f.familiares) ? f.familiares : [],
      dudas: Array.isArray(f.dudas) ? f.dudas : [],
      fotos: Array.isArray(f.fotos) ? f.fotos.filter((x) => x && /^data:image\/(jpeg|png);base64,/.test(x.dataURL || "")) : [],
    };
  });
  if (!fichas.length) throw new Error("El archivo no trae fichas.");
  return { fichas, omitidas: Array.isArray(json.omitidas) ? json.omitidas : [], fechaDocumento, origen: t(json.origen) };
}

/** Orden de proceso: primero las fichas antiguas (con N°), luego las nuevas; dentro, por fecha de ingreso. */
export function ordenarFichas(fichas) {
  const k = (f) => `${f.numero ? 0 : 1}${f.fechaIngreso || "9999"}`;
  return [...fichas].sort((a, b) => k(a).localeCompare(k(b)));
}

/** Busca a la persona en el padrón: por DNI, si no por nombre completo. */
export function buscarPersona(f, asociados) {
  if (esDni(f.dni)) {
    const a = asociados.find((x) => dig(x.dni) === f.dni);
    if (a) return { a, por: "DNI" };
  }
  const k = claveNombre(`${f.nombres} ${f.apellidoPaterno} ${f.apellidoMaterno}`);
  if (k.split(" ").length < 2) return null;
  const mismos = asociados.filter((x) => claveNombre(`${x.nombres} ${x.apellidoPaterno} ${x.apellidoMaterno}`) === k);
  return mismos.length === 1 ? { a: mismos[0], por: "nombre" } : null;
}

/** Combina listas de hijos o familiares por nombre: actualiza lo que trae la ficha y agrega los nuevos. */
function combinarPersonas(actuales, deFicha, campos) {
  const lista = (actuales || []).map((x) => ({ ...x }));
  let nuevos = 0, cambiados = 0;
  for (const h of deFicha) {
    const nombre = t(h.nombre);
    if (!nombre) continue;
    const k = claveNombre(nombre);
    const ya = lista.find((x) => claveNombre(x.nombre) === k)
      || lista.find((x) => { const a = claveNombre(x.nombre).split(" "), b = k.split(" "); return a.length >= 2 && b.length >= 2 && a.filter((p) => b.includes(p)).length >= Math.min(a.length, b.length) && Math.abs(a.length - b.length) <= 1; });
    if (!ya) { lista.push(Object.fromEntries([["nombre", nombre], ...campos.map((c) => [c, c === "dni" ? (esDni(h.dni) ? dig(h.dni) : "") : t(h[c])])])); nuevos++; continue; }
    let cambio = false;
    for (const c of campos) {
      const v = c === "dni" ? (esDni(h.dni) ? dig(h.dni) : "") : t(h[c]);
      if (v && !igual(v, ya[c])) { ya[c] = v; cambio = true; }
    }
    if (claveNombre(nombre).length > claveNombre(ya.nombre).length) { ya.nombre = nombre; cambio = true; } // la ficha trae el nombre más completo
    if (cambio) cambiados++;
  }
  return { lista, nuevos, cambiados };
}

const ETIQUETAS = {
  nombres: "Nombres", apellidoPaterno: "Apellido paterno", apellidoMaterno: "Apellido materno", dni: "DNI",
  fechaNacimiento: "Fecha de nacimiento", fechaIngreso: "Fecha de ingreso", numero: "N° de asociado",
  "nacimiento.distrito": "Distrito de nacimiento", "nacimiento.provincia": "Provincia de nacimiento", "nacimiento.departamento": "Departamento de nacimiento",
  ocupacion: "Ocupación", instruccion: "Grado de instrucción", estadoCivil: "Estado civil", direccion: "Dirección",
  distritoResidencia: "Distrito (dirección)", celular: "Celular", correo: "Correo", conyuge: "Cónyuge o conviviente",
  hijos: "Hijos", familiares: "Otros familiares", observaciones: "Observaciones",
};

/**
 * Cambios para un asociado que ya está en el padrón.
 * @returns {{ parcial: object, cambios: {campo,antes,despues}[], diferencias: {campo,padron,ficha}[] }}
 */
export function cambiosParaExistente(a, f, { asociados }) {
  const parcial = {}, cambios = [], diferencias = [];
  const ver = (v) => (esFecha(v) ? v.split("-").reverse().join("/") : t(v)); // fechas como 29/09/1964
  const anotar = (campo, antes, despues) => cambios.push({ campo: ETIQUETAS[campo] || campo, antes: ver(antes), despues: ver(despues) });
  const difiere = (campo, padron, ficha) => diferencias.push({ campo: ETIQUETAS[campo] || campo, padron: ver(padron), ficha: ver(ficha) });
  const verificado = a.censo?.fuente === "reniec" || a.censo?.estado === "verificado";

  // Identidad: completar lo vacío; avisar si difiere.
  for (const c of ["nombres", "apellidoPaterno", "apellidoMaterno", "fechaNacimiento", "fechaIngreso"]) {
    const v = t(f[c]);
    if (!v) continue;
    if (!t(a[c])) { parcial[c] = v; anotar(c, "", v); }
    else if (!igual(a[c], v)) difiere(c, a[c], v);
  }
  if (esDni(f.dni)) {
    if (!esDni(a.dni)) {
      const otro = asociados.find((x) => x.id !== a.id && dig(x.dni) === f.dni);
      if (otro) difiere("dni", a.dni, `${f.dni} (ya es de ${nombreCompleto(otro)})`);
      else { parcial.dni = f.dni; anotar("dni", a.dni, f.dni); }
    } else if (dig(a.dni) !== f.dni) difiere("dni", a.dni, f.dni);
  }
  const nac = {};
  for (const c of ["distrito", "provincia", "departamento"]) {
    const v = t(f.nacimiento?.[c]);
    if (!v) continue;
    if (!t(a.nacimiento?.[c])) { nac[c] = v; anotar(`nacimiento.${c}`, "", v); }
    else if (!igual(a.nacimiento[c], v) && !verificado) difiere(`nacimiento.${c}`, a.nacimiento[c], v);
  }
  if (Object.keys(nac).length) parcial.nacimiento = nac;
  if (f.numero) {
    if (!tieneNumero(a)) {
      const otro = asociados.find((x) => x.id !== a.id && tieneNumero(x) && normalizar(x.numero) === normalizar(f.numero));
      if (otro) difiere("numero", a.numero, `${f.numero} (ya es de ${nombreCompleto(otro)})`);
      else if ((a.numeroHistorial || []).some((h) => normalizar(h.numero) === normalizar(f.numero))) difiere("numero", "ex N° " + f.numero + " (lo cedió al vender)", f.numero);
      else { parcial.numero = f.numero; anotar("numero", a.numero, f.numero); }
    } else if (normalizar(a.numero) !== normalizar(f.numero)) difiere("numero", a.numero, f.numero);
  }

  // Contacto y situación: la ficha es más reciente.
  const nuevos = {
    ocupacion: t(f.ocupacion), instruccion: INSTRUCCION(f.instruccion), estadoCivil: ESTADO_CIVIL(f.estadoCivil),
    direccion: t(f.direccion), distritoResidencia: t(f.distritoResidencia), celular: dig(f.celular), correo: t(f.correo).toLowerCase(),
  };
  if (nuevos.celular && !/^9\d{8}$/.test(nuevos.celular)) nuevos.celular = "";
  for (const [c, v] of Object.entries(nuevos)) {
    if (v && !igual(a[c], v)) { parcial[c] = v; anotar(c, a[c], v); }
  }
  const cony = f.conyuge && t(f.conyuge.nombre) ? f.conyuge : null;
  if (cony && !igual(a.conyuge?.nombre, cony.nombre)) {
    parcial.conyuge = { nombre: t(cony.nombre), dni: esDni(cony.dni) ? dig(cony.dni) : "", celular: "" };
    anotar("conyuge", a.conyuge?.nombre, cony.nombre);
  } else if (cony && esDni(cony.dni) && dig(a.conyuge?.dni) !== dig(cony.dni)) {
    parcial.conyuge = { ...(a.conyuge || {}), dni: dig(cony.dni) };
    anotar("conyuge", `DNI ${a.conyuge?.dni || "—"}`, `DNI ${dig(cony.dni)}`);
  }

  const hijos = combinarPersonas(a.hijos, f.hijos, ["edad", "estudios", "dni"]);
  if (hijos.nuevos || hijos.cambiados) { parcial.hijos = hijos.lista; anotar("hijos", "", [hijos.nuevos && `${hijos.nuevos} agregado(s)`, hijos.cambiados && `${hijos.cambiados} actualizado(s)`].filter(Boolean).join(", ")); }
  const fam = combinarPersonas(a.familiares, f.familiares, ["parentesco", "edad", "estudios"]);
  if (fam.nuevos || fam.cambiados) { parcial.familiares = fam.lista; anotar("familiares", "", [fam.nuevos && `${fam.nuevos} agregado(s)`, fam.cambiados && `${fam.cambiados} actualizado(s)`].filter(Boolean).join(", ")); }

  const obs = t(f.observaciones);
  if (obs && !normalizar(a.observaciones || "").includes(normalizar(obs))) {
    parcial.observaciones = [t(a.observaciones), `Libro de padrón: ${obs}`].filter(Boolean).join("\n");
    anotar("observaciones", "", `Libro de padrón: ${obs}`);
  }
  return { parcial, cambios, diferencias };
}

/** Ficha completa para una persona que no está en el padrón (queda «por revisar»). */
export function fichaNuevaDesde(f, { asociados, fechaDocumento, ahora, por }) {
  const numeroLibre = f.numero && !asociados.some((x) => tieneNumero(x) && normalizar(x.numero) === normalizar(f.numero)) ? f.numero : "";
  const dudas = f.dudas.length ? ` Lecturas dudosas: ${f.dudas.join("; ")}.` : "";
  const nota = `Ficha creada desde la foto de la ficha del libro de padrón${fechaDocumento ? ` (${fechaDocumento.split("-").reverse().join("/")})` : ""}. Revisar con la foto adjunta.${numeroLibre ? "" : " Completar el N° de asociado."}${dudas}`;
  const celular = dig(f.celular);
  return {
    numero: numeroLibre, nombres: t(f.nombres), apellidoPaterno: t(f.apellidoPaterno), apellidoMaterno: t(f.apellidoMaterno),
    dni: esDni(f.dni) ? f.dni : "", fechaNacimiento: esFecha(f.fechaNacimiento) ? f.fechaNacimiento : "",
    nacimiento: { departamento: t(f.nacimiento?.departamento), provincia: t(f.nacimiento?.provincia), distrito: t(f.nacimiento?.distrito) },
    ocupacion: t(f.ocupacion), instruccion: INSTRUCCION(f.instruccion), estadoCivil: ESTADO_CIVIL(f.estadoCivil),
    direccion: t(f.direccion), distritoResidencia: t(f.distritoResidencia), celular: /^9\d{8}$/.test(celular) ? celular : "", telefono: "", correo: t(f.correo).toLowerCase(),
    fechaIngreso: f.fechaIngreso || "", estado: "activo", cuentaBancaria: "",
    conyuge: f.conyuge && t(f.conyuge.nombre) ? { nombre: t(f.conyuge.nombre), dni: esDni(f.conyuge.dni) ? dig(f.conyuge.dni) : "", celular: "" } : null,
    hijos: combinarPersonas([], f.hijos, ["edad", "estudios", "dni"]).lista,
    familiares: combinarPersonas([], f.familiares, ["parentesco", "edad", "estudios"]).lista,
    observaciones: [nota, t(f.observaciones) && `Libro de padrón: ${t(f.observaciones)}`].filter(Boolean).join("\n"),
    archivos: {}, documentos: [], compromiso: { estatutos: false, datos: false },
    censo: { estado: "pendiente", fecha: null, visita: null, por: por || null },
    revisar: true, origen: { fichaLibro: { fecha: fechaDocumento || null, fotos: f.fotos.map((x) => x.nombre) } },
    creadoAt: ahora, actualizadoAt: ahora, actualizadoPor: por || null,
  };
}

/** Fecha del traspaso: la de ingreso de la ficha o la de las fotos; nunca futura ni anterior al dueño actual. */
function fechaTraspaso(f, stand, { fechaDocumento, hoyIso }) {
  const minimo = stand.propietarioDesde || "0000-00-00";
  return [f.fechaIngreso, fechaDocumento, hoyIso].find((x) => esFecha(x) && x <= hoyIso && x >= minimo) || null;
}

/** ¿La ficha indica que esta persona llegó DESPUÉS del dueño actual del stand? */
function esLlegadaNueva(f, stand, dueno) {
  if (!f.numero) return true; // nueva en el libro: aún sin N° de asociado
  const desdeDueno = stand.propietarioDesde || dueno?.fechaIngreso || "";
  return Boolean(f.fechaIngreso && desdeDueno && f.fechaIngreso > desdeDueno);
}

const describir = (a) => (a ? `${nombreCompleto(a)} (${etiquetaNumero(a)})` : "sin ficha");

/**
 * Procesa el lote. `ops` hace los cambios (simulados o reales) y mantiene `estado` al día.
 * @param {{fichas, fechaDocumento}} lote
 * @param {{asociados: object[], stands: object[]}} estado   copia de trabajo (se modifica)
 * @param {{ ops, hoyIso, ahora, motivo, por, onAvance }} op
 * @returns {Promise<object[]>} una fila de informe por ficha
 */
export async function procesarFichas(lote, estado, { ops, hoyIso, ahora, motivo = "Compraventa", por = null, onAvance } = {}) {
  const filas = [];
  const orden = ordenarFichas(lote.fichas);
  for (const [i, f] of orden.entries()) {
    onAvance?.(i + 1, orden.length, nombreDeFicha(f));
    const fila = { ficha: f, nombre: nombreDeFicha(f), persona: null, cambios: [], diferencias: [], stands: [], documentos: 0, avisos: [...f.dudas], error: null };
    filas.push(fila);
    try {
      // 1) La persona
      const hallada = buscarPersona(f, estado.asociados);
      let id;
      if (hallada) {
        id = hallada.a.id;
        fila.persona = { id, accion: "existente", por: hallada.por, etiqueta: describir(hallada.a) };
        if (hallada.por === "nombre" && esDni(hallada.a.dni) && esDni(f.dni) && dig(hallada.a.dni) !== f.dni) fila.avisos.push(`Coincide por nombre pero el DNI es distinto (padrón ${hallada.a.dni}, ficha ${f.dni}): revisar.`);
        const { parcial, cambios, diferencias } = cambiosParaExistente(hallada.a, f, { asociados: estado.asociados });
        fila.cambios = cambios; fila.diferencias = diferencias;
        if (Object.keys(parcial).length) await ops.actualizar(id, parcial);
      } else {
        const datos = fichaNuevaDesde(f, { asociados: estado.asociados, fechaDocumento: lote.fechaDocumento, ahora, por });
        id = await ops.crear(datos);
        fila.persona = { id, accion: "creada", por: null, etiqueta: datos.numero ? `N° ${datos.numero}` : "sin N° (completar)" };
        if (f.numero && !datos.numero) fila.avisos.push(`El N° ${f.numero} de la ficha ya lo tiene otro asociado: se creó sin N°.`);
      }

      // 2) Sus stands
      for (const codigo of f.stands) {
        const cuenta = dig(f.cuentas?.[codigo]);
        const stand = estado.stands.find((s) => s.codigo === codigo);
        const extraCuenta = (s) => (cuenta && dig(s?.cuenta) !== cuenta ? { cuenta } : {});
        const notaCuenta = (s) => (cuenta && dig(s?.cuenta) !== cuenta ? ` · N° de cuenta ${s?.cuenta ? `${s.cuenta} → ` : ""}${cuenta}` : "");
        if (!stand) {
          await ops.crearStand(codigo, { codigo, galeria: galeriaDeCodigo(codigo), area: null, giro: "", propietarioId: id, propietarioDesde: f.fechaIngreso || null, inquilino: null, estado: "propietario", ...(cuenta ? { cuenta } : {}) });
          fila.stands.push({ codigo, accion: "creado", texto: `No estaba registrado: se crea a su nombre${cuenta ? ` · N° de cuenta ${cuenta}` : ""}.` });
          continue;
        }
        if (!stand.propietarioId) {
          await ops.actualizarStand(codigo, { propietarioId: id, propietarioDesde: f.fechaIngreso || stand.propietarioDesde || null, ...extraCuenta(stand) });
          fila.stands.push({ codigo, accion: "asignado", texto: `Estaba sin propietario: se le asigna${notaCuenta(stand)}.` });
          continue;
        }
        if (stand.propietarioId === id) {
          if (extraCuenta(stand).cuenta) await ops.actualizarStand(codigo, extraCuenta(stand));
          fila.stands.push({ codigo, accion: "suyo", texto: `Ya figura a su nombre${notaCuenta(stand)}.` });
          continue;
        }
        const dueno = estado.asociados.find((a) => a.id === stand.propietarioId) || null;
        const tramo = (stand.historial || []).find((h) => h.asociadoId === id);
        if (tramo) {
          fila.stands.push({ codigo, accion: "vendido", texto: `Figuró a su nombre hasta el ${String(tramo.hasta || "").split("-").reverse().join("/") || "—"} (queda en el historial); hoy es de ${describir(dueno)}. No se cambió.` });
          continue;
        }
        if (!esLlegadaNueva(f, stand, dueno)) {
          fila.stands.push({ codigo, accion: "conflicto", texto: `Figura a nombre de ${describir(dueno)}. La ficha no muestra que sea una compra posterior: no se cambió. Si cambió de dueño, regístralo con «Registrar venta o traspaso».` });
          continue;
        }
        const fecha = fechaTraspaso(f, stand, { fechaDocumento: lote.fechaDocumento, hoyIso });
        if (!fecha) {
          fila.stands.push({ codigo, accion: "conflicto", texto: `Figura a nombre de ${describir(dueno)} desde ${stand.propietarioDesde}, fecha posterior a la de la ficha: no se cambió.` });
          continue;
        }
        const r = await ops.traspasar(codigo, {
          nuevoId: id, fecha, motivo,
          documento: NOMBRE_DOCUMENTO,
          observacion: `Nuevo propietario según la ficha del libro de padrón${lote.fechaDocumento ? ` (foto del ${lote.fechaDocumento.split("-").reverse().join("/")})` : ""}.`,
        });
        if (extraCuenta(stand).cuenta) await ops.actualizarStand(codigo, extraCuenta(stand));
        fila.stands.push({
          codigo, accion: "traspaso",
          texto: `Traspaso desde ${describir(dueno)} el ${fecha.split("-").reverse().join("/")} (${motivo}); el anterior queda en el historial${r?.hereda ? ` · hereda el N° ${r.hereda}` : ""}${r?.anteriorSale ? " · el anterior queda «Transferido»" : ""}${notaCuenta(stand)}.`,
        });
      }
      for (const c of f.standsInvalidos) fila.stands.push({ codigo: c, accion: "conflicto", texto: "Ese número no existe en el plano: no se tomó." });

      // 3) La foto de la ficha como documento
      if (f.fotos.length && ops.adjuntar) fila.documentos = await ops.adjuntar(id, f.fotos);
    } catch (e) {
      fila.error = e?.errores ? Object.values(e.errores).join(" ") : e?.message || String(e);
    }
  }
  return filas;
}

/** Copia de trabajo de los datos del portal (para no tocar lo que muestra la pantalla). */
export function copiarEstado(datos) {
  const copia = (x) => JSON.parse(JSON.stringify(x));
  return { asociados: copia(datos.asociados || []), stands: copia(datos.stands || []) };
}

/** Ops simuladas: aplican los efectos sobre la copia, sin guardar nada (revisión). */
export function opsSimuladas(estado) {
  let n = 0;
  const asociado = (id) => estado.asociados.find((a) => a.id === id);
  const stand = (c) => estado.stands.find((s) => s.codigo === c);
  return {
    crear: async (datos) => { const id = `nuevo_${++n}`; estado.asociados.push({ id, ...datos }); return id; },
    actualizar: async (id, parcial) => { const a = asociado(id); Object.assign(a, parcial, parcial.nacimiento ? { nacimiento: { ...a.nacimiento, ...parcial.nacimiento } } : {}); },
    crearStand: async (codigo, datos) => { estado.stands.push({ id: codigo, ...datos }); },
    actualizarStand: async (codigo, parcial) => { Object.assign(stand(codigo), parcial); },
    traspasar: async (codigo, tr) => {
      const s = stand(codigo);
      const anterior = asociado(s.propietarioId) || null;
      const mapa = standsPorAsociado(estado.stands);
      const delAnterior = anterior ? mapa.get(anterior.id) || [] : [];
      const comprador = asociado(tr.nuevoId);
      const hereda = numeroAHeredar({ anterior, comprador, modo: "existente", standsDelAnterior: delAnterior, codigo });
      const anteriorSale = Boolean(anterior && delAnterior.every((x) => x.codigo === codigo));
      s.historial = [...(s.historial || []), { asociadoId: anterior?.id || null, nombre: anterior ? nombreCompleto(anterior) : "Sin ficha", hasta: tr.fecha, motivo: tr.motivo }];
      Object.assign(s, { propietarioId: tr.nuevoId, propietarioDesde: tr.fecha });
      if (anteriorSale) { anterior.estado = "transferido"; if (hereda) anterior.numero = ""; }
      if (comprador) { if (comprador.estado === "transferido") comprador.estado = "activo"; if (hereda) comprador.numero = hereda; }
      return { hereda, anteriorSale };
    },
    adjuntar: async (id, fotos) => fotos.filter((x) => !yaAdjunta(asociado(id), x)).length,
  };
}

/** Nombre con que queda la foto en los documentos de la ficha (sin guiones: el portal los cambia por espacios). */
export const nombreDocumento = (foto) => `${NOMBRE_DOCUMENTO} (${t(foto.nombre) || "foto"})`;
/** ¿La ficha ya tiene esa foto? Compara con el nombre visible y con el del archivo original. */
export function yaAdjunta(a, foto) {
  const buscado = normalizar(nombreDocumento(foto)).replace(/[^a-z0-9ñ]/g, "");
  return (a?.documentos || []).some((d) => [d.nombre, String(d.archivo || "").replace(/\.[^.]+$/, "")].some((n) => normalizar(n).replace(/[^a-z0-9ñ]/g, "") === buscado));
}

/** Resumen para la cabecera del informe. */
export function resumir(filas) {
  const r = { fichas: filas.length, existentes: 0, nuevas: 0, cambios: 0, traspasos: 0, asignados: 0, conflictos: 0, documentos: 0, errores: 0 };
  for (const f of filas) {
    if (f.persona?.accion === "existente") r.existentes++;
    if (f.persona?.accion === "creada") r.nuevas++;
    if (f.cambios.length) r.cambios++;
    r.traspasos += f.stands.filter((s) => s.accion === "traspaso").length;
    r.asignados += f.stands.filter((s) => s.accion === "asignado" || s.accion === "creado").length;
    r.conflictos += f.stands.filter((s) => s.accion === "conflicto").length;
    r.documentos += f.documentos || 0;
    if (f.error) r.errores++;
  }
  return r;
}
