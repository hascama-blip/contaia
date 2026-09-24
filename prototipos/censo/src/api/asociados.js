// Servicio de asociados — como los route handlers de Radar (src/app/api/**):
// valida, arma el documento y lo escribe con la capa de datos. La pantalla
// nunca escribe directo en la base.
import * as db from "../lib/db.js";
import { validarFicha, soloDigitos } from "../lib/validar.js";
import { leerCodigos, galeriaDeCodigo } from "../lib/padron.js";
import { ahoraISO, hoy } from "../lib/formato.js";
import { subirArchivo } from "../lib/archivos.js";
import { fichaVacia } from "../lib/types.js";
import { tramoDeSalida } from "../lib/propietarios.js";

class ErrorValidacion extends Error {
  constructor(errores) {
    super("Revisa los campos marcados.");
    this.errores = errores;
  }
}
export { ErrorValidacion };

function limpiar(f) {
  const t = (v) => String(v ?? "").trim();
  const conyuge = { nombre: t(f.conyuge?.nombre), dni: soloDigitos(f.conyuge?.dni), celular: soloDigitos(f.conyuge?.celular) };
  return {
    numero: t(f.numero),
    nombres: t(f.nombres),
    apellidoPaterno: t(f.apellidoPaterno),
    apellidoMaterno: t(f.apellidoMaterno),
    dni: soloDigitos(f.dni),
    fechaNacimiento: t(f.fechaNacimiento),
    nacimiento: { departamento: t(f.nacimiento?.departamento), provincia: t(f.nacimiento?.provincia), distrito: t(f.nacimiento?.distrito) },
    ocupacion: t(f.ocupacion),
    instruccion: t(f.instruccion),
    estadoCivil: t(f.estadoCivil),
    direccion: t(f.direccion),
    distritoResidencia: t(f.distritoResidencia),
    celular: soloDigitos(f.celular),
    telefono: t(f.telefono),
    correo: t(f.correo),
    fechaIngreso: t(f.fechaIngreso),
    estado: f.estado || "activo",
    cuentaBancaria: t(f.cuentaBancaria),
    conyuge: conyuge.nombre || conyuge.dni ? conyuge : null,
    hijos: (f.hijos || []).filter((h) => t(h.nombre)).map((h) => ({ nombre: t(h.nombre), edad: t(h.edad), estudios: t(h.estudios) })),
    familiares: (f.familiares || []).filter((x) => t(x.nombre)).map((x) => ({ nombre: t(x.nombre), parentesco: t(x.parentesco), estudios: t(x.estudios) })),
    observaciones: t(f.observaciones),
    archivos: { ...(f.archivos || {}) },
    compromiso: { estatutos: Boolean(f.compromiso?.estatutos), datos: Boolean(f.compromiso?.datos) },
  };
}

/** Asigna los stands al asociado (crea el stand si no existía) y libera los que dejó. */
async function sincronizarStands(asociadoId, codigos, anteriores, extra, stands, { duenoActual = null, por = null } = {}) {
  for (const codigo of codigos) {
    const actual = stands.find((s) => s.codigo === codigo);
    if (actual) {
      const cambios = { propietarioId: asociadoId };
      if (extra) Object.assign(cambios, extra);
      await db.actualizarStand(codigo, cambios);
    } else {
      await db.guardarStand(codigo, {
        codigo,
        galeria: galeriaDeCodigo(codigo),
        area: null,
        giro: extra?.giro || "",
        propietarioId: asociadoId,
        inquilino: extra?.inquilino || null,
        estado: extra?.estado || "propietario",
      });
    }
  }
  // Un stand que se quita de la ficha no pierde a su dueño: queda en el historial.
  const quitados = anteriores.filter((c) => !codigos.includes(c));
  if (!quitados.length) return;
  const ahora = ahoraISO();
  for (const codigo of quitados) {
    const s = stands.find((x) => x.codigo === codigo) || {};
    const tramo = tramoDeSalida(s, { ...duenoActual, id: asociadoId }, { hasta: hoy().iso, motivo: "Retirado de la ficha", por, ahora });
    await db.actualizarStand(codigo, { propietarioId: null, propietarioDesde: null, historial: [...(s.historial || []), tramo] });
  }
}

function datosStand(f) {
  const inq = f.inquilino || {};
  const inquilino = String(inq.nombre || "").trim()
    ? { nombre: inq.nombre.trim(), dni: soloDigitos(inq.dni), celular: soloDigitos(inq.celular) }
    : null;
  return { giro: String(f.giro || "").trim(), estado: f.estadoStand || "propietario", inquilino };
}

/**
 * Alta de un asociado nuevo (ficha completa del censo).
 * @returns {Promise<string>} id del asociado
 */
export async function crearAsociado(ficha, { asociados, stands, por }) {
  const errores = validarFicha(ficha, { asociados, stands });
  if (Object.keys(errores).length) throw new ErrorValidacion(errores);
  const id = await db.nuevoId("asociados");
  const ahora = ahoraISO();
  const censado = ficha.compromiso?.estatutos && ficha.compromiso?.datos;
  await db.guardarAsociado(id, {
    ...limpiar(ficha),
    censo: { estado: censado ? "actualizado" : "pendiente", fecha: censado ? hoy().iso : null, visita: null, por: por || null },
    creadoAt: ahora,
    actualizadoAt: ahora,
  });
  const { validos } = leerCodigos(ficha.standsTexto);
  await sincronizarStands(id, validos, [], datosStand(ficha), stands);
  return id;
}

/** Edición de una ficha existente. */
export async function actualizarFicha(id, ficha, { asociados, stands, standsActuales, por }) {
  const errores = validarFicha(ficha, { asociados, stands, idActual: id });
  if (Object.keys(errores).length) throw new ErrorValidacion(errores);
  const limpio = limpiar(ficha);
  await db.actualizarAsociado(id, { ...limpio, actualizadoAt: ahoraISO(), actualizadoPor: por || null });
  const { validos } = leerCodigos(ficha.standsTexto);
  await sincronizarStands(id, validos, standsActuales.map((s) => s.codigo), null, stands, { duenoActual: { ...asociados.find((a) => a.id === id), ...limpio }, por });
}

export async function cambiarEstadoCenso(id, estado, { por } = {}) {
  await db.actualizarAsociado(id, {
    censo: { estado, fecha: estado === "pendiente" ? null : hoy().iso, por: por || null },
    actualizadoAt: ahoraISO(),
  });
}

/** Datos que se corrigen en el recorrido (celular y estado civil). */
export async function actualizarDatosCampo(id, { celular, estadoCivil }) {
  const cel = soloDigitos(celular);
  if (cel && !/^9\d{8}$/.test(cel)) throw new ErrorValidacion({ celular: "El celular debe tener 9 dígitos y empezar con 9." });
  await db.actualizarAsociado(id, { celular: cel, estadoCivil: estadoCivil || "", actualizadoAt: ahoraISO() });
}

/** Propietario ausente: deja la visita programada y la nota. */
export async function programarVisita(id, fechaVisita, nota, observacionesPrevias) {
  const texto = [observacionesPrevias, nota ? `Visita ${hoy().iso}: ${nota}` : ""].filter(Boolean).join("\n");
  await db.actualizarAsociado(id, { censo: { visita: fechaVisita || null }, observaciones: texto, actualizadoAt: ahoraISO() });
}

/** Sube foto/huella/firma/DNI y lo enlaza a la ficha (si ya existe). */
export async function adjuntarArchivo(id, tipo, archivo) {
  const { id: archivoId, url } = await subirArchivo(archivo);
  if (id) await db.actualizarAsociado(id, { archivos: { [tipo]: archivoId }, actualizadoAt: ahoraISO() });
  return { archivoId, url };
}

/**
 * Alta rápida (nuevo comprador de un stand): solo identificación y contacto.
 * La ficha completa se llena después desde el padrón.
 * @returns {Promise<string>} id del asociado
 */
export async function crearAsociadoBasico(datos, { asociados, por, nota }) {
  const ficha = { ...fichaVacia(), ...datos, standsTexto: undefined };
  const errores = validarFicha(ficha, { asociados });
  if (Object.keys(errores).length) throw new ErrorValidacion(errores);
  const id = await db.nuevoId("asociados");
  const ahora = ahoraISO();
  await db.guardarAsociado(id, {
    ...limpiar(ficha),
    observaciones: nota || "",
    censo: { estado: "pendiente", fecha: null, visita: null, por: por || null },
    creadoAt: ahora,
    actualizadoAt: ahora,
  });
  return id;
}
