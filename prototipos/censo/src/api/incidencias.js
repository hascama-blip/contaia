// Servicio de incidencias: registrar y cambiar de estado.
import * as db from "../lib/db.js";
import { validarIncidencia } from "../lib/validar.js";
import { ahoraISO } from "../lib/formato.js";
import { ErrorValidacion } from "./asociados.js";

export async function registrarIncidencia(i, { por } = {}) {
  const errores = validarIncidencia(i);
  if (Object.keys(errores).length) throw new ErrorValidacion(errores);
  const id = await db.nuevoId("incidencias");
  await db.guardarIncidencia(id, {
    fecha: i.fecha,
    asociadoId: i.asociadoId,
    stand: i.stand || "",
    involucrado: String(i.involucrado || "").trim(),
    tipo: i.tipo,
    gravedad: i.gravedad,
    medida: i.medida,
    estado: i.estado || "abierta",
    detalle: String(i.detalle || "").trim(),
    por: por || null,
    creadoAt: ahoraISO(),
  });
  return id;
}

export async function cambiarEstadoIncidencia(id, estado) {
  await db.actualizarIncidencia(id, { estado });
}
