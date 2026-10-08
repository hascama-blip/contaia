// Servicio de stands: editar giro, área, estado e inquilino.
import * as db from "../lib/db.js";
import { soloDigitos, validarTraspaso } from "../lib/validar.js";
import { tramoDeSalida, numeroAHeredar } from "../lib/propietarios.js";
import { nombreCompleto } from "../lib/padron.js";
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
  if (stand.propietarioId) historial.push(tramoDeSalida(stand, anterior, { hasta: t.fecha, motivo: t.motivo, documento: String(t.documento || "").trim(), observacion: String(t.observacion || "").trim(), por, ahora }));
  const cambios = { propietarioId: nuevoId, propietarioDesde: t.fecha, historial };
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
