// ============================================================
//  PROYECCIÓN TRIBUTARIA (utilitario) — arma los datos del informe
// ============================================================
// No consulta SUNAT: toma lo que YA se generó para la empresa y el periodo en
//   1) Reporte analítico de auditoría → SIRE del mes (resumen: `Cliente.sire`)
//   2) Detalle SIRE → comprobante por comprobante (`Cliente.sireDetalle`)
// y con eso calcula la proyección (lib/planeamiento.ts) + el análisis del detalle
// (por tipo de comprobante, principales clientes y proveedores) y el cuadre
// resumen vs detalle. El crédito a favor de la DJ anterior se ingresa a mano.

import type { Cliente, SireBloque, SireResumen, PlaneamientoEntradas } from "./types";
import type { CompNorm } from "./cruceSire";
import { sireDesdeDetalle } from "./conciliacionSire";
import { calcularPlaneamiento, regimenSugerido, ENTRADAS_VACIAS, type EntradasPlan, type Regimen, type ResultadoPlan } from "./planeamiento";
import { analisisCierre, type CierrePeriodo } from "./cronogramaSunat";

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export const TIPO_DOC: Record<string, string> = {
  "1": "Factura", "3": "Boleta de venta", "7": "Nota de crédito", "8": "Nota de débito",
  "12": "Ticket", "14": "Recibo de servicios públicos", "2": "Recibo por honorarios",
  "50": "DUA / DAM (importación)", "91": "Comprobante de no domiciliado", "0": "Otros",
};
const nombreTipo = (t: string) => TIPO_DOC[t] ?? `Tipo ${t || "—"}`;

export interface GrupoDetalle { nombre: string; ruc?: string; comprobantes: number; base: number; igv: number; noGravado: number; total: number; pct: number }
export interface AnalisisDetalle {
  comprobantes: number;
  base: number; igv: number; noGravado: number; total: number;
  /** Comprobantes en moneda extranjera (ya convertidos a soles con su tipo de cambio). */
  monedaExtranjera: number;
  notasCredito: { comprobantes: number; total: number };
  porTipo: GrupoDetalle[];
  /** Principales clientes (ventas) o proveedores (compras), por total. */
  top: GrupoDetalle[];
  /** Cuántas contrapartes distintas hay. */
  contrapartes: number;
  at: string;
}

export function analizarDetalle(comps: CompNorm[], at: string): AnalisisDetalle {
  const tot = { base: 0, igv: 0, noGravado: 0, total: 0 };
  const tipos = new Map<string, GrupoDetalle>();
  const contra = new Map<string, GrupoDetalle>();
  let ext = 0, ncN = 0, ncT = 0;
  const acum = (m: Map<string, GrupoDetalle>, k: string, nombre: string, c: CompNorm, ruc?: string) => {
    let g = m.get(k);
    if (!g) { g = { nombre, ruc, comprobantes: 0, base: 0, igv: 0, noGravado: 0, total: 0, pct: 0 }; m.set(k, g); }
    g.comprobantes++; g.base += c.baseGravada; g.igv += c.igv; g.noGravado += c.noGravado; g.total += c.total;
    if (!g.nombre && nombre) g.nombre = nombre;
  };
  for (const c of comps) {
    tot.base += c.baseGravada; tot.igv += c.igv; tot.noGravado += c.noGravado; tot.total += c.total;
    if (c.moneda && !["PEN", "SOL", "SOLES", "S/"].includes(c.moneda) && c.tipoCambio > 0) ext++;
    if (c.tipoDoc === "7") { ncN++; ncT += c.total; }
    acum(tipos, c.tipoDoc, nombreTipo(c.tipoDoc), c);
    const k = c.rucContraparte || c.razonSocial || "—";
    acum(contra, k, c.razonSocial || (c.rucContraparte ? "" : "Sin identificar (boletas / varios)"), c, c.rucContraparte || undefined);
  }
  const cerrar = (g: GrupoDetalle): GrupoDetalle => ({
    ...g, base: r2(g.base), igv: r2(g.igv), noGravado: r2(g.noGravado), total: r2(g.total),
    pct: tot.total ? Math.round((g.total / tot.total) * 1000) / 10 : 0,
  });
  const orden = (a: GrupoDetalle, b: GrupoDetalle) => Math.abs(b.total) - Math.abs(a.total);
  return {
    comprobantes: comps.length,
    base: r2(tot.base), igv: r2(tot.igv), noGravado: r2(tot.noGravado), total: r2(tot.total),
    monedaExtranjera: ext,
    notasCredito: { comprobantes: ncN, total: r2(ncT) },
    porTipo: Array.from(tipos.values()).map(cerrar).sort(orden),
    top: Array.from(contra.values()).map(cerrar).sort(orden).slice(0, 10),
    contrapartes: contra.size,
    at,
  };
}

const bloqueDe = (a: AnalisisDetalle | null): SireBloque =>
  a ? { comprobantes: a.comprobantes, baseImponible: a.base, igv: a.igv, inafectoExonerado: a.noGravado, importeTotal: a.total }
    : { comprobantes: 0, baseImponible: 0, igv: 0, inafectoExonerado: 0, importeTotal: 0 };

/** De dónde salen los montos del cálculo. */
export type BaseCalculo = "resumen" | "detalle";

export interface Cuadre { libro: "ventas" | "compras"; concepto: string; resumen: number; detalle: number; diferencia: number }

export interface Proyeccion {
  empresa: { id: string; razonSocial: string; ruc: string };
  periodo: string;                       // AAAAMM
  fuentes: {
    resumen: { at: string } | null;      // SIRE del mes (Reporte analítico)
    detalleVentas: { comprobantes: number; at: string } | null;
    detalleCompras: { comprobantes: number; at: string } | null;
  };
  /** Avisos de lectura (p. ej. un detalle guardado que no se pudo interpretar). */
  avisos: string[];
  resumen: SireResumen | null;
  ventas: AnalisisDetalle | null;
  compras: AnalisisDetalle | null;
  /** Resumen vs detalle (solo si están ambos). */
  cuadre: Cuadre[];
  cuadra: boolean;
  /** Base recomendada / usada para el cálculo. */
  base: BaseCalculo | null;
  basesDisponibles: BaseCalculo[];
  /** Montos del periodo según cada base (para recalcular en pantalla al editar los datos manuales). */
  calc: Partial<Record<BaseCalculo, SireResumen>>;
  /** Resumen SIRE de los demás meses (acumulado anual para el tope del RMT). */
  historial: SireResumen[];
  regimenSugerido: Regimen;
  entradas: EntradasPlan;
  /** true si las entradas vienen guardadas para este periodo. */
  guardado: boolean;
  resultado: ResultadoPlan | null;
  cierre: CierrePeriodo | null;
}

const anterior = (p: string) => { const y = Number(p.slice(0, 4)), m = Number(p.slice(4, 6)); return m === 1 ? `${y - 1}12` : `${y}${String(m - 1).padStart(2, "0")}`; };

/** Resumen SIRE "equivalente" armado con el detalle (cuando se calcula con el detalle). */
function resumenDesdeDetalle(periodo: string, v: AnalisisDetalle | null, c: AnalisisDetalle | null, at: string): SireResumen {
  return { periodo, ventas: bloqueDe(v), compras: bloqueDe(c), presentadoVentas: false, presentadoCompras: false, fuente: "oficial", consultadoAt: at };
}

/** Periodos (AAAAMM, del más reciente al más antiguo) con SIRE resumen o detalle. */
export function periodosConSire(c: Cliente): string[] {
  const set = new Set<string>((c.sire ?? []).map((s) => s.periodo));
  for (const k of Object.keys(c.sireDetalle ?? {})) { const m = /^(ventas|compras)-(\d{6})$/.exec(k); if (m) set.add(m[2]); }
  return Array.from(set).sort((a, b) => b.localeCompare(a));
}

export function armarProyeccion(
  c: Cliente, periodo: string, hoy: string,
  opc: { entradas?: Partial<PlaneamientoEntradas> | null; base?: BaseCalculo | null } = {},
): Proyeccion {
  const avisos: string[] = [];
  const resumen = (c.sire ?? []).find((s) => s.periodo === periodo) ?? null;
  const leer = (tipo: "ventas" | "compras"): AnalisisDetalle | null => {
    const b = c.sireDetalle?.[`${tipo}-${periodo}`];
    if (!b) return null;
    if (!b.filas?.length) return analizarDetalle([], b.at); // extraído sin movimiento
    const s = sireDesdeDetalle(b, `${tipo}-${periodo}`, `Detalle SIRE ${tipo}`);
    if (typeof s === "string") { avisos.push(`No se pudo leer el Detalle SIRE de ${tipo}: vuelve a extraerlo.`); return null; }
    return analizarDetalle(s.comprobantes, b.at);
  };
  const ventas = leer("ventas"), compras = leer("compras");

  // Cuadre resumen vs detalle (tolerancia S/ 1).
  const cuadre: Cuadre[] = [];
  if (resumen) {
    const add = (libro: "ventas" | "compras", a: AnalisisDetalle | null, b: SireBloque) => {
      if (!a) return;
      cuadre.push({ libro, concepto: "Base imponible", resumen: r2(b.baseImponible), detalle: a.base, diferencia: r2(b.baseImponible - a.base) });
      cuadre.push({ libro, concepto: "IGV", resumen: r2(b.igv), detalle: a.igv, diferencia: r2(b.igv - a.igv) });
      cuadre.push({ libro, concepto: "Comprobantes", resumen: b.comprobantes, detalle: a.comprobantes, diferencia: b.comprobantes - a.comprobantes });
    };
    add("ventas", ventas, resumen.ventas); add("compras", compras, resumen.compras);
  }
  const cuadra = cuadre.every((x) => x.concepto === "Comprobantes" || Math.abs(x.diferencia) <= 1);

  const basesDisponibles: BaseCalculo[] = [];
  if (resumen) basesDisponibles.push("resumen");
  if (ventas && compras) basesDisponibles.push("detalle");
  // Por defecto el resumen; si hay moneda extranjera o no cuadra, el detalle (está en soles).
  const preferida: BaseCalculo | null = !basesDisponibles.length ? null
    : basesDisponibles.includes("detalle") && (!resumen || !cuadra) ? "detalle" : basesDisponibles[0];
  const base = opc.base && basesDisponibles.includes(opc.base) ? opc.base : preferida;

  // Entradas manuales: las que llegan (pantalla) > guardadas > sugeridas del mes anterior.
  const sugerido = regimenSugerido(c.sunat?.tributos, c.ruc, c.negocio);
  const g = c.planeamiento?.[periodo];
  let entradas: EntradasPlan = { ...ENTRADAS_VACIAS(sugerido), ...(g ?? {}) };
  if (!g) {
    const gAnt = c.planeamiento?.[anterior(periodo)];
    const sAnt = (c.sire ?? []).find((s) => s.periodo === anterior(periodo));
    if (gAnt) {
      entradas.regimen = gAnt.regimen; entradas.coeficiente = gAnt.coeficiente ?? null;
      if (sAnt) {
        const rAnt = calcularPlaneamiento(sAnt, { ...ENTRADAS_VACIAS(sugerido), ...gAnt }, c.sire ?? []);
        entradas.saldoFavorIgv = rAnt.saldoFavorSiguiente;
        entradas.percepciones = rAnt.saldoPercepcionesSiguiente;
      }
    }
  }
  if (opc.entradas) entradas = { ...entradas, ...limpiarEntradas(opc.entradas, entradas.regimen) };

  const calc: Partial<Record<BaseCalculo, SireResumen>> = {};
  if (resumen) calc.resumen = resumen;
  if (ventas && compras) calc.detalle = resumenDesdeDetalle(periodo, ventas, compras, ventas.at);
  const sCalc = base ? calc[base] ?? null : null;
  // Acumulado anual (tope RMT): los demás meses salen del resumen SIRE; el mes en análisis, de la base elegida.
  const historial = (c.sire ?? []).filter((s) => s.periodo !== periodo && s.periodo.slice(0, 4) === periodo.slice(0, 4));
  const resultado = sCalc ? calcularPlaneamiento(sCalc, entradas, [...historial, sCalc]) : null;

  return {
    empresa: { id: c.id, razonSocial: c.razonSocial, ruc: c.ruc },
    periodo,
    fuentes: {
      resumen: resumen ? { at: resumen.consultadoAt } : null,
      detalleVentas: ventas ? { comprobantes: ventas.comprobantes, at: ventas.at } : null,
      detalleCompras: compras ? { comprobantes: compras.comprobantes, at: compras.at } : null,
    },
    avisos, resumen, ventas, compras, cuadre, cuadra, base, basesDisponibles, calc, historial,
    regimenSugerido: sugerido, entradas, guardado: Boolean(g), resultado,
    cierre: analisisCierre(c.ruc, periodo, hoy),
  };
}

const REGIMENES: Regimen[] = ["general", "mype", "especial", "rus", "ninguno"];
const num = (v: unknown) => { const n = Number(String(v ?? "").replace(/,/g, "")); return Number.isFinite(n) ? Math.max(0, r2(n)) : 0; };

/** Valida lo que llega del navegador (montos ≥ 0, coeficiente entre 0 y 100). */
export function limpiarEntradas(b: Partial<Record<keyof PlaneamientoEntradas, unknown>> | null | undefined, regimenPorDefecto: Regimen = "general"): EntradasPlan {
  const coef = b?.coeficiente === null || b?.coeficiente === "" || b?.coeficiente === undefined ? 0 : num(b.coeficiente);
  return {
    regimen: REGIMENES.includes(b?.regimen as Regimen) ? (b!.regimen as Regimen) : regimenPorDefecto,
    coeficiente: coef > 0 && coef < 100 ? coef : null,
    saldoFavorIgv: num(b?.saldoFavorIgv), percepciones: num(b?.percepciones),
    retenciones: num(b?.retenciones), saldoFavorRenta: num(b?.saldoFavorRenta),
  };
}
