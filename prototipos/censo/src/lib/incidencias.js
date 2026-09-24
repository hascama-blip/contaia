// Reglas de incidencias y llamadas de atención (funciones puras).
import { LIMITE_INCIDENCIAS, LISTAS } from "../config.js";

export function ordenarRecientes(incidencias) {
  return [...incidencias].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
}

/** Asociados con LIMITE_INCIDENCIAS o más en los últimos 12 meses (regla de estatutos). */
export function alertasReincidencia(incidencias, hoyISO) {
  const desde = new Date(hoyISO);
  desde.setFullYear(desde.getFullYear() - 1);
  const corte = desde.toISOString().slice(0, 10);
  const conteo = new Map();
  for (const i of incidencias) {
    if (!i.asociadoId || String(i.fecha) < corte) continue;
    conteo.set(i.asociadoId, (conteo.get(i.asociadoId) || 0) + 1);
  }
  return [...conteo.entries()]
    .filter(([, n]) => n >= LIMITE_INCIDENCIAS)
    .map(([asociadoId, cantidad]) => ({ asociadoId, cantidad }))
    .sort((a, b) => b.cantidad - a.cantidad);
}

export function conteoPorTipo(incidencias, anio) {
  const conteo = new Map(LISTAS.tiposIncidencia.map((t) => [t, 0]));
  for (const i of incidencias) {
    if (anio && !String(i.fecha).startsWith(String(anio))) continue;
    conteo.set(i.tipo, (conteo.get(i.tipo) || 0) + 1);
  }
  return [...conteo.entries()].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
}

export function incidenciasDe(asociadoId, incidencias) {
  return ordenarRecientes(incidencias.filter((i) => i.asociadoId === asociadoId));
}

export function abiertas(incidencias) {
  return incidencias.filter((i) => i.estado !== "cerrada");
}
