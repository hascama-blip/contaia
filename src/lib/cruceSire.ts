// ============================================================
//  Cruce SIRE vs Sistema contable (Contasis), comprobante por comprobante
// ============================================================
// El SIRE de SUNAT (RVIE ventas / RCE compras) y el libro del sistema contable
// (Contasis) describen los MISMOS comprobantes con encabezados distintos. Aquí
// se normaliza cada lado a una estructura común, se emparejan por una llave
// canónica (tipo + serie + número + RUC de la contraparte) y se comparan los
// montos (base gravada, IGV, no gravadas, total) y la fecha de emisión.
//
// El objetivo es detectar, ANTES de declarar, los comprobantes que faltan en un
// lado o que tienen montos distintos, para que la declaración mensual cuadre.
//
// Este módulo es PURO (no lee ni escribe archivos): recibe matrices de filas
// (la fila 0 son los encabezados) y devuelve el resultado. La lectura/escritura
// de Excel vive en `xlsxIO.ts`.

export type TipoLibro = "compras" | "ventas";

/** Tolerancia en soles para considerar dos montos iguales (redondeos). */
export const TOLERANCIA = 1;

/** Tolerancia para considerar dos tipos de cambio iguales. */
export const TOLERANCIA_TC = 0.001;

/** ¿La moneda es extranjera (dólares u otra distinta de soles)? */
export function esMonedaExtranjera(moneda: string): boolean {
  const m = (moneda || "").toUpperCase();
  return m !== "" && m !== "PEN" && m !== "SOL" && m !== "SOLES" && m !== "S/";
}

/** Comprobante ya normalizado, venga del SIRE o del sistema contable. */
export interface CompNorm {
  /** Llave canónica para emparejar: `tipo|serie|numero|ruc`. */
  clave: string;
  tipoDoc: string; // "1" factura, "7" nota de crédito, … (sin ceros a la izq.)
  serie: string;
  numero: string;
  rucContraparte: string;
  razonSocial: string;
  /** Fecha de emisión "YYYY-MM-DD" (o "" si no se pudo leer). */
  fecha: string;
  baseGravada: number;
  igv: number;
  /** No gravadas: exonerado + inafecto + exportación (ventas) / adq. no grav. (compras). */
  noGravado: number;
  total: number;
  /** Moneda del comprobante ("PEN", "USD", …). */
  moneda: string;
  /** Tipo de cambio aplicado (1 o 0 si es soles). */
  tipoCambio: number;
}

export type EstadoFila =
  | "ok"
  | "dif-monto"
  | "dif-fecha"
  | "solo-sire"
  | "solo-contable";

/** Una fila del cruce: el mismo comprobante en ambos lados (o solo en uno). */
export interface FilaCruce {
  clave: string;
  tipoDoc: string;
  serie: string;
  numero: string;
  rucContraparte: string;
  razonSocial: string;
  fechaSire: string;
  fechaContable: string;
  baseSire: number;
  baseContable: number;
  difBase: number;
  igvSire: number;
  igvContable: number;
  difIgv: number;
  noGravadoSire: number;
  noGravadoContable: number;
  difNoGravado: number;
  totalSire: number;
  totalContable: number;
  difTotal: number;
  /** Moneda y tipo de cambio de cada lado (para compras/ventas en dólares). */
  monedaSire: string;
  monedaContable: string;
  tcSire: number;
  tcContable: number;
  difTc: number;
  estado: EstadoFila;
  /** Descripción legible de cada diferencia encontrada. */
  observaciones: string[];
}

/** Totales de un lado (SIRE o contable) de un libro. */
export interface BloqueTotales {
  comprobantes: number;
  baseGravada: number;
  igv: number;
  noGravado: number;
  total: number;
}

/** Cruce de un libro completo (compras o ventas). */
export interface CruceLibro {
  libro: TipoLibro;
  filas: FilaCruce[];
  totalesSire: BloqueTotales;
  totalesContable: BloqueTotales;
  ok: number;
  difMonto: number;
  difFecha: number;
  soloSire: number;
  soloContable: number;
}

/** Resultado completo de un cruce (compras y/o ventas). */
export interface ResultadoCruce {
  periodo?: string;
  ruc?: string;
  razonSocial?: string;
  compras?: CruceLibro;
  ventas?: CruceLibro;
  generadoAt: string;
}

// ---- Utilidades de normalización -------------------------------------------

function pad2(n: number | string): string {
  return String(n).padStart(2, "0");
}

/** Convierte un valor de celda a número (tolera string con separadores). */
export function num(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
  if (v == null || v === "") return 0;
  let s = String(v).trim().replace(/\s/g, "");
  // Coma como decimal (sin punto) → punto; en otro caso, comas = miles.
  if (s.includes(",") && !s.includes(".")) s = s.replace(",", ".");
  else s = s.replace(/,/g, "");
  const n = parseFloat(s.replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function fechaISO(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** Serial de fecha de Excel (sistema 1900) → "YYYY-MM-DD". */
function serialAFecha(serial: number): string {
  if (!Number.isFinite(serial) || serial <= 0) return "";
  const ms = Math.round((serial - 25569) * 86400000); // 25569 = 1899-12-30 → 1970-01-01
  const d = new Date(ms);
  return isNaN(d.getTime()) ? "" : fechaISO(d);
}

/** Normaliza una fecha de celda (serial, Date o texto) a "YYYY-MM-DD". */
export function aFecha(v: unknown): string {
  if (v == null || v === "") return "";
  if (v instanceof Date) return fechaISO(v);
  if (typeof v === "number") return serialAFecha(v);
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (m) return `${m[3]}-${pad2(m[2])}-${pad2(m[1])}`;
  if (/^\d+(\.\d+)?$/.test(s)) return serialAFecha(parseFloat(s));
  return "";
}

function soloDigitos(v: unknown): string {
  return String(v ?? "").replace(/\D/g, "");
}

/** Quita ceros a la izquierda; si queda vacío, devuelve "0". */
function sinCerosIzq(s: string): string {
  const r = s.replace(/^0+/, "");
  return r === "" ? "0" : r;
}

function normTipo(v: unknown): string {
  return sinCerosIzq(soloDigitos(v));
}

/** Serie a mayúsculas, sin espacios ni ceros a la izquierda (00E001 → E001). */
function normSerie(v: unknown): string {
  const s = String(v ?? "").trim().toUpperCase().replace(/\s+/g, "");
  return s ? sinCerosIzq(s) : "";
}

/**
 * "No gravadas" de forma comparable entre sistemas: Total − Base gravada − IGV.
 * Cada software clasifica distinto los conceptos menores (exonerado, inafecto,
 * ISC, ICBPER, otros cargos), pero el Total siempre cuadra; definirlo así evita
 * falsos positivos y mantiene base + IGV + no gravadas = total.
 */
function noGravadasDe(total: number, base: number, igv: number): number {
  return Math.round((total - base - igv) * 100) / 100;
}

function normNumero(v: unknown): string {
  // El número de comprobante es entero; quitar ceros a la izquierda.
  const s = soloDigitos(v);
  return s ? sinCerosIzq(s) : "";
}

function claveDe(tipo: string, serie: string, numero: string, ruc: string): string {
  return `${tipo}|${serie}|${numero}|${ruc}`;
}

// ---- Localización de columnas por encabezado -------------------------------
// El SIRE trae encabezados descriptivos ("BI Gravado DG"); Contasis trae
// nombres técnicos con su tipo ("nbase1 N(15,2)"). Se normaliza cada estilo.

function normHeaderSire(h: unknown): string {
  return String(h ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** Primer token del encabezado Contasis ("nbase1 N(15,2)" → "nbase1"). */
function campoContasis(h: unknown): string {
  return String(h ?? "").trim().split(/\s+/)[0].toLowerCase();
}

function idxSire(headers: unknown[], pred: (h: string) => boolean): number {
  return headers.findIndex((h) => pred(normHeaderSire(h)));
}

function idxsSire(headers: unknown[], pred: (h: string) => boolean): number[] {
  return headers
    .map((h, i) => (pred(normHeaderSire(h)) ? i : -1))
    .filter((i) => i >= 0);
}

function idxContasis(headers: unknown[], nombre: string): number {
  return headers.findIndex((h) => campoContasis(h) === nombre);
}

function valor(row: unknown[], idx: number): unknown {
  return idx >= 0 && idx < row.length ? row[idx] : "";
}

function suma(row: unknown[], idxs: number[]): number {
  return idxs.reduce((acc, i) => acc + num(valor(row, i)), 0);
}

function filaVacia(serie: string, numero: string): boolean {
  return serie === "" && numero === "";
}

// ---- Parsers --------------------------------------------------------------

export interface ParseSalida {
  comprobantes: CompNorm[];
  periodo?: string;
  ruc?: string;
  razonSocial?: string;
}

/** SIRE COMPRAS (RCE). */
export function parseSireCompras(rows: unknown[][]): ParseSalida {
  if (rows.length < 2) return { comprobantes: [] };
  const h = rows[0];
  const cTipo = idxSire(h, (x) => x.startsWith("tipo cp/doc"));
  const cSerie = idxSire(h, (x) => x.includes("serie del cdp"));
  const cNum = idxSire(h, (x) => x.includes("nro cp") && x.includes("inicial"));
  const cRuc = idxSire(h, (x) => x.includes("nro doc identidad"));
  const cFecha = idxSire(h, (x) => x.startsWith("fecha de emisi"));
  const cBase = idxsSire(h, (x) => x.startsWith("bi gravado"));
  const cIgv = idxsSire(h, (x) => x.startsWith("igv / ipm") || x.startsWith("igv/ipm"));
  const cTotal = idxSire(h, (x) => x.startsWith("total cp") || x.includes("importe total"));
  const cMoneda = idxSire(h, (x) => x === "moneda");
  const cTc = idxSire(h, (x) => x.startsWith("tipo de cambio"));
  const cRazon = cRuc >= 0 ? cRuc + 1 : -1;
  const cPeriodo = idxSire(h, (x) => x === "periodo");

  const out: CompNorm[] = [];
  let periodo: string | undefined;
  let ruc: string | undefined;
  let razonSocial: string | undefined;

  for (const row of rows.slice(1)) {
    const tipoDoc = normTipo(valor(row, cTipo));
    const serie = normSerie(valor(row, cSerie));
    const numero = normNumero(valor(row, cNum));
    if (filaVacia(serie, numero)) continue;
    const rucC = soloDigitos(valor(row, cRuc));
    if (!periodo) periodo = soloDigitos(valor(row, cPeriodo)) || undefined;
    if (!ruc) ruc = soloDigitos(valor(row, 0)) || undefined;
    if (!razonSocial) razonSocial = String(valor(row, 1) ?? "").trim() || undefined;
    const baseGravada = suma(row, cBase);
    const igv = suma(row, cIgv);
    const total = num(valor(row, cTotal));
    out.push({
      clave: claveDe(tipoDoc, serie, numero, rucC),
      tipoDoc,
      serie,
      numero,
      rucContraparte: rucC,
      razonSocial: limpiarTexto(valor(row, cRazon)),
      fecha: aFecha(valor(row, cFecha)),
      baseGravada,
      igv,
      noGravado: noGravadasDe(total, baseGravada, igv),
      total,
      moneda: String(valor(row, cMoneda) ?? "").trim().toUpperCase(),
      tipoCambio: num(valor(row, cTc)),
    });
  }
  return { comprobantes: out, periodo, ruc, razonSocial };
}

/** SIRE VENTAS (RVIE). */
export function parseSireVentas(rows: unknown[][]): ParseSalida {
  if (rows.length < 2) return { comprobantes: [] };
  const h = rows[0];
  const cTipo = idxSire(h, (x) => x.startsWith("tipo cp/doc"));
  const cSerie = idxSire(h, (x) => x.includes("serie del cdp"));
  const cNum = idxSire(h, (x) => x.includes("nro cp") && x.includes("inicial"));
  const cRuc = idxSire(h, (x) => x.includes("nro doc identidad"));
  const cFecha = idxSire(h, (x) => x.startsWith("fecha de emisi"));
  const cBase = idxSire(h, (x) => x === "bi gravada");
  const cIgv = idxSire(h, (x) => x === "igv / ipm" || x === "igv/ipm");
  const cTotal = idxSire(h, (x) => x.startsWith("total cp") || x.includes("importe total"));
  const cMoneda = idxSire(h, (x) => x === "moneda");
  const cTc = idxSire(h, (x) => x.startsWith("tipo de cambio"));
  const cRazon = cRuc >= 0 ? cRuc + 1 : -1;
  const cPeriodo = idxSire(h, (x) => x === "periodo");

  const out: CompNorm[] = [];
  let periodo: string | undefined;
  let ruc: string | undefined;
  let razonSocial: string | undefined;

  for (const row of rows.slice(1)) {
    const tipoDoc = normTipo(valor(row, cTipo));
    const serie = normSerie(valor(row, cSerie));
    const numero = normNumero(valor(row, cNum));
    if (filaVacia(serie, numero)) continue;
    const rucC = soloDigitos(valor(row, cRuc));
    if (!periodo) periodo = soloDigitos(valor(row, cPeriodo)) || undefined;
    if (!ruc) ruc = soloDigitos(valor(row, 0)) || undefined;
    if (!razonSocial) razonSocial = String(valor(row, 1) ?? "").trim() || undefined;
    const baseGravada = num(valor(row, cBase));
    const igv = num(valor(row, cIgv));
    const total = num(valor(row, cTotal));
    out.push({
      clave: claveDe(tipoDoc, serie, numero, rucC),
      tipoDoc,
      serie,
      numero,
      rucContraparte: rucC,
      razonSocial: limpiarTexto(valor(row, cRazon)),
      fecha: aFecha(valor(row, cFecha)),
      baseGravada,
      igv,
      noGravado: noGravadasDe(total, baseGravada, igv),
      total,
      moneda: String(valor(row, cMoneda) ?? "").trim().toUpperCase(),
      tipoCambio: num(valor(row, cTc)),
    });
  }
  return { comprobantes: out, periodo, ruc, razonSocial };
}

/** Libro de COMPRAS de Contasis. */
export function parseContasisCompras(rows: unknown[][]): ParseSalida {
  return parseContasis(rows, "compras");
}

/** Libro de VENTAS de Contasis. */
export function parseContasisVentas(rows: unknown[][]): ParseSalida {
  return parseContasis(rows, "ventas");
}

function parseContasis(rows: unknown[][], _libro: TipoLibro): ParseSalida {
  if (rows.length < 2) return { comprobantes: [] };
  const h = rows[0];
  const cTipo = idxContasis(h, "ccoddoc");
  const cSerie = idxContasis(h, "cserie");
  const cNum = idxContasis(h, "cnumero");
  const cRuc = idxContasis(h, "ccodruc");
  const cRazon = idxContasis(h, "crazsoc");
  const cFecha = idxContasis(h, "ffechadoc");
  // Montos: nbase1/2/3 (base gravada), nigv1/2/3 (IGV — NO "nigv" que es la tasa
  // %), nexo + nina (no gravadas), ntots (total).
  const cBase = ["nbase1", "nbase2", "nbase3"]
    .map((n) => idxContasis(h, n))
    .filter((i) => i >= 0);
  const cIgv = ["nigv1", "nigv2", "nigv3"]
    .map((n) => idxContasis(h, n))
    .filter((i) => i >= 0);
  const cTotal = idxContasis(h, "ntots");
  // Tipo de cambio (ntc) e importe en dólares (ndolar): Contasis no trae una
  // columna "moneda", así que se infiere USD cuando hay importe en dólares o el
  // TC no es 1.
  const cTc = idxContasis(h, "ntc");
  const cDolar = idxContasis(h, "ndolar");

  const out: CompNorm[] = [];
  for (const row of rows.slice(1)) {
    const tipoDoc = normTipo(valor(row, cTipo));
    const serie = normSerie(valor(row, cSerie));
    const numero = normNumero(valor(row, cNum));
    if (filaVacia(serie, numero)) continue;
    const rucC = soloDigitos(valor(row, cRuc));
    const baseGravada = suma(row, cBase);
    const igv = suma(row, cIgv);
    const total = num(valor(row, cTotal));
    const tc = num(valor(row, cTc));
    const dolar = num(valor(row, cDolar));
    const moneda = dolar > 0 || tc > 1.01 ? "USD" : "PEN";
    out.push({
      clave: claveDe(tipoDoc, serie, numero, rucC),
      tipoDoc,
      serie,
      numero,
      rucContraparte: rucC,
      razonSocial: limpiarTexto(valor(row, cRazon)),
      fecha: aFecha(valor(row, cFecha)),
      baseGravada,
      igv,
      noGravado: noGravadasDe(total, baseGravada, igv),
      total,
      moneda,
      tipoCambio: tc,
    });
  }
  return { comprobantes: out };
}

/** Limpia espacios no-rompibles y normaliza separadores en texto. */
function limpiarTexto(v: unknown): string {
  return String(v ?? "")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ---- Cruce -----------------------------------------------------------------

/** Agrupa por clave sumando montos (un comprobante puede venir en varias filas). */
function agrupar(comps: CompNorm[]): Map<string, CompNorm> {
  const m = new Map<string, CompNorm>();
  for (const c of comps) {
    const prev = m.get(c.clave);
    if (!prev) {
      m.set(c.clave, { ...c });
    } else {
      prev.baseGravada = Math.round((prev.baseGravada + c.baseGravada) * 100) / 100;
      prev.igv = Math.round((prev.igv + c.igv) * 100) / 100;
      prev.noGravado = Math.round((prev.noGravado + c.noGravado) * 100) / 100;
      prev.total = Math.round((prev.total + c.total) * 100) / 100;
      if (!prev.fecha) prev.fecha = c.fecha;
      if (!prev.razonSocial) prev.razonSocial = c.razonSocial;
      if (!prev.moneda || prev.moneda === "PEN") prev.moneda = c.moneda || prev.moneda;
      if (!prev.tipoCambio) prev.tipoCambio = c.tipoCambio;
    }
  }
  return m;
}

function totales(comps: Iterable<CompNorm>): BloqueTotales {
  const t: BloqueTotales = { comprobantes: 0, baseGravada: 0, igv: 0, noGravado: 0, total: 0 };
  for (const c of comps) {
    t.comprobantes += 1;
    t.baseGravada += c.baseGravada;
    t.igv += c.igv;
    t.noGravado += c.noGravado;
    t.total += c.total;
  }
  const r = (n: number) => Math.round(n * 100) / 100;
  return {
    comprobantes: t.comprobantes,
    baseGravada: r(t.baseGravada),
    igv: r(t.igv),
    noGravado: r(t.noGravado),
    total: r(t.total),
  };
}

const PRIORIDAD: Record<EstadoFila, number> = {
  "solo-sire": 0,
  "solo-contable": 1,
  "dif-monto": 2,
  "dif-fecha": 3,
  ok: 4,
};

/** Cruza un libro: empareja SIRE vs contable y arma las filas con su estado. */
export function cruzarLibro(
  libro: TipoLibro,
  sire: CompNorm[],
  contable: CompNorm[]
): CruceLibro {
  const mSire = agrupar(sire);
  const mCont = agrupar(contable);
  const claves = new Set<string>([...mSire.keys(), ...mCont.keys()]);

  const filas: FilaCruce[] = [];
  let ok = 0,
    difMonto = 0,
    difFecha = 0,
    soloSire = 0,
    soloContable = 0;

  const r = (n: number) => Math.round(n * 100) / 100;

  for (const clave of claves) {
    const s = mSire.get(clave);
    const c = mCont.get(clave);
    const ref = (s ?? c)!; // existe al menos uno
    const obs: string[] = [];

    const baseS = s?.baseGravada ?? 0;
    const baseC = c?.baseGravada ?? 0;
    const igvS = s?.igv ?? 0;
    const igvC = c?.igv ?? 0;
    const ngS = s?.noGravado ?? 0;
    const ngC = c?.noGravado ?? 0;
    const totS = s?.total ?? 0;
    const totC = c?.total ?? 0;

    let estado: EstadoFila;
    if (s && !c) {
      estado = "solo-sire";
      soloSire++;
      obs.push("Está en el SIRE pero NO en el sistema contable.");
    } else if (!s && c) {
      estado = "solo-contable";
      soloContable++;
      obs.push("Está en el sistema contable pero NO en el SIRE.");
    } else {
      // Emparejado: comparar montos y fecha.
      const difs: [string, number, number][] = [
        ["Base gravada", baseS, baseC],
        ["IGV", igvS, igvC],
        ["No gravadas", ngS, ngC],
        ["Total", totS, totC],
      ];
      let hayDifMonto = false;
      for (const [etq, vs, vc] of difs) {
        if (Math.abs(vs - vc) > TOLERANCIA) {
          hayDifMonto = true;
          obs.push(`${etq}: SIRE ${vs.toFixed(2)} vs contable ${vc.toFixed(2)} (dif ${r(vs - vc).toFixed(2)})`);
        }
      }
      const difF = s!.fecha && c!.fecha && s!.fecha !== c!.fecha;
      if (difF) obs.push(`Fecha: SIRE ${s!.fecha} vs contable ${c!.fecha}`);

      // Tipo de cambio (solo si el comprobante es en moneda extranjera).
      const enDolares = esMonedaExtranjera(s!.moneda) || esMonedaExtranjera(c!.moneda);
      if (enDolares && s!.tipoCambio > 0 && c!.tipoCambio > 0 &&
          Math.abs(s!.tipoCambio - c!.tipoCambio) > TOLERANCIA_TC) {
        obs.push(`Tipo de cambio: SIRE ${s!.tipoCambio} vs contable ${c!.tipoCambio}`);
      }

      if (hayDifMonto) {
        estado = "dif-monto";
        difMonto++;
      } else if (difF) {
        estado = "dif-fecha";
        difFecha++;
      } else {
        estado = "ok";
        ok++;
      }
    }

    filas.push({
      clave,
      tipoDoc: ref.tipoDoc,
      serie: ref.serie,
      numero: ref.numero,
      rucContraparte: ref.rucContraparte,
      razonSocial: s?.razonSocial || c?.razonSocial || "",
      fechaSire: s?.fecha ?? "",
      fechaContable: c?.fecha ?? "",
      baseSire: baseS,
      baseContable: baseC,
      difBase: r(baseS - baseC),
      igvSire: igvS,
      igvContable: igvC,
      difIgv: r(igvS - igvC),
      noGravadoSire: ngS,
      noGravadoContable: ngC,
      difNoGravado: r(ngS - ngC),
      totalSire: totS,
      totalContable: totC,
      difTotal: r(totS - totC),
      monedaSire: s?.moneda ?? "",
      monedaContable: c?.moneda ?? "",
      tcSire: s?.tipoCambio ?? 0,
      tcContable: c?.tipoCambio ?? 0,
      difTc: r((s?.tipoCambio ?? 0) - (c?.tipoCambio ?? 0)),
      estado,
      observaciones: obs,
    });
  }

  // Problemáticas primero; dentro, por serie y número.
  filas.sort((a, b) => {
    const p = PRIORIDAD[a.estado] - PRIORIDAD[b.estado];
    if (p !== 0) return p;
    if (a.serie !== b.serie) return a.serie.localeCompare(b.serie);
    return (Number(a.numero) || 0) - (Number(b.numero) || 0);
  });

  return {
    libro,
    filas,
    totalesSire: totales(mSire.values()),
    totalesContable: totales(mCont.values()),
    ok,
    difMonto,
    difFecha,
    soloSire,
    soloContable,
  };
}

/** ¿El libro tiene alguna diferencia (lo que se debe revisar antes de declarar)? */
export function libroTieneDiferencias(l: CruceLibro): boolean {
  return l.difMonto + l.difFecha + l.soloSire + l.soloContable > 0;
}
