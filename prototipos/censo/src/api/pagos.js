// Servicio de pagos: valida y registra una cuota pagada.
import * as db from "../lib/db.js";
import { validarPago } from "../lib/validar.js";
import { claveRegistro } from "../lib/pagos.js";
import { ErrorValidacion } from "./asociados.js";

export async function registrarPago(p, { por } = {}) {
  const errores = validarPago(p);
  if (Object.keys(errores).length) throw new ErrorValidacion(errores);
  const registro = {
    monto: Number(p.monto),
    medio: p.medio,
    operacion: String(p.operacion || "").trim(),
    fecha: p.fecha,
    por: por || null,
  };
  await db.escribirRegistroPago(p.stand, Number(p.anio), claveRegistro(p.concepto, Number(p.mes)), registro);
}

/** Anula un pago mal registrado (la cuota vuelve a figurar como pendiente/vencida). */
export async function anularPago(stand, anio, clave) {
  await db.escribirRegistroPago(stand, anio, clave, null);
}
