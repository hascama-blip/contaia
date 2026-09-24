// Validación de la ficha del asociado. Devuelve { campo: mensaje } (vacío = todo bien).
import { leerCodigos, normalizar, nombreCompleto } from "./padron.js";

const DNI = /^\d{8}$/;
const CELULAR = /^9\d{8}$/;
const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function soloDigitos(s) {
  return String(s || "").replace(/\D/g, "");
}

/**
 * @param {object} f        ficha del formulario
 * @param {object} ctx      { asociados, stands, idActual }
 */
export function validarFicha(f, { asociados = [], stands = [], idActual = null } = {}) {
  const e = {};
  const otros = asociados.filter((a) => a.id !== idActual);

  if (!String(f.numero || "").trim()) e.numero = "Escribe el N° de asociado del libro de padrón.";
  else if (otros.some((a) => normalizar(a.numero) === normalizar(f.numero))) e.numero = `El N° ${f.numero} ya está asignado a otro asociado.`;

  if (!String(f.nombres || "").trim()) e.nombres = "Escribe los nombres.";
  if (!String(f.apellidoPaterno || "").trim()) e.apellidoPaterno = "Escribe el apellido paterno.";

  const dni = soloDigitos(f.dni);
  if (!DNI.test(dni)) e.dni = "El DNI debe tener 8 dígitos.";
  else {
    const repetido = otros.find((a) => a.dni === dni);
    if (repetido) e.dni = `Este DNI ya figura en la ficha de ${nombreCompleto(repetido)} (N° ${repetido.numero}).`;
  }

  if (f.celular && !CELULAR.test(soloDigitos(f.celular))) e.celular = "El celular debe tener 9 dígitos y empezar con 9.";
  if (f.correo && !CORREO.test(String(f.correo).trim())) e.correo = "Revisa el correo; falta la @ o el dominio.";
  if (f.conyuge?.dni && !DNI.test(soloDigitos(f.conyuge.dni))) e.conyugeDni = "El DNI del cónyuge debe tener 8 dígitos.";

  if (f.standsTexto !== undefined) {
    const { validos, invalidos } = leerCodigos(f.standsTexto);
    if (invalidos.length) e.stands = `No reconozco: ${invalidos.join(", ")}. Usa la letra de la galería y el número, p. ej. A-12.`;
    else if (!validos.length) e.stands = "Indica al menos un stand, p. ej. A-12.";
    else {
      const ocupado = validos
        .map((c) => stands.find((s) => s.id === c || s.codigo === c))
        .find((s) => s && s.propietarioId && s.propietarioId !== idActual);
      if (ocupado) {
        const dueno = asociados.find((a) => a.id === ocupado.propietarioId);
        e.stands = `El stand ${ocupado.codigo} ya figura a nombre de ${nombreCompleto(dueno)}. Si lo vendió, usa «Registrar venta o traspaso» en Stands; el anterior queda en el historial.`;
      }
    }
  }
  return e;
}

export function validarPago(p) {
  const e = {};
  if (!p.stand) e.stand = "Elige el stand.";
  if (!p.concepto) e.concepto = "Elige el concepto.";
  if (!p.mes) e.mes = "Elige el mes.";
  if (!(Number(p.monto) > 0)) e.monto = "El monto debe ser mayor que cero.";
  if (!p.medio) e.medio = "Elige el medio de pago.";
  if (p.medio && p.medio !== "Efectivo" && !String(p.operacion || "").trim()) e.operacion = "Anota el N° de operación del voucher.";
  return e;
}

export function validarIncidencia(i) {
  const e = {};
  if (!i.fecha) e.fecha = "Indica la fecha.";
  if (!i.asociadoId) e.asociadoId = "Elige el asociado o stand involucrado.";
  if (!i.tipo) e.tipo = "Elige el tipo.";
  if (!i.gravedad) e.gravedad = "Elige la gravedad.";
  if (!i.medida) e.medida = "Indica la medida adoptada.";
  if (i.responsable === "inquilino" && !String(i.involucrado || "").trim()) e.involucrado = "Escribe el nombre del inquilino.";
  return e;
}

/** Venta o traspaso de un stand. `nueva` = datos mínimos si el comprador no está en el padrón. */
export function validarTraspaso(t, { stand, hoyIso }) {
  const e = {};
  if (!t.fecha) e.fecha = "Indica la fecha de la venta o traspaso.";
  else if (hoyIso && t.fecha > hoyIso) e.fecha = "La fecha no puede ser futura.";
  else if (stand?.propietarioDesde && t.fecha < stand.propietarioDesde) e.fecha = "La fecha es anterior a la del propietario actual.";
  if (!t.motivo) e.motivo = "Elige el motivo.";
  if (t.modo === "existente") {
    if (!t.nuevoId) e.nuevoId = "Busca y elige al nuevo propietario.";
    else if (t.nuevoId === stand?.propietarioId) e.nuevoId = "Esa persona ya es la propietaria actual.";
  }
  return e;
}
