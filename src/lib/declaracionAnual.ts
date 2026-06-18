import type { DeclaracionAnual } from "./types";

// ============================================================
//  Declaración Jurada ANUAL (Formulario 710) — lectura PDF + comparativo
// ============================================================
// El 710 trae Estados Financieros (Balance) y Estado de Resultados con cada
// línea identificada por una casilla de 3 dígitos. El texto extraído del PDF
// mezcla códigos y montos, así que el parser va "dirigido por casilla": para
// cada código conocido busca su monto vecino (incluye montos pegados al código,
// p. ej. "78736359" = monto 78736 + casilla 359).

/** Etiquetas de las casillas del 710 (Balance y Estado de Resultados). */
export const CASILLAS_710: Record<string, string> = {
  // ----- Estados Financieros · ACTIVO -----
  "359": "Efectivo y equivalentes de efectivo",
  "360": "Inversiones financieras",
  "361": "Ctas. por cobrar comerciales - terceros",
  "362": "Ctas. por cobrar comerciales - relacionadas",
  "363": "Ctas. por cobrar al personal / socios / directores",
  "364": "Ctas. por cobrar diversas - terceros",
  "365": "Ctas. por cobrar diversas - relacionadas",
  "366": "Servicios y otros contratados por anticipado",
  "367": "Estimación de cobranza dudosa",
  "368": "Mercaderías",
  "369": "Productos terminados",
  "370": "Subproductos, desechos y desperdicios",
  "371": "Productos en proceso",
  "372": "Materias primas",
  "373": "Materias aux., suministros y repuestos",
  "374": "Envases y embalajes",
  "375": "Inventarios por recibir",
  "376": "Desvalorización de inventarios",
  "377": "Activos no ctes. mantenidos para la venta",
  "378": "Otros activos corrientes",
  "379": "Inversiones mobiliarias",
  "380": "Propiedades de inversión",
  "381": "Activos por derecho de uso",
  "382": "Propiedades, planta y equipo",
  "383": "Depreciación y PPE acumulados",
  "384": "Activos biológicos",
  "385": "Deprec. activo biológico / amortiz. acum.",
  "386": "Intangibles",
  "387": "Desvalorización de activo inmovilizado",
  "388": "Activo diferido",
  "389": "Otros activos no corrientes",
  "390": "TOTAL ACTIVO NETO",
  // ----- Estados Financieros · PASIVO -----
  "401": "Sobregiros bancarios",
  "402": "Tributos y aportes (pensiones/salud) por pagar",
  "403": "Remuneraciones y participaciones por pagar",
  "404": "Ctas. por pagar comerciales - terceros",
  "405": "Ctas. por pagar comerciales - relacionadas",
  "406": "Ctas. por pagar a accionistas / socios / directores",
  "407": "Ctas. por pagar diversas - terceros",
  "408": "Ctas. por pagar diversas - relacionadas",
  "409": "Obligaciones financieras",
  "410": "Provisiones",
  "411": "Pago diferido",
  "412": "TOTAL PASIVO",
  // ----- Estados Financieros · PATRIMONIO -----
  "414": "Capital",
  "415": "Capital adicional positivo",
  "416": "Capital adicional negativo",
  "417": "Resultados no realizados",
  "418": "Excedente de revaluación",
  "419": "Reservas",
  "420": "Resultados acumulados positivos",
  "421": "Resultados acumulados negativos",
  "422": "Acciones de inversión",
  "423": "Utilidad del ejercicio",
  "424": "Pérdida del ejercicio",
  "425": "TOTAL PATRIMONIO",
  "426": "TOTAL PASIVO Y PATRIMONIO",
  // ----- Estado de Resultados -----
  "461": "Ventas netas o ingresos por servicios",
  "462": "Descuentos, rebajas y bonif. concedidas",
  "463": "Ventas netas",
  "464": "Costo de ventas",
  "466": "Resultado bruto - utilidad",
  "467": "Resultado bruto - pérdida",
  "468": "Gasto de ventas",
  "469": "Gasto de administración",
  "470": "Resultado de operación - utilidad",
  "471": "Resultado de operación - pérdida",
  "472": "Gastos financieros",
  "473": "Ingresos financieros gravados",
  "475": "Otros ingresos gravados",
  "476": "Otros ingresos no gravados",
  "477": "Enajenación de valores y bienes del A.F.",
  "478": "Costo enajen. de valores y bienes A.F.",
  "480": "Gastos diversos",
  "481": "REI del ejercicio - positivo",
  "484": "Resultado antes de participaciones - utilidad",
  "485": "Resultado antes de participaciones - pérdida",
  "486": "Distribución legal de la renta",
  "487": "Resultado antes del impuesto - utilidad",
  "489": "Resultado antes del impuesto - pérdida",
  "490": "Resultado del ejercicio - utilidad",
  "492": "Resultado del ejercicio - pérdida",
  "493": "Impuesto a la renta - gasto",
};

const CODIGOS = new Set(Object.keys(CASILLAS_710));

/** Sección a la que pertenece una casilla por su rango numérico. */
export function seccionDe(codigo: string): "balance" | "resultados" | "otro" {
  const n = Number(codigo);
  if (n >= 359 && n <= 426) return "balance";
  if (n >= 461 && n <= 499) return "resultados";
  return "otro";
}

/** Reexporta el lector de PDF (mismo de las DJ mensuales). */
export { extraerTextoPdf } from "./declaracion";

function aMonto(s: string): number {
  const neg = /^\(.*\)$/.test(s.trim());
  const n = Number(s.replace(/[(),\s]/g, ""));
  if (Number.isNaN(n)) return NaN;
  return neg ? -n : n;
}

const ES_MONTO = /^\(?-?[\d,]+\)?$/;

/** Detecta el ejercicio "YYYY" del 710. */
function detectarEjercicio(t: string): string {
  const m1 = t.match(/renta\s+anual\s+(\d{4})/i);
  if (m1) return m1[1];
  const m2 = t.match(/per[ií]odo\s*:?\s*(\d{4})13/i);
  if (m2) return m2[1];
  const m3 = t.match(/\b(\d{4})13\b/);
  if (m3) return m3[1];
  return "";
}

function detectarRazonSocial(t: string): string | undefined {
  const m = t.match(/(?:nombre o )?raz[oó]n social\s*:?\s*([A-Za-zÑñÁÉÍÓÚáéíóú0-9 .,&'-]{3,60}?)\s*(?:n[uú]mero|per[ií]odo|ruc|tipo|\d{6}|:)/i);
  if (m) return m[1].replace(/\s+/g, " ").trim();
  return undefined;
}

/** Parsea un 710 a un borrador (sin id ni persistir). */
export function parseAnual(
  texto: string
): Omit<DeclaracionAnual, "id" | "cargadoAt" | "fuente" | "archivoNombre"> {
  const t = texto.replace(/ /g, " ");

  // Tokeniza y separa montos pegados a un código conocido (p. ej. "78736359").
  const tokens: string[] = [];
  for (const raw of t.split(/\s+/)) {
    const m = raw.match(/^(\(?-?[\d,]+\)?)(\d{3})$/);
    if (m && CODIGOS.has(m[2]) && m[1] !== "") {
      tokens.push(m[1], m[2]);
    } else {
      tokens.push(raw);
    }
  }

  const valores: Record<string, number> = {};
  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];
    if (!CODIGOS.has(tk) || tk in valores) continue;
    // Toma el monto vecino: primero el siguiente, luego el anterior, evitando
    // que el "monto" sea en realidad otro código de casilla.
    const next = tokens[i + 1];
    const prev = tokens[i - 1];
    let val: number | null = null;
    if (next && ES_MONTO.test(next) && !CODIGOS.has(next)) val = aMonto(next);
    else if (prev && ES_MONTO.test(prev) && !CODIGOS.has(prev)) val = aMonto(prev);
    if (val !== null && !Number.isNaN(val)) valores[tk] = val;
  }

  const rucMatch = t.match(/\b((?:10|15|16|17|20)\d{9})\b/);
  const formMatch = t.match(/formulario\D{0,12}?(\d{3,4})/i) || t.match(/\b(0?710)\b/);

  return {
    ejercicio: detectarEjercicio(t),
    ruc: rucMatch?.[1],
    razonSocial: detectarRazonSocial(t),
    formulario: formMatch?.[1],
    valores,
  };
}

// ---- Comparativo año vs año -------------------------------------------------

export interface FilaAnual {
  codigo: string;
  etiqueta: string;
  /** Monto por ejercicio. */
  valores: Record<string, number>;
  /** Variación del último ejercicio vs el anterior. */
  variacion: number;
  porcentaje: number;
  /** true = variación grande (a resaltar). */
  resaltar: boolean;
}

export interface SeccionAnual {
  titulo: string;
  filas: FilaAnual[];
}

export interface ComparativoAnual {
  ejercicios: string[];
  secciones: SeccionAnual[];
  observaciones: string[];
}

const TITULO_SECCION: Record<string, string> = {
  balance: "ESTADOS FINANCIEROS",
  resultados: "ESTADO DE RESULTADOS",
};

/** Construye el comparativo año vs año a partir de las DJ anuales cargadas. */
export function compararAnual(declaraciones: DeclaracionAnual[]): ComparativoAnual {
  const decls = [...declaraciones].sort((a, b) => a.ejercicio.localeCompare(b.ejercicio));
  const ejercicios = decls.map((d) => d.ejercicio);
  const ultimo = ejercicios[ejercicios.length - 1];
  const previo = ejercicios[ejercicios.length - 2];

  // Casillas presentes (con valor en algún ejercicio) dentro de las 2 secciones.
  const codigos = new Set<string>();
  for (const d of decls) {
    for (const cod of Object.keys(d.valores)) {
      const s = seccionDe(cod);
      if (s === "balance" || s === "resultados") codigos.add(cod);
    }
  }

  const filasPorSeccion: Record<string, FilaAnual[]> = { balance: [], resultados: [] };
  const observaciones: string[] = [];

  for (const cod of Array.from(codigos).sort((a, b) => Number(a) - Number(b))) {
    const seccion = seccionDe(cod);
    const valores: Record<string, number> = {};
    for (const d of decls) valores[d.ejercicio] = d.valores[cod] ?? 0;
    const vUlt = ultimo ? valores[ultimo] ?? 0 : 0;
    const vPrev = previo ? valores[previo] ?? 0 : 0;
    const variacion = Math.round((vUlt - vPrev) * 100) / 100;
    const base = Math.abs(vPrev);
    const porcentaje = base !== 0 ? Math.round((variacion / base) * 10000) / 100 : vUlt !== 0 ? 100 : 0;
    filasPorSeccion[seccion].push({
      codigo: cod,
      etiqueta: CASILLAS_710[cod] ?? `Casilla ${cod}`,
      valores,
      variacion,
      porcentaje,
      resaltar: false,
    });
  }

  // Resaltar las variaciones más grandes (en monto) y volcarlas a observaciones.
  if (previo) {
    for (const seccion of ["balance", "resultados"] as const) {
      const filas = filasPorSeccion[seccion];
      const grandes = [...filas]
        .filter((f) => Math.abs(f.variacion) > 0)
        .sort((a, b) => Math.abs(b.variacion) - Math.abs(a.variacion))
        .slice(0, 3);
      for (const f of grandes) {
        f.resaltar = true;
        const signo = f.variacion > 0 ? "▲ subió" : "▼ bajó";
        observaciones.push(
          `${TITULO_SECCION[seccion]} · ${f.etiqueta}: ${signo} ${fmt(Math.abs(f.variacion))} (${f.porcentaje > 0 ? "+" : ""}${f.porcentaje.toFixed(0)}%) entre ${previo} y ${ultimo}.`
        );
      }
    }
  }

  const secciones: SeccionAnual[] = (["balance", "resultados"] as const)
    .filter((s) => filasPorSeccion[s].length > 0)
    .map((s) => ({ titulo: TITULO_SECCION[s], filas: filasPorSeccion[s] }));

  return { ejercicios, secciones, observaciones };
}

function fmt(n: number): string {
  return `S/ ${n.toLocaleString("es-PE", { minimumFractionDigits: 2 })}`;
}
