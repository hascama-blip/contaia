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

/**
 * Revierte un pago mal registrado: la cuota vuelve a figurar como pendiente/vencida y el
 * pago anulado queda guardado (monto, medio, operación, quién lo registró, quién lo anuló y por qué).
 */
export async function anularPago(stand, anio, clave, { por = null, motivo = "", registro = null } = {}) {
  if (!registro) throw new ErrorValidacion({ general: "Esa cuota no tiene un pago registrado." });
  await db.anularRegistroPago(stand, Number(anio), clave, { ...registro, clave, anuladoPor: por, anuladoAt: new Date().toISOString(), motivo: String(motivo || "").trim() });
}
