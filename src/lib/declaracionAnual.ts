import type { DeclaracionAnual } from "./types";

// ============================================================
//  Declaración Jurada ANUAL (Formulario 710) — lectura PDF + comparativo
// ============================================================
// El 710 trae Estados Financieros (Balance) y Estado de Resultados con cada
// línea identificada por una casilla de 3 dígitos. El texto plano del PDF viene
// MUY desordenado, así que leemos por COORDENADAS: reconstruimos las filas
// reales (agrupando ítems con y similar) y emparejamos cada casilla con su
// monto vecino, igual que se ve en el PDF. Así los totales cuadran.

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
  "415": "Acciones de inversión",
  "416": "Capital adicional positivo",
  "417": "Capital adicional negativo",
  "418": "Resultados no realizados",
  "419": "Excedentes de evaluación",
  "420": "Reservas",
  "421": "Resultados acumulados positivos",
  "422": "Resultados acumulados negativos",
  "423": "Utilidad del ejercicio",
  "424": "Pérdida del ejercicio",
  "425": "TOTAL PATRIMONIO",
  "426": "TOTAL PATRIMONIO Y PASIVO",
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
/** Casillas que son TOTALES (se resaltan y sirven para el cuadre). */
export const CASILLAS_TOTAL = new Set(["390", "412", "425", "426"]);

export function grupoBalance(codigo: string): "activo" | "pasivo" | "patrimonio" | null {
  const n = Number(codigo);
  if (n >= 359 && n <= 390) return "activo";
  if (n >= 401 && n <= 412) return "pasivo";
  if (n >= 414 && n <= 426) return "patrimonio";
  return null;
}
function esResultados(codigo: string): boolean {
  const n = Number(codigo);
  return n >= 461 && n <= 499;
}

const ES_MONTO = /^\(?-?[\d,]+\)?$/;
function aMonto(s: string): number {
  const neg = /^\(.*\)$/.test(s.trim());
  const n = Number(s.replace(/[(),\s]/g, ""));
  if (Number.isNaN(n)) return NaN;
  return neg ? -n : n;
}

/**
 * Lee el PDF por coordenadas y devuelve las FILAS reales (cada fila = lista de
 * tokens ordenados de izquierda a derecha). Agrupa ítems con `y` similar
 * (el código y su monto vienen en líneas separadas por ~1px).
 */
export async function extraerFilasPdf(buffer: Buffer): Promise<string[][]> {
  try {
    const { getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const filas: string[][] = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const tc = await page.getTextContent();
      const items = (tc.items as any[])
        .map((it) => ({ x: it.transform[4], y: it.transform[5], s: String(it.str ?? "").trim() }))
        .filter((o) => o.s);
      items.sort((a, b) => b.y - a.y);
      let cur: { y: number; items: typeof items } | null = null;
      const rows: { y: number; items: typeof items }[] = [];
      for (const it of items) {
        if (cur && Math.abs(it.y - cur.y) <= 2.5) cur.items.push(it);
        else {
          cur = { y: it.y, items: [it] };
          rows.push(cur);
        }
      }
      for (const r of rows) {
        r.items.sort((a, b) => a.x - b.x);
        filas.push(r.items.flatMap((o) => o.s.split(/\s+/)));
      }
    }
    return filas;
  } catch (err) {
    console.error("[declaracionAnual] No se pudo leer el PDF:", err);
    return [];
  }
}

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
  const m = t.match(
    /(?:nombre o )?raz[oó]n social\s*:?\s*([A-Za-zÑñÁÉÍÓÚáéíóú0-9 .,&'-]{3,60}?)\s*(?:n[uú]mero|per[ií]odo|ruc|tipo|\d{6}|:)/i
  );
  return m ? m[1].replace(/\s+/g, " ").trim() : undefined;
}

/** Parsea un 710 (a partir de sus filas) a un borrador sin id ni persistir. */
export function parseAnual(
  filas: string[][]
): Omit<DeclaracionAnual, "id" | "cargadoAt" | "fuente" | "archivoNombre"> {
  const valores: Record<string, number> = {};
  for (const row of filas) {
    for (let i = 0; i < row.length; i++) {
      const tk = row[i];
      if (!CODIGOS.has(tk) || tk in valores) continue;
      for (let j = i + 1; j < row.length; j++) {
        if (CODIGOS.has(row[j])) break; // empieza la siguiente casilla
        if (ES_MONTO.test(row[j])) {
          const val = aMonto(row[j]);
          if (!Number.isNaN(val)) valores[tk] = val;
          i = j;
          break;
        }
      }
    }
  }

  const texto = filas.map((r) => r.join(" ")).join(" ");
  const rucMatch = texto.match(/\b((?:10|15|16|17|20)\d{9})\b/);
  const formMatch = texto.match(/formulario\D{0,12}?(\d{3,4})/i) || texto.match(/\b(0?710)\b/);

  return {
    ejercicio: detectarEjercicio(texto),
    ruc: rucMatch?.[1],
    razonSocial: detectarRazonSocial(texto),
    formulario: formMatch?.[1],
    valores,
  };
}

// ---- Comparativo año vs año -------------------------------------------------

export interface FilaAnual {
  codigo: string;
  etiqueta: string;
  valores: Record<string, number>;
  variacion: number;
  porcentaje: number;
  resaltar: boolean;
  esTotal: boolean;
}

export interface CuadreAnual {
  ejercicio: string;
  activoNeto: number;
  patrimonioYPasivo: number;
  diferencia: number;
  cuadra: boolean;
}

export interface ComparativoAnual {
  ejercicios: string[];
  /** Balance agrupado como en el PDF. */
  activo: FilaAnual[];
  pasivo: FilaAnual[];
  patrimonio: FilaAnual[];
  resultados: FilaAnual[];
  /** true = el Estado de Resultados está completamente en cero. */
  resultadosVacio: boolean;
  cuadre: CuadreAnual[];
  observaciones: string[];
}

function fmt(n: number): string {
  return `S/ ${n.toLocaleString("es-PE", { minimumFractionDigits: 2 })}`;
}

export function compararAnual(declaraciones: DeclaracionAnual[]): ComparativoAnual {
  const decls = [...declaraciones].sort((a, b) => a.ejercicio.localeCompare(b.ejercicio));
  const ejercicios = decls.map((d) => d.ejercicio);
  const ultimo = ejercicios[ejercicios.length - 1];
  const previo = ejercicios[ejercicios.length - 2];

  function construirFila(cod: string): FilaAnual {
    const valores: Record<string, number> = {};
    for (const d of decls) valores[d.ejercicio] = d.valores[cod] ?? 0;
    const vUlt = ultimo ? valores[ultimo] ?? 0 : 0;
    const vPrev = previo ? valores[previo] ?? 0 : 0;
    const variacion = Math.round((vUlt - vPrev) * 100) / 100;
    const base = Math.abs(vPrev);
    const porcentaje = base !== 0 ? Math.round((variacion / base) * 10000) / 100 : vUlt !== 0 ? 100 : 0;
    return {
      codigo: cod,
      etiqueta: CASILLAS_710[cod] ?? `Casilla ${cod}`,
      valores,
      variacion,
      porcentaje,
      resaltar: false,
      esTotal: CASILLAS_TOTAL.has(cod),
    };
  }

  // Casillas presentes en alguna DJ (más los totales).
  const presentes = new Set<string>();
  for (const d of decls) for (const cod of Object.keys(d.valores)) presentes.add(cod);
  for (const t of CASILLAS_TOTAL) presentes.add(t);

  const activo: FilaAnual[] = [];
  const pasivo: FilaAnual[] = [];
  const patrimonio: FilaAnual[] = [];
  const resultados: FilaAnual[] = [];
  for (const cod of Array.from(presentes).sort((a, b) => Number(a) - Number(b))) {
    const g = grupoBalance(cod);
    if (g === "activo") activo.push(construirFila(cod));
    else if (g === "pasivo") pasivo.push(construirFila(cod));
    else if (g === "patrimonio") patrimonio.push(construirFila(cod));
    else if (esResultados(cod)) resultados.push(construirFila(cod));
  }

  // Resaltar y observar las variaciones más grandes (excluyendo totales).
  const observaciones: string[] = [];
  if (previo) {
    const candidatas = [...activo, ...pasivo, ...patrimonio, ...resultados].filter(
      (f) => !f.esTotal && Math.abs(f.variacion) > 0
    );
    candidatas
      .sort((a, b) => Math.abs(b.variacion) - Math.abs(a.variacion))
      .slice(0, 5)
      .forEach((f) => {
        f.resaltar = true;
        const signo = f.variacion > 0 ? "▲ subió" : "▼ bajó";
        observaciones.push(
          `${f.etiqueta}: ${signo} ${fmt(Math.abs(f.variacion))} (${f.porcentaje > 0 ? "+" : ""}${f.porcentaje.toFixed(0)}%) entre ${previo} y ${ultimo}.`
        );
      });
  }

  // Cuadre del balance por ejercicio: TOTAL ACTIVO NETO − TOTAL PATRIMONIO Y PASIVO.
  const cuadre: CuadreAnual[] = decls.map((d) => {
    const activoNeto = d.valores["390"] ?? 0;
    const patrimonioYPasivo = d.valores["426"] ?? 0;
    const diferencia = Math.round((activoNeto - patrimonioYPasivo) * 100) / 100;
    return { ejercicio: d.ejercicio, activoNeto, patrimonioYPasivo, diferencia, cuadra: Math.abs(diferencia) < 1 };
  });

  const resultadosVacio = resultados.every((f) =>
    ejercicios.every((y) => (f.valores[y] ?? 0) === 0)
  );

  return { ejercicios, activo, pasivo, patrimonio, resultados, resultadosVacio, cuadre, observaciones };
}
