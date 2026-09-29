// Geometría del plano y colores por estado (funciones puras).
import { estadoCenso } from "./padron.js";

/** Stands del plano real: [{ codigo, galeria, puntos, x, y }] (x, y = dónde va el número). */
export function standsDelPlano(plano) {
  return plano.stands.map(([codigo, galeria, puntos, x, y]) => ({ codigo, galeria, puntos, x, y }));
}

/** Niveles de acercamiento del plano (1 = entra entero en la pantalla). */
export const ZOOMS = [1, 1.6, 2.4];

export const MODOS = {
  censo: "Fichas",
  pagos: "Pagos",
  ocupacion: "Ocupación",
};

/** Tono (clase CSS) de un stand según el modo elegido. */
export function tonoStand(modo, { stand, asociado, deuda }) {
  if (!stand || !asociado) return "vacio";
  if (modo === "pagos") {
    if (!deuda?.meses) return "ok";
    return deuda.meses >= 3 ? "peligro" : "alerta";
  }
  if (modo === "ocupacion") {
    return { propietario: "ok", alquilado: "info", cerrado: "neutro", litigio: "peligro" }[stand.estado] || "neutro";
  }
  return { verificado: "ok", actualizado: "info", pendiente: "alerta", sin_ubicar: "neutro" }[estadoCenso(asociado)] || "alerta";
}

export const LEYENDAS = {
  censo: [["ok", "Verificado"], ["info", "Actualizado"], ["alerta", "Pendiente"], ["neutro", "Sin ubicar"], ["vacio", "Sin ficha"]],
  pagos: [["ok", "Al día"], ["alerta", "1 a 2 meses"], ["peligro", "3 meses o más"], ["vacio", "Sin ficha"]],
  ocupacion: [["ok", "Propietario"], ["info", "Alquilado"], ["neutro", "Cerrado"], ["peligro", "En litigio"], ["vacio", "Sin ficha"]],
};
