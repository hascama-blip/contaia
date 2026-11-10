// Servicio de stands: editar giro, área, estado e inquilino.
import * as db from "../lib/db.js";
import { soloDigitos, validarTraspaso } from "../lib/validar.js";
import { tramoDeSalida, numeroAHeredar } from "../lib/propietarios.js";
import { nombreCompleto, galeriaDeCodigo } from "../lib/padron.js";
import { ahoraISO, hoy, fecha as fechaTxt } from "../lib/formato.js";
import { ErrorValidacion, crearAsociadoBasico } from "./asociados.js";

export async function editarStand(codigo, s) {
  const errores = {};
  if (s.area !== "" && s.area !== null && !(Number(s.area) > 0)) errores.area = "El área debe ser un número en m², p. ej. 12.5.";
  if (s.estado === "alquilado" && !String(s.inquilino?.nombre || "").trim()) {
    errores.inquilino = "Un stand alquilado necesita el nombre del inquilino.";
  }
  if (Object.keys(errores).length) throw new ErrorValidacion(errores);
  const inq = s.inquilino || {};
  await db.actualizarStand(codigo, {
    giro: String(s.giro || "").trim(),
    area: s.area === "" || s.area === null ? null : Number(s.area),
    estado: s.estado,
    inquilino: String(inq.nombre || "").trim() ? { nombre: inq.nombre.trim(), dni: soloDigitos(inq.dni), celular: soloDigitos(inq.celular) } : null,
    ...(s.asociacionNota !== undefined ? { asociacionNota: String(s.asociacionNota || "").trim() } : {}),
  });
}

/**
 * Venta o traspaso: el propietario actual pasa al historial (no se borra) y el
 * nuevo queda como dueño desde la fecha indicada.
 * @param {object} t  { modo:"existente"|"nueva", nuevoId, nueva:{numero,nombres,…}, fecha, motivo, documento, observacion, quitarInquilino }
 * @returns {Promise<string>} id del nuevo propietario
 */
export async function transferirStand(codigo, t, { asociados, stands, mapaStands, por }) {
  const stand = await db.leerStand(codigo); // lo último guardado, por si otro usuario cambió algo
  if (!stand) throw new Error(`El stand ${codigo} no existe.`);
  const errores = validarTraspaso(t, { stand, hoyIso: hoy().iso });
  if (Object.keys(errores).length) throw new ErrorValidacion(errores);

  const anterior = asociados.find((a) => a.id === stand.propietarioId) || null;
  const standsDelAnterior = anterior ? mapaStands.get(anterior.id) || [] : [];
  const compradorPrevio = t.modo === "existente" ? asociados.find((a) => a.id === t.nuevoId) || null : null;
  // Regla del padrón: no se crea N° nuevo; el comprador hereda el N° de quien sale.
  const hereda = numeroAHeredar({ anterior, comprador: compradorPrevio, modo: t.modo, standsDelAnterior, codigo });
  const nuevoId = t.modo === "nueva"
    ? await crearAsociadoBasico({ ...t.nueva, ...(hereda ? { numero: hereda } : {}) }, {
        asociados: hereda ? asociados.filter((a) => a.id !== anterior.id) : asociados, // el N° heredado deja de ser del vendedor
        por,
        nota: `Ingresó al padrón por ${String(t.motivo).toLowerCase()} del stand ${codigo} el ${fechaTxt(t.fecha)}.${hereda ? ` Heredó el N° ${hereda} de ${nombreCompleto(anterior)}.` : ""}`,
      })
    : t.nuevoId;

  const ahora = ahoraISO();
  const historial = [...(stand.historial || [])];
  // El dueño que sale (un asociado o la Asociación, si era un stand propio) pasa al historial.
  if (stand.propietarioId || stand.deAsociacion) historial.push(tramoDeSalida(stand, anterior, { hasta: t.fecha, motivo: t.motivo, documento: String(t.documento || "").trim(), observacion: String(t.observacion || "").trim(), por, ahora }));
  const cambios = { propietarioId: nuevoId, propietarioDesde: t.fecha, historial, ...(stand.deAsociacion ? { deAsociacion: false } : {}) };
  if (t.quitarInquilino) Object.assign(cambios, { inquilino: null, estado: "propietario" });
  await db.actualizarStand(codigo, cambios);

  // Si el anterior ya no tiene otro stand, su ficha queda como "Transferido" (sigue en el padrón, como historial).
  if (anterior && standsDelAnterior.every((s) => s.codigo === codigo)) {
    const cambiosAnterior = { estado: "transferido", actualizadoAt: ahora };
    if (hereda) {
      // Cede su N° al comprador: queda como "ex N°" con el registro de a quién y cuándo.
      const nombreNuevo = compradorPrevio ? nombreCompleto(compradorPrevio) : [t.nueva?.apellidoPaterno, t.nueva?.apellidoMaterno].filter(Boolean).join(" ") + (t.nueva?.nombres ? `, ${t.nueva.nombres}` : "");
      cambiosAnterior.numero = "";
      cambiosAnterior.numeroHistorial = [...(anterior.numeroHistorial || []), { numero: hereda, hasta: t.fecha, cedidoA: nuevoId, cedidoANombre: nombreNuevo.trim(), stand: codigo, motivo: t.motivo, por: por || null, registradoAt: ahora }];
    }
    await db.actualizarAsociado(anterior.id, cambiosAnterior);
  }
  // El comprador: si estaba como transferido (recompra) vuelve a activo; si hereda el N°, lo recibe aquí.
  if (compradorPrevio) {
    const cambiosComprador = {};
    if (compradorPrevio.estado === "transferido") cambiosComprador.estado = "activo";
    if (hereda) Object.assign(cambiosComprador, { numero: hereda, numeroDesde: t.fecha, numeroHeredadoDe: { asociadoId: anterior.id, nombre: nombreCompleto(anterior), dni: anterior.dni || "", stand: codigo, fecha: t.fecha } });
    if (Object.keys(cambiosComprador).length) await db.actualizarAsociado(nuevoId, { ...cambiosComprador, actualizadoAt: ahora });
  } else if (hereda) {
    await db.actualizarAsociado(nuevoId, { numeroDesde: t.fecha, numeroHeredadoDe: { asociadoId: anterior.id, nombre: nombreCompleto(anterior), dni: anterior.dni || "", stand: codigo, fecha: t.fecha } });
  }
  return nuevoId;
}

/**
 * Marca stands como propios de la Asociación. Si el stand figuraba a nombre de un asociado,
 * ese asociado pasa al historial del stand (nunca se borra) y su ficha queda «por revisar».
 * Si el stand no existía en la base, se crea.
 * @param {{codigo:string, nota?:string}[]} items
 * @param {{ asociados, por, documento, onAvance }} op
 * @returns {Promise<{ marcados:number, creados:number, conDueno:number, yaEstaban:number, errores:string[] }>}
 */
export async function marcarStandsAsociacion(items, { asociados = [], por = null, documento = "", onAvance } = {}) {
  const r = { marcados: 0, creados: 0, conDueno: 0, anotados: 0, yaEstaban: 0, errores: [] };
  const hoyIso = hoy().iso;
  for (const [i, { codigo, nota = "" }] of items.entries()) {
    onAvance?.(i + 1, items.length, codigo);
    try {
      const ahora = ahoraISO();
      const s = await db.leerStand(codigo);
      const marca = { deAsociacion: true, asociacionNota: String(nota || "").trim(), asociacionDesde: hoyIso, actualizadoAt: ahora };
      if (!s) {
        await db.guardarStand(codigo, { codigo, galeria: galeriaDeCodigo(codigo), area: null, giro: "", propietarioId: null, propietarioDesde: null, inquilino: null, estado: "propietario", historial: [], creadoAt: ahora, ...marca });
        r.creados++; r.marcados++;
        continue;
      }
      if (s.deAsociacion && !s.propietarioId) {
        if (marca.asociacionNota && !s.asociacionNota) { await db.actualizarStand(codigo, { asociacionNota: marca.asociacionNota }); r.anotados++; }
        else r.yaEstaban++;
        continue;
      }
      if (s.propietarioId) {
        const anterior = asociados.find((a) => a.id === s.propietarioId) || null;
        const tramo = tramoDeSalida(s, anterior, {
          hasta: hoyIso, motivo: "Stand de la asociación", documento,
          observacion: marca.asociacionNota ? `En el libro figura como «${marca.asociacionNota}».` : "", por, ahora,
        });
        await db.actualizarStand(codigo, { ...marca, propietarioId: null, propietarioDesde: null, historial: [...(s.historial || []), tramo] });
        if (anterior) {
          const linea = `El stand ${codigo} figura como stand de la asociación (${fechaTxt(hoyIso)}); quedó en el historial del stand. Revisar.`;
          await db.actualizarAsociado(anterior.id, { revisar: true, observaciones: [anterior.observaciones, linea].filter(Boolean).join("\n"), actualizadoAt: ahora });
        }
        r.conDueno++; r.marcados++;
        continue;
      }
      await db.actualizarStand(codigo, marca);
      r.marcados++;
    } catch (e) {
      r.errores.push(`${codigo}: ${e?.message || "no se pudo marcar."}`);
    }
  }
  return r;
}

/** Deja de ser stand de la Asociación (queda sin propietario hasta que se registre uno). */
export async function quitarDeAsociacion(codigo) {
  await db.actualizarStand(codigo, { deAsociacion: false, actualizadoAt: ahoraISO() });
}
