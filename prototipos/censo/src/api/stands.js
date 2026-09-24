// Servicio de stands: editar giro, área, estado e inquilino.
import * as db from "../lib/db.js";
import { soloDigitos } from "../lib/validar.js";
import { ErrorValidacion } from "./asociados.js";

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
