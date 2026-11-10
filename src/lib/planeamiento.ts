// ============================================================
//  PLANEAMIENTO TRIBUTARIO del mes (IGV + pago a cuenta de renta)
// ============================================================
// Módulo PURO (sin Node): lo usa la ficha de la empresa en el navegador.
// Toma el resumen SIRE de ventas y compras de un periodo y estima lo que se
// pagará en la declaración mensual (PDT 621), con los datos manuales que el
// SIRE no trae: saldo a favor del mes anterior (casilla 145), percepciones,
// retenciones, coeficiente de renta y saldo a favor de renta.
//
// Es una ESTIMACIÓN para planificar: la declaración real puede variar por
// ajustes, prorrata, detracciones aplicadas, regímenes especiales, etc.

import type { SireResumen } from "./types";

export type Regimen = "general" | "mype" | "especial" | "rus" | "ninguno";

export const REGIMEN_LABEL: Record<Regimen, string> = {
  general: "Régimen General",
  mype: "Régimen MYPE Tributario",
  especial: "Régimen Especial (RER)",
  rus: "Nuevo RUS",
  ninguno: "Sin rentas de 3ra (persona sin negocio)",
};

/** UIT del ejercicio (ajustable): se usa para el tope de 300 UIT del RMT. */
export const UIT: Record<number, number> = { 2024: 5150, 2025: 5350, 2026: 5500 };
export const uitDe = (anio: number) => UIT[anio] ?? UIT[Math.max(...Object.keys(UIT).map(Number))];

export interface EntradasPlan {
  regimen: Regimen;
  /** Coeficiente de pago a cuenta (en %, p. ej. 1.2). Vacío = 1.5 %. */
  coeficiente?: number | null;
  /** Saldo a favor de IGV del periodo anterior (casilla 145 del PDT 621). */
  saldoFavorIgv: number;
  /** Percepciones de IGV del periodo (y saldo de percepciones no aplicadas). */
  percepciones: number;
  /** Retenciones de IGV del periodo (y saldo de retenciones no aplicadas). */
  retenciones: number;
  /** Saldo a favor de renta / pagos a cuenta en exceso aplicables. */
  saldoFavorRenta: number;
}

export const ENTRADAS_VACIAS = (regimen: Regimen): EntradasPlan => ({
  regimen, coeficiente: null, saldoFavorIgv: 0, percepciones: 0, retenciones: 0, saldoFavorRenta: 0,
});

/** Régimen según los tributos de la ficha SUNAT (si se puede deducir). */
export function regimenSugerido(tributos: string[] | undefined, ruc: string, negocio?: "con" | "sin"): Regimen {
  if (/^(10|15)/.test(ruc) && negocio === "sin") return "ninguno";
  const t = (tributos ?? []).join(" ").toUpperCase();
  if (/MYPE/.test(t)) return "mype";
  if (/R[EÉ]GIMEN ESPECIAL|\bRER\b/.test(t)) return "especial";
  if (/\bRUS\b|NUEVO R[ÉE]GIMEN [ÚU]NICO/.test(t)) return "rus";
  return "general";
}

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export interface ResultadoPlan {
  periodo: string;
  // IGV
  ventasBase: number; debitoFiscal: number;
  comprasBase: number; creditoFiscal: number;
  tributoResultante: number;        // débito − crédito
  saldoFavorAnterior: number;       // casilla 145 aplicada
  impuestoResultante: number;       // tras el saldo a favor (negativo = saldo a favor)
  percepcionesAplicadas: number; retencionesAplicadas: number;
  igvAPagar: number;
  saldoFavorSiguiente: number;      // saldo a favor de IGV que pasa al mes siguiente (casilla 145 del próximo)
  saldoPercepcionesSiguiente: number;
  // Renta
  ingresosNetos: number;
  ingresosAcumulados: number;       // del ejercicio, hasta este periodo (para el tope RMT)
  topeRmt: number;                  // 300 UIT
  tasaRenta: number;                // en %
  baseTasa: string;                 // explicación de la tasa
  pagoACuenta: number;
  saldoFavorRentaAplicado: number;
  rentaAPagar: number;
  // Total
  totalAPagar: number;
  recomendaciones: string[];
}

/**
 * Calcula el planeamiento del `periodo` con su resumen SIRE. `historial` (los
 * demás periodos del SIRE) sirve para el acumulado anual de ingresos (tope RMT).
 */
export function calcularPlaneamiento(s: SireResumen, e: EntradasPlan, historial: SireResumen[] = []): ResultadoPlan {
  const anio = Number(s.periodo.slice(0, 4));
  const rus = e.regimen === "rus", sinNegocio = e.regimen === "ninguno";

  // ---- IGV (estructura del PDT 621) ----
  const ventasBase = r2(s.ventas.baseImponible), debito = r2(s.ventas.igv);
  const comprasBase = r2(s.compras.baseImponible), credito = r2(s.compras.igv);
  const tributo = rus || sinNegocio ? 0 : r2(debito - credito);
  const saldoAnt = rus || sinNegocio ? 0 : r2(Math.max(0, e.saldoFavorIgv));
  const impuesto = r2(tributo - saldoAnt);
  let igvAPagar = 0, saldoSig = 0, percAp = 0, retAp = 0, saldoPerc = 0;
  const perc = Math.max(0, e.percepciones), ret = Math.max(0, e.retenciones);
  if (impuesto <= 0) {
    saldoSig = r2(-impuesto);
    saldoPerc = r2(perc + ret); // no se aplicaron: se arrastran como saldo
  } else {
    percAp = r2(Math.min(perc, impuesto));
    retAp = r2(Math.min(ret, impuesto - percAp));
    igvAPagar = r2(impuesto - percAp - retAp);
    saldoPerc = r2(perc + ret - percAp - retAp);
  }

  // ---- Renta: pago a cuenta / cuota ----
  const ingresos = r2(s.ventas.baseImponible + s.ventas.inafectoExonerado);
  const acumulado = r2(historial
    .filter((h) => h.periodo.slice(0, 4) === s.periodo.slice(0, 4) && h.periodo <= s.periodo)
    .reduce((a, h) => a + h.ventas.baseImponible + h.ventas.inafectoExonerado, 0) || ingresos);
  const tope = 300 * uitDe(anio);
  const coef = e.coeficiente && e.coeficiente > 0 ? e.coeficiente : null;
  let tasa = 0, baseTasa = "", pago = 0;
  if (e.regimen === "general") { tasa = coef ?? 1.5; baseTasa = coef ? `coeficiente ${coef}% (DJ anual anterior)` : "1.5% (sin coeficiente)"; }
  else if (e.regimen === "mype") {
    if (acumulado <= tope) { tasa = 1; baseTasa = "1% (ingresos del año hasta 300 UIT)"; }
    else { tasa = coef ?? 1.5; baseTasa = coef ? `coeficiente ${coef}% (superó 300 UIT)` : "1.5% (superó 300 UIT, sin coeficiente)"; }
  }
  else if (e.regimen === "especial") { tasa = 1.5; baseTasa = "1.5% (cuota del RER)"; }
  if (e.regimen === "rus") {
    // Nuevo RUS: cuota fija mensual (incluye IGV e IR) según ingresos del mes.
    pago = s.ventas.importeTotal <= 5000 ? 20 : 50;
    baseTasa = pago === 20 ? "cuota fija categoría 1 (ingresos ≤ S/ 5,000)" : "cuota fija categoría 2 (ingresos ≤ S/ 8,000)";
  } else {
    pago = r2(Math.max(0, ingresos) * tasa / 100);
  }
  const saldoRentaAp = r2(Math.min(Math.max(0, e.saldoFavorRenta), pago));
  const renta = r2(pago - saldoRentaAp);
  const total = r2(igvAPagar + renta);

  // ---- Recomendaciones de planeamiento ----
  const rec: string[] = [];
  const f = (n: number) => `S/ ${n.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (sinNegocio) rec.push("Persona sin negocio: no declara IGV ni pagos a cuenta de 3ra categoría en el PDT 621.");
  else if (rus) rec.push("Nuevo RUS: paga solo la cuota fija; no aplica crédito fiscal ni pagos a cuenta. Si los ingresos o compras del mes superan S/ 8,000, revisa si sigue cumpliendo los requisitos del RUS.");
  else {
    if (igvAPagar > 0) {
      rec.push(`Para no pagar IGV este mes se necesitarían unos ${f(r2(igvAPagar / 0.18))} más de compras gravadas (base imponible), con comprobante válido, anotadas en el registro del periodo. Solo conviene si son compras reales y necesarias para el negocio.`);
      if (perc + ret === 0) rec.push("Si la empresa sufrió percepciones o retenciones de IGV en el mes (constancias de clientes o proveedores agentes), regístralas: reducen el IGV a pagar.");
    } else if (saldoSig > 0) {
      rec.push(`${saldoAnt > 0 ? "El crédito fiscal y el saldo a favor anterior cubren" : "El crédito fiscal supera"} al débito: queda un saldo a favor de IGV de ${f(saldoSig)} que se arrastra al próximo mes (casilla 145).`);
    }
    if (saldoPerc > 0) rec.push(`Queda un saldo de percepciones/retenciones no aplicado de ${f(saldoPerc)} para los meses siguientes (o para solicitar su devolución).`);
    if (e.regimen === "general" && !coef) rec.push("Sin coeficiente se paga el 1.5% de los ingresos. Si la DJ anual anterior tuvo impuesto calculado, el coeficiente (impuesto ÷ ingresos) puede ser menor: ingrésalo para estimar mejor.");
    if (e.regimen === "mype" && acumulado > tope * 0.85 && acumulado <= tope) rec.push(`Los ingresos del año (${f(acumulado)}) se acercan al tope de 300 UIT (${f(tope)}): al superarlo, el pago a cuenta deja de ser 1% y pasa al coeficiente o 1.5%.`);
    if (credito > 0 && debito > 0 && credito / debito > 0.9) rec.push("El crédito fiscal es casi igual al débito: verifica que las compras cumplan los requisitos (comprobante válido, bancarización, anotación oportuna) para no perder el crédito en una fiscalización.");
  }
  if (e.regimen !== "rus" && !sinNegocio && renta > 0) rec.push(`El pago a cuenta de renta (${f(renta)}) se descuenta luego en la DJ anual.`);

  return {
    periodo: s.periodo,
    ventasBase, debitoFiscal: debito, comprasBase, creditoFiscal: credito,
    tributoResultante: tributo, saldoFavorAnterior: saldoAnt, impuestoResultante: impuesto,
    percepcionesAplicadas: percAp, retencionesAplicadas: retAp, igvAPagar, saldoFavorSiguiente: saldoSig, saldoPercepcionesSiguiente: saldoPerc,
    ingresosNetos: ingresos, ingresosAcumulados: acumulado, topeRmt: tope, tasaRenta: tasa, baseTasa, pagoACuenta: pago,
    saldoFavorRentaAplicado: saldoRentaAp, rentaAPagar: renta,
    totalAPagar: total, recomendaciones: rec,
  };
}
