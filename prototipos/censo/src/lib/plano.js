// Geometría del plano y colores por estado (funciones puras).
import { estadoCenso } from "./padron.js";

const pad = (n) => String(n).padStart(2, "0");

/** Expande los bloques del plano en stands con posición: [{ codigo, galeria, x, y, w, h }]. */
export function standsDelPlano(plano) {
  const salida = [];
  const { anchoStand: sw, altoStand: sh, pasillo } = plano.corredor;
  for (const b of plano.bloques) {
    if (b.tipo === "corredor") {
      for (let i = 0; i < b.porLado; i++) {
        salida.push({ codigo: `${b.galeria}-${pad(i + 1)}`, galeria: b.galeria, x: b.x, y: b.y + i * sh, w: sw, h: sh });
        salida.push({ codigo: `${b.galeria}-${pad(b.porLado + i + 1)}`, galeria: b.galeria, x: b.x + sw + pasillo, y: b.y + i * sh, w: sw, h: sh });
      }
    } else if (b.tipo === "fila") {
      for (let i = 0; i < b.n; i++) {
        salida.push({ codigo: `${b.galeria}-${pad(i + 1)}`, galeria: b.galeria, x: b.x + i * b.w, y: b.y, w: b.w, h: b.h });
      }
    } else if (b.tipo === "stands") {
      for (const s of b.stands) salida.push({ galeria: b.galeria, ...s });
    }
  }
  return salida;
}

/** Pasillo interior y rótulo de cada galería tipo corredor. */
export function corredoresDelPlano(plano) {
  const { anchoStand: sw, altoStand: sh, pasillo } = plano.corredor;
  return plano.bloques
    .filter((b) => b.tipo === "corredor")
    .map((b) => {
      const alto = b.porLado * sh;
      return {
        galeria: b.galeria,
        pasillo: { x: b.x + sw, y: b.y, w: pasillo, h: alto },
        rotulo: { x: b.x + sw + pasillo / 2, y: b.abre === "abajo" ? b.y + alto + 16 : b.y - 8 },
      };
    });
}

export const MODOS = {
  censo: "Censo",
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
