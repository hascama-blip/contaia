// Reglas de cobranza: estado de cada cuota, deuda por stand, morosidad y recaudación.
// Funciones puras (no tocan la base).
import { CONCEPTOS, GALERIAS } from "../config.js";
import { pad } from "./formato.js";
import { idPagos } from "./db.js";

export function claveRegistro(conceptoId, mes) {
  return `${conceptoId}-${pad(mes)}`;
}

export function conceptoAplica(concepto, mes) {
  return Boolean(concepto.mensual || concepto.meses?.includes(pad(mes)));
}

/** "pagado" | "pendiente" (mes en curso) | "vencido" | "futuro" | "na" (no se cobra ese mes) */
export function estadoCuota(registros, concepto, mes, anio, h) {
  if (!conceptoAplica(concepto, mes)) return "na";
  if (registros?.[claveRegistro(concepto.id, mes)]) return "pagado";
  if (anio < h.anio || (anio === h.anio && mes < h.mes)) return "vencido";
  if (anio === h.anio && mes === h.mes) return "pendiente";
  return "futuro";
}

export function indicePagos(pagos) {
  return new Map(pagos.map((p) => [p.id, p]));
}

export function registrosDe(indice, stand, anio) {
  return indice.get(idPagos(stand, anio))?.registros || {};
}

/** Deuda vencida de un stand en el año: monto, meses con atraso y detalle. */
export function deudaStand(registros, anio, h) {
  const detalle = [];
  const meses = new Set();
  const ultimo = anio < h.anio ? 12 : anio === h.anio ? h.mes - 1 : 0;
  for (let mes = 1; mes <= ultimo; mes++) {
    for (const c of CONCEPTOS) {
      if (estadoCuota(registros, c, mes, anio, h) === "vencido") {
        detalle.push({ concepto: c, mes, monto: c.monto });
        meses.add(mes);
      }
    }
  }
  return { monto: detalle.reduce((s, d) => s + d.monto, 0), meses: meses.size, detalle };
}

export function etiquetaAtraso(meses) {
  if (!meses) return "Al día";
  return meses === 1 ? "1 mes" : `${meses} meses`;
}

/** Stand por stand, con su deuda. Solo los que deben. */
export function standsMorosos(stands, indice, anio, h) {
  return stands
    .map((s) => ({ stand: s, deuda: deudaStand(registrosDe(indice, s.codigo, anio), anio, h) }))
    .filter((x) => x.deuda.monto > 0)
    .sort((a, b) => b.deuda.monto - a.deuda.monto);
}

export function morosidadPorGaleria(morosos) {
  const filas = GALERIAS.map((g) => {
    const suyos = morosos.filter((m) => m.stand.galeria === g.id);
    return { ...g, morosos: suyos.length, deuda: suyos.reduce((s, m) => s + m.deuda.monto, 0) };
  });
  return { filas, total: filas.reduce((s, f) => s + f.deuda, 0), morosos: morosos.length };
}

/** Lo cobrado en un mes calendario (por fecha de pago), agrupado por concepto. */
export function recaudacionMes(pagos, anio, mes) {
  const prefijo = `${anio}-${pad(mes)}`;
  const porConcepto = Object.fromEntries(CONCEPTOS.map((c) => [c.id, 0]));
  for (const p of pagos) {
    for (const [clave, reg] of Object.entries(p.registros || {})) {
      if (!reg || !String(reg.fecha || "").startsWith(prefijo)) continue;
      const concepto = clave.split("-")[0];
      if (concepto in porConcepto) porConcepto[concepto] += Number(reg.monto) || 0;
    }
  }
  const filas = CONCEPTOS.map((c) => ({ ...c, cobrado: porConcepto[c.id] }));
  return { filas, total: filas.reduce((s, f) => s + f.cobrado, 0) };
}

/** Mayor atraso (en meses) entre los stands de un asociado. */
export function atrasoAsociado(standsDelAsociado, indice, anio, h) {
  let max = 0;
  let monto = 0;
  for (const s of standsDelAsociado || []) {
    const d = deudaStand(registrosDe(indice, s.codigo, anio), anio, h);
    max = Math.max(max, d.meses);
    monto += d.monto;
  }
  return { meses: max, monto };
}
