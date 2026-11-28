// ============================================================
//  Conciliación bancaria de 3 vías: Contabilidad ↔ Caja virtual ↔ Bancos
// ============================================================
// Tres documentos (Excel):
//   1) CONTABILIDAD  = Registro de Ventas (StarSoft): un comprobante por fila. También vale el
//      Libro Diario (un asiento por venta: 12… / 40… / 70…), solo o junto con el Registro; el
//      Diario no trae el nombre del cliente, así que el Registro afina las transferencias.
//   2) CAJA VIRTUAL  = tramas de cobranza: cada voucher (subdiario + comprobante) trae UNA
//      línea de dinero (cuenta 10…: efectivo del día por sede, o una transferencia con su
//      N° de operación) y debajo los comprobantes que cancela (cuenta 12…).
//   3) BANCOS        = extracto de cada cuenta (una hoja o un archivo por cuenta; cada banco
//      con su formato: columnas Cargo/Abono o un Importe con signo).
//
// Vínculo ÚNICO (descubierto con el archivo real de RTV San Cristóbal, oct-2026):
//   comprobante ──(serie + número)──▶ cobro de la caja virtual ──▶ movimiento del banco
// El 2.º salto depende del medio:
//   · Transferencia: N° de operación si el banco lo trae; si no, fecha + monto y, cuando hay
//     varias iguales el mismo día, el nombre del cliente dentro del concepto del banco.
//   · Efectivo: el total del día por sede se busca como depósito por monto exacto en los días
//     siguientes (o como suma de dos depósitos).
// Todo lo que no se logra vincular queda como "No conciliado" (sin reglas de plazo).

import ExcelJS from "exceljs";

// ---------------------------------------------------------------- tipos
export interface Venta {
  td: string; clave: string; doc: string; fecha: string; ruc: string; nombre: string; total: number; ref: string;
  /** Solo cuando viene del Libro Diario: glosa del asiento (servicio, placa) y N° de asiento. */
  glosa?: string; asiento?: string;
}
export interface DocCobro { clave: string; doc: string; td: string; importe: number }
export interface Cobro {
  id: string; fecha: string; tipo: "efectivo" | "transferencia" | "nc";
  medio: string; sede: string; op: string; importe: number; glosa: string; docs: DocCobro[];
  /** NC que se aplica (solo tipo "nc"). */
  ncClave?: string;
  /** "reporte" = viene de los ZIP de la caja virtual (reporte de caja diario + vouchers del Drive). */
  origen?: "reporte";
  /** Voucher del depósito del efectivo de ese día (leído del PDF que la sede subió al Drive). */
  voucher?: { operacion: string; fecha: string; monto: number | null; banco: string; diferencia: number; obs: string };
  /** Aclaración que acompaña al cobro cuando no concilia (p. ej. "sin voucher en el Drive"). */
  nota?: string;
}
export interface MovBanco {
  id: number; banco: string; fecha: string; desc: string; op: string; abono: number; cargo: number;
  /** "USD" = cuenta en dólares: se lista pero no se cruza con la cobranza (que está en soles). */
  moneda?: "USD";
  /** Banco de la cuenta cuando se reconoce por el formato del extracto ("BBVA", "BCP"…). */
  entidad?: string;
}

export type Estado = "Conciliado" | "No conciliado";
export interface FilaComprobante {
  fecha: string; td: string; doc: string; cliente: string; ruc: string; total: number;
  cobro: string; cobroFecha: string; medio: string; sede: string; op: string; cobrado: number;
  banco: string; bancoFecha: string; bancoDesc: string; bancoImporte: number; dias: number | null;
  estado: Estado; motivo: string; criterio: string;
}
export interface FilaCobro {
  cobro: string; fecha: string; medio: string; sede: string; op: string; importe: number; comprobantes: number;
  banco: string; bancoFecha: string; bancoDesc: string; bancoOp: string; bancoImporte: number; dias: number | null;
  estado: Estado | "No aplica"; criterio: string;
}
export interface FilaBanco {
  banco: string; fecha: string; desc: string; op: string; abono: number; cargo: number; estado: Estado | "Cargo"; cobro: string; detalle: string;
  /** Texto de conciliación del movimiento, como lo escribe contabilidad en el extracto: la glosa del
   *  cobro de la caja ("CANCELA BV B0010007472 - TRANS.BBVA RTV ICA", "DEP. X VTAS 01/10/2026 EFECTIVO
   *  RTV ICA"); en los cargos, una sugerencia solo si es evidente (ITF, comisión, haberes). */
  conciliacion: string;
  obs: string;
}
export interface ResumenConciliacion {
  empresa: string; ruc: string; periodo: string;
  ventas: { total: number; importe: number; conciliados: number; importeConciliado: number; noConciliados: number; importeNoConciliado: number; porMotivo: Record<string, { n: number; importe: number }> };
  cobros: { total: number; importe: number; conciliados: number; importeConciliado: number; noConciliados: number; importeNoConciliado: number; porCriterio: Record<string, number> };
  bancos: { banco: string; abonos: number; importeAbonos: number; conciliados: number; importeConciliado: number; noConciliados: number; importeNoConciliado: number; cargos: number; importeCargos: number }[];
}
/** Un día del periodo: lo vendido (contabilidad), lo cobrado (caja virtual) y lo que llegó al banco. */
export interface FilaFecha {
  fecha: string;
  ventas: number; notasCredito: number; comprobantes: number;
  cajaEfectivo: number; cajaTransferencias: number; cajaTotal: number;
  /** Ventas netas del día − cobrado en caja el mismo día. */
  difVentasCaja: number;
  /** De lo cobrado ese día, cuánto ya está en el banco y cuánto no. */
  depositado: number; sinDepositar: number;
  /** Fechas en que el banco recibió lo de ese día (primera y última). */
  depositoDesde: string; depositoHasta: string;
  /** Lo que el banco recibió ESE día (de cualquier fecha de venta). */
  abonosBanco: number;
  estado: Estado; nota: string;
}
/** Una fila de la HOJA ÚNICA: el mismo movimiento visto en contabilidad, en la caja virtual y en el banco,
 *  con el punto en común que une cada salto (comprobante · monto / fecha / N° de operación). */
export interface FilaUnica {
  // Contabilidad (Registro de Ventas)
  cFecha: string; cDoc: string; cTipo: string; cCliente: string; cTotal: number | null;
  // Caja virtual (cobranza)
  vDoc: string; vCobro: string; vFecha: string; vMedio: string; vImporte: number | null; vTotalCobro: number | null; vOp: string;
  // Bancos (extracto). bImporte negativo = cargo.
  bBanco: string; bFecha: string; bDesc: string; bOp: string; bImporte: number | null;
  estado: Estado | "Cargo";
  /** Punto en común contabilidad ↔ caja (el comprobante). */
  punto1: string;
  /** Punto en común caja ↔ banco (monto y fecha, N° de operación, nombre…). */
  punto2: string;
  obs: string;
}
export interface ResultadoConciliacion { resumen: ResumenConciliacion; unificada: FilaUnica[]; comprobantes: FilaComprobante[]; cobros: FilaCobro[]; bancos: FilaBanco[]; porFecha: FilaFecha[]; avisos: string[] }

// ---------------------------------------------------------------- utilidades
const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const txt = (v: unknown) => (v == null ? "" : v instanceof Date ? isoDe(v) : String(v)).trim();
const num = (v: unknown) => {
  if (typeof v === "number") return v;
  // "1,234.50-" y "(1,234.50)" son negativos (así los imprimen algunos bancos).
  let t = String(v ?? "").replace(/[^\d.,()-]/g, ""); const neg = /-$|^\(.*\)$/.test(t); t = t.replace(/[()]/g, "").replace(/-$/, "");
  const n = Number(t.replace(/,(?=\d{3}\b)/g, "").replace(",", ".")); return Number.isFinite(n) ? (neg ? -Math.abs(n) : n) : 0;
};
function isoDe(d: Date) { return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`; }
/** Fecha de una celda → "AAAA-MM-DD" ("" si no es fecha). */
function aIso(v: unknown): string {
  if (v instanceof Date) return isoDe(v);
  if (typeof v === "number" && v > 20000 && v < 80000) return isoDe(new Date(Math.round((v - 25569) * 86400000)));
  const s = String(v ?? "").trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(s);
  if (m) return `${m[3].length === 2 ? "20" + m[3] : m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return "";
}
const dias = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const sinAcentos = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
const H = (v: unknown) => sinAcentos(txt(v)).toLowerCase().replace(/\s+/g, " ").trim();
/** Llave de un comprobante: SERIE-NÚMERO sin ceros ("F002 0001238", "F0020001238", "01-F002-0001238" → "F002-1238"). */
export function claveDoc(v: unknown): string {
  let s = txt(v).toUpperCase().replace(/^\d{2}\s*-\s*/, "").replace(/[\s-]+/g, "");
  const m = /^([A-Z][A-Z0-9]{3})(\d+)$/.exec(s);
  if (!m) return s;
  return `${m[1]}-${Number(m[2])}`;
}
export const docVisible = (clave: string) => { const [s, n] = clave.split("-"); return n ? `${s}-${n.padStart(7, "0")}` : clave; };
const tokens = (s: string) => sinAcentos(s).toUpperCase().replace(/[^A-Z ]/g, " ").split(/\s+/).filter((w) => w.length > 2);
const soloDigitos = (s: string) => s.replace(/\D/g, "").replace(/^0+/, "");

// ---------------------------------------------------------------- lectura
export interface Hoja { archivo: string; hoja: string; rows: unknown[][] }
export async function leerHojas(buf: Buffer, archivo: string): Promise<Hoja[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const out: Hoja[] = [];
  for (const ws of wb.worksheets) {
    const rows: unknown[][] = [];
    const maxCol = Math.min(ws.columnCount, 60);
    ws.eachRow({ includeEmpty: true }, (row) => {
      const arr: unknown[] = [];
      for (let c = 1; c <= maxCol; c++) {
        const v = row.getCell(c).value as unknown;
        if (v == null) arr.push("");
        else if (v instanceof Date) arr.push(v);
        else if (typeof v === "object") {
          const o = v as Record<string, unknown>;
          arr.push("result" in o ? (o.result ?? "") : "text" in o ? o.text : Array.isArray(o.richText) ? (o.richText as { text: string }[]).map((x) => x.text).join("") : "");
        } else arr.push(v);
      }
      rows.push(arr);
    });
    if (rows.length) out.push({ archivo, hoja: ws.name, rows });
  }
  return out;
}

export type TipoHoja = "ventas" | "diario" | "caja" | "banco" | "desconocida";
/** Reconoce qué es cada hoja por sus encabezados (no importa en qué casilla se subió). */
export function tipoDeHoja(h: Hoja): { tipo: TipoHoja; fila: number } {
  for (let i = 0; i < Math.min(h.rows.length, 40); i++) { // el estado de cuenta del BBVA trae ~20 filas de cabecera
    const c = h.rows[i].map(H);
    if (c.includes("cta contable") && c.includes("debe/haber")) return { tipo: "caja", fila: i };
    // Libro Diario (StarSoft): cabecera de líneas "Sec. | Cuenta | Fec.Reg. | … | Documento | … | Debe | Haber".
    if (c.includes("sec.") && c.includes("cuenta") && c.includes("debe") && c.includes("haber")) return { tipo: "diario", fila: i };
    if (c.includes("documento") && c.some((x) => x === "total") && c.some((x) => x.includes("t/d") || x === "afecto")) return { tipo: "ventas", fila: i };
    const fecha = c.some((x) => /^f\.? ?operaci|^fecha/.test(x));
    const montos = (c.some((x) => /cargo|debito|egreso|retiro/.test(x)) && c.some((x) => /abono|credito|ingreso|deposito/.test(x))) || c.some((x) => /^importe|^monto/.test(x));
    if (fecha && montos) return { tipo: "banco", fila: i };
  }
  return { tipo: "desconocida", fila: -1 };
}

export function parseVentas(h: Hoja, fila: number): { empresa: string; ruc: string; ventas: Venta[] } {
  const c = h.rows[fila].map(H);
  const col = (f: (x: string) => boolean) => c.findIndex(f);
  const iF = col((x) => x === "fecha"), iT = col((x) => x.includes("t/d")), iD = col((x) => x === "documento"), iR = col((x) => x.replace(/\./g, "") === "ruc");
  const iN = col((x) => x.startsWith("nombre") || x.includes("razon social")), iTot = col((x) => x === "total"), iRef = col((x) => x === "referencia");
  const ventas: Venta[] = [];
  for (const row of h.rows.slice(fila + 1)) {
    const fecha = aIso(row[iF]); const doc = txt(row[iD]);
    if (!fecha || !doc) continue;
    const clave = claveDoc(doc);
    if (!/^[A-Z][A-Z0-9]{3}-\d+$/.test(clave)) continue;
    ventas.push({ td: txt(row[iT]).padStart(2, "0"), clave, doc: docVisible(clave), fecha, ruc: txt(row[iR]), nombre: txt(row[iN]), total: Math.abs(r2(num(row[iTot]))), ref: iRef >= 0 ? claveDoc(row[iRef]) : "" });
  }
  const empresa = txt(h.rows[0]?.[0]); const ruc = (h.rows.slice(0, 4).flat().map(txt).find((x) => /^\d{11}$/.test(x))) ?? "";
  return { empresa, ruc, ventas };
}

/** Tipo de documento según el prefijo que el Libro Diario le pone al comprobante ("BVB0010007472"). */
const TD_DIARIO: Record<string, string> = { BV: "03", BO: "03", FT: "01", FA: "01", FC: "01", CC: "07", NC: "07", NA: "07", ND: "08", DB: "08" };
/**
 * Libro Diario (StarSoft) como fuente de CONTABILIDAD: cada venta es un asiento con el comprobante en la
 * cuenta 12… (Debe = total; nota de crédito = Haber), el IGV en la 40… y el ingreso en la 70…
 *   cabecera del asiento:  Sub. | Comp. | Fecha | Moneda | T/C | Glosa
 *   líneas:                Sec. | Cuenta | Fec.Reg. | Glosa | Anexo | Documento | Fec.Doc. | Cen.Cos. | Debe | Haber
 * Solo se toman los asientos de VENTAS (tienen 12…/13… y además 70… o 40…): los de cobranza u otros
 * subdiarios que traiga el archivo se cuentan aparte (`otros`). La fecha sale de Fec.Doc. (la de la
 * cabecera llega con día y mes cruzados en algunas exportaciones). El Diario NO trae el nombre del cliente.
 */
export function parseDiario(h: Hoja, fila: number): { empresa: string; ventas: Venta[]; otros: number } {
  const c = h.rows[fila].map(H);
  const ix = (n: string) => c.indexOf(n);
  const iS = ix("sec."), iC = ix("cuenta"), iFR = ix("fec.reg."), iG = ix("glosa"), iA = ix("anexo"), iD = ix("documento"), iFD = ix("fec.doc."), iDe = ix("debe"), iHa = ix("haber");
  interface Linea { cta: string; glosa: string; anexo: string; doc: string; fecha: string; debe: number; haber: number }
  const asientos: { id: string; lineas: Linea[] }[] = [];
  let cur: { id: string; lineas: Linea[] } | null = null;
  for (const row of h.rows.slice(fila + 1)) {
    const sec = txt(row[iS]), cta = txt(row[iC]);
    if (/^\d{4,6}$/.test(sec) && /^\d{2,}$/.test(cta)) {
      if (!cur) { cur = { id: "", lineas: [] }; asientos.push(cur); }
      cur.lineas.push({ cta, glosa: iG >= 0 ? txt(row[iG]).replace(/\s+/g, " ") : "", anexo: iA >= 0 ? txt(row[iA]) : "", doc: iD >= 0 ? txt(row[iD]) : "", fecha: (iFD >= 0 ? aIso(row[iFD]) : "") || (iFR >= 0 ? aIso(row[iFR]) : ""), debe: num(row[iDe]), haber: num(row[iHa]) });
    } else if (/^\d{1,3}$/.test(sec) && /^\d+$/.test(cta) && iG >= 0 && /^(MN|ME)$/i.test(txt(row[iG]))) {
      // Cabecera de asiento: subdiario y comprobante en las mismas columnas que Sec. y Cuenta.
      cur = { id: `${sec.padStart(2, "0")}-${cta.padStart(4, "0")}`, lineas: [] }; asientos.push(cur);
    }
  }
  const ventas = new Map<string, Venta>(); let otros = 0;
  for (const a of asientos) {
    if (!a.lineas.length) continue;
    const cli = a.lineas.filter((l) => /^1[23]/.test(l.cta) && l.doc);
    if (!cli.length || !a.lineas.some((l) => /^7/.test(l.cta) || /^40/.test(l.cta))) { otros++; continue; }
    for (const l of cli) {
      const d = l.doc.toUpperCase().replace(/[\s-]+/g, "");
      const m = /^([A-Z]{2})([A-Z][A-Z0-9]{3}\d+)$/.exec(d);
      const clave = claveDoc(m ? m[2] : d);
      if (!/^[A-Z][A-Z0-9]{3}-\d+$/.test(clave)) continue;
      const neto = l.debe - l.haber;
      const td = (m && TD_DIARIO[m[1]]) || (neto < 0 ? "07" : clave.startsWith("B") ? "03" : "01");
      const k = td + clave, ya = ventas.get(k);
      if (ya) { ya.total = r2(ya.total + Math.abs(neto)); continue; }
      // Anexo = tipo de anexo (2 dígitos) + DNI/RUC del cliente.
      const ruc = /^(10|15|17|20)\d{9}$/.test(l.anexo) ? l.anexo : /^\d{2}\d{8,11}$/.test(l.anexo) ? l.anexo.slice(2) : l.anexo;
      ventas.set(k, { td, clave, doc: docVisible(clave), fecha: l.fecha, ruc, nombre: "", total: r2(Math.abs(neto)), ref: "", glosa: l.glosa, asiento: a.id });
    }
  }
  const empresa = (h.rows[0] ?? []).map(txt).find(Boolean) ?? "";
  return { empresa, ventas: Array.from(ventas.values()), otros };
}

export function parseCaja(h: Hoja, fila: number): Cobro[] {
  const c = h.rows[fila].map(H);
  const ix = (n: string) => c.indexOf(n);
  const iC = ix("cta contable"), iS = ix("subdiario"), iV = ix("comprobante"), iF = ix("fecha documento"), iTD = ix("tipo documento"), iN = ix("nro documento"), iI = ix("importe"), iG = ix("glosa"), iDH = ix("debe/haber"), iMP = ix("medio de pago");
  const grupos = new Map<string, unknown[][]>();
  for (const row of h.rows.slice(fila + 1)) {
    if (!txt(row[iC])) continue;
    const k = `${txt(row[iS])}-${txt(row[iV])}`;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k)!.push(row);
  }
  const cobros: Cobro[] = [];
  for (const [id, lineas] of Array.from(grupos.entries())) {
    const dinero = lineas.filter((l) => /^10/.test(txt(l[iC])));
    const ncLin = lineas.find((l) => /^12/.test(txt(l[iC])) && txt(l[iDH]).toUpperCase() === "D");
    const docs: DocCobro[] = lineas.filter((l) => /^12/.test(txt(l[iC])) && txt(l[iDH]).toUpperCase() === "H")
      .map((l) => ({ clave: claveDoc(l[iN]), doc: docVisible(claveDoc(l[iN])), td: txt(l[iTD]), importe: r2(num(l[iI])) }));
    const cab = dinero[0] ?? ncLin ?? lineas[0];
    const glosa = txt(cab[iG]);
    const g = sinAcentos(glosa).toUpperCase();
    const m = /(EFECTIVO|TRANS\.? ?[A-Z]+|PAGO YAPE|YAPE|PLIN|TARJETA|POS\b|DEPOSITO)/.exec(g);
    let tipo: Cobro["tipo"];
    if (!dinero.length && ncLin) tipo = "nc";
    else if (m) tipo = m[1] === "EFECTIVO" ? "efectivo" : "transferencia";
    else tipo = txt(cab[iMP]) === "001" || docs.length > 1 ? "efectivo" : "transferencia";
    cobros.push({
      id, fecha: aIso(cab[iF]), tipo,
      medio: tipo === "nc" ? "Nota de crédito" : m ? m[1].replace(/\s+/g, " ") : tipo === "efectivo" ? "EFECTIVO" : "TRANSFERENCIA",
      sede: m ? glosa.slice(g.indexOf(m[1]) + m[1].length).trim() : "",
      op: tipo === "efectivo" || tipo === "nc" ? "" : txt(cab[iN]),
      importe: r2(dinero.length ? dinero.reduce((a, l) => a + num(l[iI]), 0) : docs.reduce((a, d) => a + d.importe, 0)),
      glosa, docs, ncClave: tipo === "nc" && ncLin ? claveDoc(ncLin[iN]) : undefined,
    });
  }
  return cobros;
}

/** Banco nombrado en un texto (nombre de la cuenta, cabecera del extracto o medio de pago de la caja). */
export function entidadDeTexto(t: string): string {
  const u = sinAcentos(t).toUpperCase();
  return /\bBBVA\b|CONTINENTAL/.test(u) ? "BBVA" : /\bBCP\b|BANCO DE CREDITO/.test(u) ? "BCP" : /INTERBANK|\bIBK\b/.test(u) ? "INTERBANK" : /SCOTIA/.test(u) ? "SCOTIABANK" : /BANBIF/.test(u) ? "BANBIF" : /PICHINCHA/.test(u) ? "PICHINCHA" : /BANCO DE LA NACION|\bBN\b/.test(u) ? "NACION" : "";
}
export function parseBanco(h: Hoja, fila: number, nombre: string, idBase: number): MovBanco[] {
  const c = h.rows[fila].map(H);
  const col = (f: (x: string, i: number) => boolean) => c.findIndex(f);
  const iF = col((x) => /^f\.? ?operaci|^fecha/.test(x));
  const iD = col((x) => /concepto|referencia|descrip|glosa|detalle/.test(x));
  const iOp = col((x, i) => i !== iF && i !== iD && /n[º°o]?\.? ?doc|operacion|n[º°] ?oper|^num\.? ?op|nro|numero/.test(x));
  const iCar = col((x) => /cargo|debito|egreso|retiro/.test(x)), iAbo = col((x) => /abono|credito|ingreso|deposito/.test(x));
  const iImp = col((x) => /^importe|^monto/.test(x));
  // Oficina / canal donde se hizo la operación (BBVA: "OFICINA ANDAH", "BCA. INTERNET"): va junto a la
  // descripción, porque dice en qué sede se depositó el efectivo.
  const iOf = col((x) => /^oficina|^agencia|^sucursal/.test(x));
  // Moneda de la cuenta, de la cabecera del extracto ("MONEDA: DOLARES US").
  const cab = h.rows.slice(0, fila).map((r) => r.map(txt).join(" ")).join(" ").toUpperCase();
  const usd = /MONEDA\s*:?\s*(D[OÓ]LAR|USD|US\$)/.test(cab);
  if (usd && !/USD|D[OÓ]LAR|\$/i.test(nombre)) nombre = `${nombre} (US$)`;
  // Estado de cuenta del BBVA ("Consulta de Estado de Cuenta"): FECHA OPER. · FECHA VALOR · DESCRIPCIÓN ·
  // OFICINA · CAN · N° OPER. · CARGO/ABONO · ITF · SALDO CONTABLE. Su "N° OPER." es el correlativo de la
  // cuenta, no el número del voucher ni el del Yape.
  const entidad = c.includes("can") && c.includes("fecha valor") && c.some((x) => /^n[º°] ?oper/.test(x)) ? "BBVA" : entidadDeTexto(`${nombre} ${cab}`);
  const movs: MovBanco[] = [];
  for (const row of h.rows.slice(fila + 1)) {
    // Extractos sin año ("02-10"): queda "0000-MM-DD" y el año se pone después con el periodo.
    const sinAnio = /^(\d{1,2})[/.-](\d{1,2})$/.exec(txt(row[iF]));
    const fecha = aIso(row[iF]) || (sinAnio && Number(sinAnio[2]) <= 12 && Number(sinAnio[1]) <= 31 ? `0000-${sinAnio[2].padStart(2, "0")}-${sinAnio[1].padStart(2, "0")}` : "");
    if (!fecha) continue;
    let abono = 0, cargo = 0;
    if (iCar >= 0 && iCar === iAbo) { const v = num(row[iCar]); if (v >= 0) abono = v; else cargo = -v; } // una sola columna "Cargo / Abono" con signo
    else if (iCar >= 0 && iAbo >= 0) { cargo = Math.abs(num(row[iCar])); abono = Math.abs(num(row[iAbo])); }
    else if (iImp >= 0) {
      // Un solo Importe con signo; algunos bancos ponen el cargo (negativo) en la columna vecina sin título.
      let v = num(row[iImp]);
      if (!v && !c[iImp + 1]) v = num(row[iImp + 1]);
      if (v >= 0) abono = v; else cargo = -v;
    }
    if (!abono && !cargo) continue;
    const oficina = iOf >= 0 ? txt(row[iOf]) : "";
    movs.push({ id: idBase + movs.length, banco: nombre, fecha, desc: [iD >= 0 ? txt(row[iD]) : "", oficina].filter(Boolean).join(" · "), op: iOp >= 0 ? txt(row[iOp]) : "", abono: r2(abono), cargo: r2(cargo), ...(usd ? { moneda: "USD" as const } : {}), ...(entidad ? { entidad } : {}) });
  }
  return movs;
}

// ---------------------------------------------------------------- conciliación
interface Enlace { movs: MovBanco[]; criterio: string }

export function conciliarTresVias(ventas: Venta[], cobros: Cobro[], movs: MovBanco[], meta: { empresa: string; ruc: string; notasSinCobro?: Record<string, string> }, avisos: string[] = []): ResultadoConciliacion {
  const ventaDe = new Map(ventas.map((v) => [v.clave, v]));
  const libres = new Map(movs.filter((m) => m.abono > 0 && !m.moneda).map((m) => [m.id, m]));
  const enlace = new Map<string, Enlace>();
  const tomar = (c: Cobro, ms: MovBanco[], criterio: string) => { enlace.set(c.id, { movs: ms, criterio }); for (const m of ms) libres.delete(m.id); };
  const igual = (a: number, b: number) => Math.abs(a - b) < 0.01;
  const ordenCobro = (a: Cobro, b: Cobro) => a.fecha.localeCompare(b.fecha) || a.id.localeCompare(b.id);
  const transf = cobros.filter((c) => c.tipo === "transferencia").sort(ordenCobro);
  const efectivo = cobros.filter((c) => c.tipo === "efectivo").sort(ordenCobro);
  const disponibles = () => Array.from(libres.values());

  // Nombre del cliente dentro del concepto del banco. El banco corta el concepto (p. ej. a 28
  // caracteres), así que la última palabra puede venir incompleta ("FERNAN" por FERNANDEZ).
  const VACIAS = new Set(["DEL", "LOS", "LAS", "SAC", "EIRL", "SRL", "SAA", "POR", "CON", "ABONO", "INMEDIATO"]);
  const nombreCliente = (c: Cobro) => tokens(ventaDe.get(c.docs[0]?.clave ?? "")?.nombre ?? "").filter((w) => !VACIAS.has(w));
  const puntosNombre = (c: Cobro, m: MovBanco): number => {
    const n = nombreCliente(c); if (!n.length) return 0;
    const b = tokens(m.desc).filter((w) => !VACIAS.has(w)); let p = 0; const usados = new Set<string>();
    b.forEach((w, i) => {
      const exacto = n.find((x) => x === w && !usados.has(x));
      if (exacto) { usados.add(exacto); p++; return; }
      if (i === b.length - 1 && w.length >= 4) { const pref = n.find((x) => x.startsWith(w) && !usados.has(x)); if (pref) { usados.add(pref); p++; } }
    });
    return p;
  };

  // ---- Caja virtual por ZIP (origen "reporte"): qué abonos del banco PUEDEN ser de cada cobro.
  // Calibrado con el estado de cuenta real del BBVA de RTP (oct-2026): el efectivo se deposita en una
  // oficina ("DEPOS. EN CTA. … · OFICINA ANDAH", "INGRESO EN EFECTIVO · OF.MULTIPLAZA"); los Yape y Plin
  // llegan como "ABONO INMEDIATO 002 <nombre>" / "PLIN QR <nombre>"; lo demás son transferencias.
  const canal = (m: MovBanco): "efectivo" | "billetera" | "otro" => {
    const d = sinAcentos(m.desc).toUpperCase();
    if (/DEPOS\.? ?EN CTA|INGRESO EN EFECTIVO|DEP\.? ?(EN )?EFEC|DEPOSITO EN EFECTIVO|VENTANILLA|CAJERO|AGENTE/.test(d)) return "efectivo";
    return /PLIN|YAPE|ABONO INMEDIATO|BANCA MOVIL/.test(d) ? "billetera" : "otro";
  };
  const hayCanalEfectivo = movs.some((m) => m.abono > 0 && canal(m) === "efectivo");
  // Oficina del banco donde se depositó ("ANDAH", "AYACU", "MULTIPLAZA") → sede: por el nombre (ANDAH…
  // = ANDAHUAYLAS) o aprendida de los depósitos ya confirmados con voucher.
  const sedes = Array.from(new Set(cobros.map((c) => c.sede).filter(Boolean)));
  const oficinaSede = new Map<string, string>();
  const oficinaDe = (m: MovBanco) => /\bOF(?:ICINA|\.)\s*([A-ZÑ][A-ZÑ. ]*)$/.exec(sinAcentos(m.desc).toUpperCase())?.[1]?.trim() ?? "";
  const sedeDeOficina = (m: MovBanco): string => {
    const o = oficinaDe(m); if (!o) return "";
    if (oficinaSede.has(o)) return oficinaSede.get(o)!;
    const s = o.length >= 4 ? sedes.find((x) => sinAcentos(x).toUpperCase().split(/\s+/).some((w) => w.length >= 4 && (w.startsWith(o) || o.startsWith(w)))) ?? "" : "";
    oficinaSede.set(o, s); return s;
  };
  const esTarjeta = (c: Cobro) => /VISA|MASTER|TARJETA|\bPOS\b|NIUBIZ|IZIPAY|CULQI|AMEX|DINERS/.test(c.medio.toUpperCase());
  const entidadMov = (m: MovBanco) => m.entidad || entidadDeTexto(m.banco);
  const esBilletera = (c: Cobro) => /YAPE|PLIN/i.test(c.medio);
  /** `porNombre`: el pase exige además el nombre del cliente en el concepto del banco. */
  const apto = (c: Cobro, m: MovBanco, porNombre = false): boolean => {
    if (c.origen !== "reporte") return true;
    // "DEPOSITO BCP": la caja dice a qué banco fue; no se busca en la cuenta de otro banco.
    const bc = entidadDeTexto(c.medio), bm = entidadMov(m);
    if (bc && bm && bc !== bm) return false;
    if (c.tipo === "efectivo") {
      if (c.voucher?.monto != null) return false; // el voucher manda: solo los pases (V)
      if (hayCanalEfectivo && canal(m) !== "efectivo") return false;
      const s = sedeDeOficina(m); return !s || s === c.sede;
    }
    if (esTarjeta(c)) return false; // el procesador abona en lotes y con la comisión descontada
    // Yape / Plin: muchos cobros chicos del mismo monto cada día. Sin el N° de operación ni el nombre del
    // cliente en el banco, la fecha y el monto solos no prueban nada (caso real: los Yape de RTP no se
    // abonan en las cuentas del BBVA y aun así "calzaban" con abonos de otras sedes).
    if (esBilletera(c)) return porNombre && canal(m) !== "efectivo";
    return true;
  };
  const candidatos = (c: Cobro, porNombre = false) => disponibles().filter((m) => apto(c, m, porNombre));
  // (A) Transferencias por N° de operación (si el banco lo trae).
  // Los Yape traen a veces un código con letras ("7B1C03CAE9DD"): ese se busca tal cual.
  for (const c of transf) {
    const alfa = /[A-Z]/i.test(c.op.replace(/^[A-Z]{1,3}-/i, ""));
    const op = alfa ? c.op.toUpperCase().replace(/[^A-Z0-9]/g, "") : soloDigitos(c.op); if (op.length < 5) continue;
    const m = disponibles().find((x) => igual(x.abono, c.importe) && (alfa ? `${x.op} ${x.desc}`.toUpperCase().replace(/[^A-Z0-9 ]/g, "").includes(op) : soloDigitos(x.op) === op || x.desc.replace(/\D/g, "").includes(op)));
    if (m) tomar(c, [m], "N° de operación");
  }
  // (A2) Transferencias por NOMBRE: el concepto del banco trae al cliente (2 o más palabras) con el
  // mismo monto, aunque el abono sea de un día cercano. Va antes que "fecha y monto" porque es más seguro.
  for (const c of transf.filter((x) => !enlace.has(x.id))) {
    const m = candidatos(c, true).filter((x) => igual(x.abono, c.importe) && Math.abs(dias(c.fecha, x.fecha)) <= 3 && puntosNombre(c, x) >= 2)
      .sort((a, b) => puntosNombre(c, b) - puntosNombre(c, a) || Math.abs(dias(c.fecha, a.fecha)) - Math.abs(dias(c.fecha, b.fecha)))[0];
    if (m) tomar(c, [m], m.fecha === c.fecha ? "Fecha, monto y nombre del cliente" : "Monto y nombre del cliente");
  }
  // (A3) Una sola palabra del nombre (p. ej. el apellido) también vale si no hay duda: ese abono es el
  // único con su nombre para ese cobro, y ese cobro el único pendiente que calza con ese abono.
  for (const c of transf.filter((x) => !enlace.has(x.id))) {
    const calza = (x: Cobro, m: MovBanco) => apto(x, m, true) && igual(m.abono, x.importe) && Math.abs(dias(x.fecha, m.fecha)) <= 3 && puntosNombre(x, m) >= 1;
    const ms = disponibles().filter((m) => calza(c, m));
    if (ms.length !== 1) continue;
    if (transf.filter((x) => !enlace.has(x.id) && calza(x, ms[0])).length !== 1) continue;
    tomar(c, [ms[0]], ms[0].fecha === c.fecha ? "Fecha, monto y nombre del cliente" : "Monto y nombre del cliente");
  }
  // (V) Efectivo con VOUCHER del depósito (caja virtual por ZIP): el voucher dice el N° de operación,
  // la fecha y el monto exactos del depósito de ese día.
  const pistaCobro = new Map<string, string>(), pistaMov = new Map<number, string>();
  const dmy = (f: string) => f.split("-").reverse().join("/");
  const traeOp = (x: MovBanco, op: string) => op.length >= 4 && (soloDigitos(x.op) === op || (op.length >= 5 && x.desc.replace(/\D/g, "").includes(op)));
  const conVoucher = efectivo.filter((c) => c.voucher && c.voucher.monto != null);
  // (V1) por N° de operación del voucher (uno o dos depósitos) y el monto depositado.
  for (const c of conVoucher) {
    const ops = c.op.split(" + ").map(soloDigitos).filter((x) => x.length >= 4), monto = c.voucher!.monto!;
    if (!ops.length) continue;
    const cerca = (x: MovBanco) => !c.voucher!.fecha || Math.abs(dias(c.voucher!.fecha, x.fecha)) <= 5;
    const ms = ops.map((op) => disponibles().find((x) => traeOp(x, op) && cerca(x))).filter(Boolean) as MovBanco[];
    if (ms.length === ops.length && new Set(ms.map((m) => m.id)).size === ms.length && igual(ms.reduce((a, m) => a + m.abono, 0), monto)) tomar(c, ms, "N° de operación del voucher");
    else if (ms.length === 1 && ops.length === 1) pistaCobro.set(c.id, `El banco trae la operación ${ops[0]} por ${ms[0].abono.toFixed(2)} (${ms[0].banco} ${dmy(ms[0].fecha)}) y el voucher dice ${monto.toFixed(2)}: revisar`);
  }
  // (V2) por la fecha y el monto del voucher (el extracto no siempre trae el N° de operación).
  for (const c of conVoucher.filter((x) => !enlace.has(x.id))) {
    const v = c.voucher!, f = v.fecha || c.fecha;
    const deSede = (x: MovBanco) => { const s = sedeDeOficina(x); return !s || s === c.sede; };
    const m = disponibles().filter((x) => igual(x.abono, v.monto!) && dias(f, x.fecha) >= 0 && dias(f, x.fecha) <= 3 && deSede(x))
      .sort((a, b) => Number(sedeDeOficina(b) === c.sede) - Number(sedeDeOficina(a) === c.sede) || a.fecha.localeCompare(b.fecha))[0];
    if (m) { tomar(c, [m], "Fecha y monto del voucher"); pistaCobro.delete(c.id); }
  }
  // Las oficinas donde depositó cada sede (confirmadas con voucher) ya no se prueban para otra sede.
  for (const c of conVoucher) for (const m of enlace.get(c.id)?.movs ?? []) { const o = oficinaDe(m); if (o) oficinaSede.set(o, c.sede); }
  // Voucher con fecha posterior al último movimiento del extracto: el depósito está en el siguiente.
  const finBanco = movs.map((m) => m.fecha).filter((f) => /^[1-9]/.test(f)).sort().pop() ?? "";
  for (const c of conVoucher.filter((x) => !enlace.has(x.id) && !pistaCobro.has(x.id))) {
    const v = c.voucher!;
    pistaCobro.set(c.id, v.fecha && finBanco && v.fecha > finBanco
      ? `El voucher del depósito es del ${dmy(v.fecha)} (${(v.monto ?? 0).toFixed(2)}${c.op ? `, op. ${c.op}` : ""}), posterior al último movimiento del extracto (${dmy(finBanco)}): figurará en el extracto siguiente`
      : `El depósito del voucher (${v.fecha ? dmy(v.fecha) : "sin fecha"}, ${(v.monto ?? 0).toFixed(2)}${c.op ? `, op. ${c.op}` : ""}) no está en los extractos subidos`);
  }
  // (B) Efectivo: el total del día por sede = un depósito por el mismo monto en los 7 días siguientes.
  for (const c of efectivo) {
    if (enlace.has(c.id)) continue;
    const m = candidatos(c).filter((x) => igual(x.abono, c.importe) && dias(c.fecha, x.fecha) >= 0 && dias(c.fecha, x.fecha) <= 7).sort((a, b) => a.fecha.localeCompare(b.fecha))[0];
    if (m) tomar(c, [m], "Monto exacto del depósito");
  }
  const pend = () => transf.filter((c) => !enlace.has(c.id));
  // (C) Transferencias del mismo día y monto; si hay varias iguales, por el nombre del cliente.
  const grupos = new Map<string, Cobro[]>();
  const clase = (c: Cobro) => (c.origen !== "reporte" ? "" : esTarjeta(c) ? "tarjeta" : esBilletera(c) ? "billetera" : `otro ${entidadDeTexto(c.medio)}`);
  for (const c of pend()) { const k = `${c.fecha}|${c.importe.toFixed(2)}|${clase(c)}`; if (!grupos.has(k)) grupos.set(k, []); grupos.get(k)!.push(c); }
  for (const [k, cs] of Array.from(grupos.entries())) {
    const [fecha, imp] = k.split("|");
    let ms = candidatos(cs[0]).filter((m) => m.fecha === fecha && igual(m.abono, Number(imp)));
    if (!ms.length) continue;
    if (cs.length === 1 && ms.length === 1) { tomar(cs[0], [ms[0]], "Fecha y monto"); continue; }
    const puntos = puntosNombre;
    // Primero las parejas que el nombre identifica sin duda (mejor puntaje, sin empate).
    let quedan = [...cs];
    for (let vuelta = 0; vuelta < cs.length; vuelta++) {
      let mejor: { c: Cobro; m: MovBanco; p: number } | null = null, empate = false;
      for (const c of quedan) for (const m of ms) { const p = puntos(c, m); if (p > 0 && (!mejor || p > mejor.p)) { mejor = { c, m, p }; empate = false; } else if (mejor && p === mejor.p && (c !== mejor.c || m !== mejor.m)) empate = empate || (c === mejor.c || m === mejor.m); }
      if (!mejor || empate) break;
      tomar(mejor.c, [mejor.m], "Fecha, monto y nombre del cliente");
      quedan = quedan.filter((x) => x !== mejor!.c); ms = ms.filter((x) => x !== mejor!.m);
    }
    // El resto cuadra en conjunto, pero no se puede decir cuál abono es de cuál comprobante.
    const n = Math.min(quedan.length, ms.length);
    for (let i = 0; i < n; i++) tomar(quedan[i], [ms[i]], n === 1 ? "Fecha y monto" : `Fecha y monto (${n} cobros iguales ese día: cuadran en conjunto)`);
  }
  // (D) Transferencias con el mismo monto en una fecha cercana (± 3 días).
  for (const c of pend()) {
    const m = candidatos(c).filter((x) => igual(x.abono, c.importe) && Math.abs(dias(c.fecha, x.fecha)) <= 3).sort((a, b) => Math.abs(dias(c.fecha, a.fecha)) - Math.abs(dias(c.fecha, b.fecha)))[0];
    if (m) tomar(c, [m], "Monto exacto, fecha cercana");
  }
  // (D2) Transferencias cuyo abono llegó bastante después (p. ej. pagos de entidades por otro
  // banco): solo si ese monto es ÚNICO entre lo pendiente de ambos lados (sin riesgo de cruce).
  for (const c of pend()) {
    const iguales = pend().filter((x) => igual(x.importe, c.importe));
    const ms = candidatos(c).filter((x) => igual(x.abono, c.importe) && dias(c.fecha, x.fecha) >= 0);
    if (iguales.length === 1 && ms.length === 1) tomar(c, [ms[0]], "Monto exacto único, abono posterior");
  }
  // (E) Efectivo depositado en DOS partes dentro de los 7 días siguientes.
  for (const c of efectivo.filter((x) => !enlace.has(x.id) && x.origen !== "reporte")) {
    const cand = disponibles().filter((x) => dias(c.fecha, x.fecha) >= 0 && dias(c.fecha, x.fecha) <= 7 && x.abono < c.importe).sort((a, b) => a.fecha.localeCompare(b.fecha));
    let par: MovBanco[] | null = null;
    for (let i = 0; i < cand.length && !par; i++) for (let j = i + 1; j < cand.length; j++) if (igual(cand[i].abono + cand[j].abono, c.importe)) { par = [cand[i], cand[j]]; break; }
    if (par) tomar(c, par, "Suma de dos depósitos");
  }
  // (F) Efectivo con el mismo monto depositado más adelante (más de 7 días).
  for (const c of efectivo.filter((x) => !enlace.has(x.id) && x.origen !== "reporte")) {
    const m = disponibles().filter((x) => igual(x.abono, c.importe) && dias(c.fecha, x.fecha) > 7).sort((a, b) => a.fecha.localeCompare(b.fecha))[0];
    if (m) tomar(c, [m], "Monto exacto, depósito tardío");
  }

  // Pistas para lo que quedó suelto: un efectivo sin depósito EXACTO pero con un abono libre de monto
  // parecido en los días siguientes (p. ej. depositaron S/ 1,000 de un cobro de S/ 1,030). No se da
  // por conciliado: se muestra como posible, con la diferencia.
  for (const c of efectivo.filter((x) => !enlace.has(x.id) && !pistaCobro.has(x.id))) {
    const tol = Math.max(50, c.importe * 0.03);
    const m = candidatos(c).filter((x) => !pistaMov.has(x.id) && dias(c.fecha, x.fecha) >= 0 && dias(c.fecha, x.fecha) <= 7 && Math.abs(x.abono - c.importe) <= tol)
      .sort((a, b) => Math.abs(a.abono - c.importe) - Math.abs(b.abono - c.importe))[0];
    if (!m) continue;
    const dif = r2(c.importe - m.abono);
    pistaCobro.set(c.id, `Posible depósito con diferencia: ${m.banco} ${dmy(m.fecha)} por ${m.abono.toFixed(2)} (${dif > 0 ? "faltan" : "sobran"} ${Math.abs(dif).toFixed(2)})`);
    pistaMov.set(m.id, `Posible depósito del efectivo del ${dmy(c.fecha)} ${c.sede} (cobro ${c.importe.toFixed(2)}, diferencia ${Math.abs(dif).toFixed(2)})`);
  }

  // Bordes del periodo: lo cobrado los últimos días suele depositarse los primeros días del mes
  // siguiente, y los primeros abonos del mes suelen ser ventas del mes anterior.
  const fechasPer = ventas.map((v) => v.fecha).filter(Boolean).sort();
  const inicioPer = fechasPer[0] ?? "", finPer = fechasPer[fechasPer.length - 1] ?? "";
  const DIAS_BORDE = 6;
  const esFinDeMes = (f: string) => Boolean(finPer && f) && dias(f, finPer) >= 0 && dias(f, finPer) < DIAS_BORDE;
  const esInicioDeMes = (f: string) => Boolean(inicioPer && f) && dias(inicioPer, f) >= 0 && dias(inicioPer, f) < DIAS_BORDE;
  const NOTA_FIN = "fin de mes: el depósito puede figurar en los primeros días del mes siguiente";
  const NOTA_INICIO = "inicio de mes: puede corresponder a ventas del mes anterior";

  // Caja virtual por ZIP: medios de pago que casi no aparecen en los extractos subidos → falta una cuenta.
  const entidades = new Set(movs.map(entidadMov).filter(Boolean));
  const porMedio = new Map<string, Cobro[]>();
  for (const c of transf.filter((x) => x.origen === "reporte")) { const k = esBilletera(c) ? "YAPE / PLIN" : c.medio; if (!porMedio.has(k)) porMedio.set(k, []); porMedio.get(k)!.push(c); }
  for (const [medio, cs] of Array.from(porMedio.entries())) {
    const ok = cs.filter((c) => enlace.has(c.id)).length, total = r2(cs.reduce((a, c) => a + c.importe, 0));
    if (cs.length < 3 || ok / cs.length >= 0.5) continue;
    const bc = entidadDeTexto(medio);
    if (esTarjeta(cs[0])) avisos.push(`${cs.length} cobro(s) con ${medio} por S/ ${total.toFixed(2)}: los pagos con tarjeta los abona el procesador en lotes y con la comisión descontada, así que no se cruzan uno por uno con el banco. Quedan como "sin abono" para revisarlos con la liquidación del procesador.`);
    else if (medio === "YAPE / PLIN") avisos.push(`${cs.length} cobro(s) por Yape / Plin por S/ ${total.toFixed(2)}: solo ${ok} figuran en los extractos subidos (por el N° de operación o el nombre del cliente). Los demás no están en estas cuentas: falta el extracto de la cuenta donde se abonan los Yape (o su reporte de operaciones). No se cruzan solo por fecha y monto porque hay muchos del mismo importe cada día.`);
    else if (bc && entidades.size && !entidades.has(bc)) avisos.push(`${cs.length} cobro(s) por ${medio} por S/ ${total.toFixed(2)}: ningún extracto subido es del ${bc} (los subidos son de ${Array.from(entidades).join(", ")}). Falta el extracto de esa cuenta.`);
  }
  if (cobros.some((c) => c.origen === "reporte") && !Array.from(enlace.values()).some((e) => /^N° de operación/.test(e.criterio)) && entidades.has("BBVA"))
    avisos.push(`Ningún N° de operación de la caja virtual figura en los extractos: el "N° OPER." del estado de cuenta del BBVA es el correlativo de la cuenta, no el número del voucher. El efectivo se cruzó por la fecha y el monto del voucher del depósito (y la oficina del banco); los depósitos de clientes, por fecha, monto y nombre.`);

  // ---- filas: cobros vs banco
  const filaCobros: FilaCobro[] = cobros.slice().sort(ordenCobro).map((c) => {
    const e = enlace.get(c.id); const m0 = e?.movs[0];
    return {
      cobro: c.id, fecha: c.fecha, medio: c.medio, sede: c.sede, op: c.op, importe: c.importe, comprobantes: c.docs.length,
      banco: e ? Array.from(new Set(e.movs.map((m) => m.banco))).join(" + ") : "", bancoFecha: m0?.fecha ?? "", bancoDesc: e ? e.movs.map((m) => m.desc).join(" + ") : "",
      bancoOp: e ? e.movs.map((m) => m.op).filter(Boolean).join(" + ") : "", bancoImporte: e ? r2(e.movs.reduce((a, m) => a + m.abono, 0)) : 0,
      dias: m0 ? dias(c.fecha, e!.movs[e!.movs.length - 1].fecha) : null,
      estado: c.tipo === "nc" ? "No aplica" : e ? "Conciliado" : "No conciliado",
      criterio: c.tipo === "nc" ? "Aplicación de nota de crédito (no pasa por el banco)" : e?.criterio ?? pistaCobro.get(c.id) ?? `${esFinDeMes(c.fecha) ? `Sin movimiento en el banco (${NOTA_FIN})` : "Sin movimiento en el banco"}${c.nota ? `. ${c.nota}` : ""}`,
    };
  });
  const filaCobroDe = new Map(filaCobros.map((f) => [f.cobro, f]));

  // ---- filas: comprobantes
  const cobrosDe = new Map<string, { c: Cobro; d: DocCobro }[]>();
  for (const c of cobros) for (const d of c.docs) { if (!cobrosDe.has(d.clave)) cobrosDe.set(d.clave, []); cobrosDe.get(d.clave)!.push({ c, d }); }
  const ncAplicadas = new Set(cobros.filter((c) => c.ncClave).map((c) => c.ncClave!));
  const ncDe = new Map(ventas.filter((v) => v.td === "07" && v.ref).map((v) => [v.ref, v]));
  const comprobantes: FilaComprobante[] = ventas.map((v) => {
    const base = { fecha: v.fecha, td: v.td, doc: v.doc, cliente: v.nombre, ruc: v.ruc, total: v.total, cobro: "", cobroFecha: "", medio: "", sede: "", op: "", cobrado: 0, banco: "", bancoFecha: "", bancoDesc: "", bancoImporte: 0, dias: null as number | null, criterio: "" };
    if (v.td === "07") {
      const ok = ncAplicadas.has(v.clave);
      return { ...base, estado: ok ? "Conciliado" : "No conciliado", motivo: ok ? "" : "Nota de crédito sin aplicar en la caja virtual", criterio: ok ? "Nota de crédito aplicada en la caja virtual" : "" } as FilaComprobante;
    }
    const cs = cobrosDe.get(v.clave) ?? [];
    if (!cs.length) {
      const nc = ncDe.get(v.clave);
      const nota = meta.notasSinCobro?.[v.clave];
      return { ...base, estado: "No conciliado", motivo: `Sin cobro en la caja virtual${nc ? ` (tiene nota de crédito ${nc.doc})` : ""}`, criterio: nota ?? "" } as FilaComprobante;
    }
    const cobrado = r2(cs.reduce((a, x) => a + x.d.importe, 0));
    const principal = cs.find((x) => x.c.tipo !== "nc") ?? cs[0];
    const fc = filaCobroDe.get(principal.c.id)!;
    const lleno = { ...base, cobro: cs.map((x) => x.c.id).join(" + "), cobroFecha: principal.c.fecha, medio: cs.map((x) => x.c.medio).filter((x, i, a) => a.indexOf(x) === i).join(" + "), sede: principal.c.sede, op: principal.c.op, cobrado, banco: fc.banco, bancoFecha: fc.bancoFecha, bancoDesc: fc.bancoDesc, bancoImporte: fc.bancoImporte, dias: fc.dias, criterio: fc.criterio };
    if (Math.abs(cobrado - v.total) >= 0.01) return { ...lleno, estado: "No conciliado", motivo: `Diferencia de monto: comprobante ${v.total.toFixed(2)} · cobrado ${cobrado.toFixed(2)}` } as FilaComprobante;
    const sinBanco = cs.filter((x) => x.c.tipo !== "nc" && !enlace.has(x.c.id));
    if (sinBanco.length) {
      // El motivo sale del cobro que quedó sin banco (un comprobante puede tener más de un cobro).
      const sb = sinBanco[0];
      const base = (sb.c.tipo === "efectivo" ? "Cobrado en efectivo, sin depósito en el banco" : sb.c.origen === "reporte" ? `Cobrado con ${sb.c.medio}, sin abono en el banco` : "Cobrado por transferencia, sin abono en el banco") + (cs.length > 1 ? ` (cobro ${sb.c.id} por ${sb.d.importe.toFixed(2)})` : "");
      return { ...lleno, criterio: pistaCobro.get(sb.c.id) ?? sb.c.nota ?? "", estado: "No conciliado", motivo: esFinDeMes(sb.c.fecha) ? `${base} (${NOTA_FIN})` : base } as FilaComprobante;
    }
    return { ...lleno, estado: "Conciliado", motivo: "" } as FilaComprobante;
  });
  // Cobros de comprobantes que no están en el registro de ventas.
  const fuera = Array.from(cobrosDe.keys()).filter((k) => !ventaDe.has(k));
  if (fuera.length) avisos.push(`${fuera.length} comprobante(s) cobrados en la caja virtual no están en el Registro de Ventas: ${fuera.slice(0, 8).map(docVisible).join(", ")}${fuera.length > 8 ? "…" : ""}`);

  // El depósito del voucher no es igual al efectivo del día: la fila concilia (el depósito está en el
  // banco) pero se avisa la diferencia, con la nota que traiga el propio voucher.
  const SIN_VOUCHER = "La sede no subió el voucher de este depósito: conciliado solo por el monto del efectivo del día. Verificar.";
  const difVoucher = (c: Cobro): string => {
    const v = c.voucher!; const nota = /Nota del voucher:.*$/.exec(v.obs)?.[0] ?? "";
    return `El depósito (${(v.monto ?? 0).toFixed(2)}) es ${v.diferencia < 0 ? "MENOR" : "MAYOR"} que el efectivo del día (${c.importe.toFixed(2)}) en ${Math.abs(v.diferencia).toFixed(2)}. ${nota || "Verificar."}`.trim();
  };

  // ---- filas: bancos
  const usoDe = new Map<number, Cobro>();
  for (const [id, e] of Array.from(enlace.entries())) for (const m of e.movs) usoDe.set(m.id, cobros.find((c) => c.id === id)!);
  // Cargos: solo se sugiere el texto cuando es evidente; el resto lo completa contabilidad.
  const sugerirCargo = (desc: string): string => {
    const d = sinAcentos(desc).toUpperCase();
    if (/REGULARIZACION ITF/.test(d)) return "REGULARIZACIÓN ITF";
    if (/\bITF\b/.test(d)) return "IMPUESTO ITF";
    if (/COMIS|^\*?COM\.|MANTENIM|^MANT\b|ENVIO\.EST\.CTA|PORTES/.test(d)) return "COMISION";
    if (/^HABER TLC/.test(d)) return "PAGO HABERES";
    return "";
  };
  const bancos: FilaBanco[] = movs.slice().sort((a, b) => a.banco.localeCompare(b.banco) || a.fecha.localeCompare(b.fecha) || a.id - b.id).map((m) => {
    const c = usoDe.get(m.id);
    const esCargo = m.cargo > 0 && !m.abono;
    let obs = "";
    if (c && c.tipo === "transferencia") {
      const e = enlace.get(c.id)!, cliente = ventaDe.get(c.docs[0]?.clave ?? "")?.nombre ?? "";
      if (/cobros iguales/.test(e.criterio)) obs = "Varios cobros del mismo monto ese día: cuadran en conjunto, no se puede asegurar cuál abono es de cuál comprobante.";
      if (e.criterio !== "N° de operación" && cliente && puntosNombre(c, m) === 0) obs = `El nombre que trae el banco no es el del cliente (${cliente}): conciliado solo por fecha y monto. Verificar.`;
    } else if (c && c.tipo === "efectivo" && c.voucher && Math.abs(c.voucher.diferencia) >= 0.01) obs = difVoucher(c);
    else if (c && c.tipo === "efectivo" && c.origen === "reporte" && !c.voucher) obs = SIN_VOUCHER;
    else if (c && c.tipo === "efectivo" && (enlace.get(c.id)?.movs.length ?? 0) > 1) obs = `El efectivo de ese día (${c.importe.toFixed(2)}) se depositó en dos partes.`;
    const sinCobro = pistaMov.get(m.id) ?? (m.abono > 0 && esInicioDeMes(m.fecha) ? `Sin cobro en la caja de este periodo (${NOTA_INICIO})` : m.abono > 0 ? "Sin cobro en la caja virtual" : "");
    if (!c && !esCargo) obs = sinCobro;
    return {
      conciliacion: esCargo ? sugerirCargo(m.desc) : c ? c.glosa.replace(/\s+/g, " ").trim() : "", obs,
      banco: m.banco, fecha: m.fecha, desc: m.desc, op: m.op, abono: m.abono, cargo: m.cargo,
      estado: esCargo ? "Cargo" : c ? "Conciliado" : "No conciliado",
      cobro: c?.id ?? "", detalle: !c ? sinCobro : (c.tipo === "efectivo" ? `Efectivo del ${c.fecha.split("-").reverse().join("/")} ${c.sede} (${c.docs.length} comprobantes)` : `${c.docs.map((d) => d.doc).join(", ")}`),
    };
  });

  // ---- por fecha: ventas del día = caja del día; y de la caja del día, qué llegó al banco
  const dia = new Map<string, FilaFecha>();
  const delDia = (f: string) => { if (!dia.has(f)) dia.set(f, { fecha: f, ventas: 0, notasCredito: 0, comprobantes: 0, cajaEfectivo: 0, cajaTransferencias: 0, cajaTotal: 0, difVentasCaja: 0, depositado: 0, sinDepositar: 0, depositoDesde: "", depositoHasta: "", abonosBanco: 0, estado: "Conciliado", nota: "" }); return dia.get(f)!; };
  for (const v of ventas) { if (!v.fecha) continue; const d = delDia(v.fecha); d.comprobantes++; if (v.td === "07") d.notasCredito += v.total; else d.ventas += v.total; }
  for (const c of cobros) {
    if (c.tipo === "nc" || !c.fecha) continue;
    const d = delDia(c.fecha);
    if (c.tipo === "efectivo") d.cajaEfectivo += c.importe; else d.cajaTransferencias += c.importe;
    const e = enlace.get(c.id);
    if (e) { d.depositado += c.importe; for (const m of e.movs) { if (!d.depositoDesde || m.fecha < d.depositoDesde) d.depositoDesde = m.fecha; if (m.fecha > d.depositoHasta) d.depositoHasta = m.fecha; } }
    else d.sinDepositar += c.importe;
  }
  for (const m of movs) if (m.abono > 0 && m.fecha) delDia(m.fecha).abonosBanco += m.abono;
  const porFecha = Array.from(dia.values()).sort((a, b) => a.fecha.localeCompare(b.fecha)).map((d) => {
    const f: FilaFecha = { ...d, ventas: r2(d.ventas), notasCredito: r2(d.notasCredito), cajaEfectivo: r2(d.cajaEfectivo), cajaTransferencias: r2(d.cajaTransferencias), cajaTotal: r2(d.cajaEfectivo + d.cajaTransferencias), depositado: r2(d.depositado), sinDepositar: r2(d.sinDepositar), abonosBanco: r2(d.abonosBanco) };
    f.difVentasCaja = r2(f.ventas - f.notasCredito - f.cajaTotal);
    const notas: string[] = [];
    if (Math.abs(f.difVentasCaja) >= 0.01) notas.push(`ventas y caja difieren en ${f.difVentasCaja.toFixed(2)}`);
    if (f.sinDepositar >= 0.01) notas.push(`${f.sinDepositar.toFixed(2)} sin llegar al banco${esFinDeMes(f.fecha) ? ` (${NOTA_FIN})` : ""}`);
    f.estado = notas.length ? "No conciliado" : "Conciliado";
    f.nota = notas.join(" · ");
    return f;
  });

  // ---- HOJA ÚNICA: contabilidad | caja virtual | bancos, con el punto en común de cada salto
  const TIPO_DOC: Record<string, string> = { "01": "Factura", "03": "Boleta", "07": "Nota de crédito", "08": "Nota de débito" };
  const vacia = (): FilaUnica => ({ cFecha: "", cDoc: "", cTipo: "", cCliente: "", cTotal: null, vDoc: "", vCobro: "", vFecha: "", vMedio: "", vImporte: null, vTotalCobro: null, vOp: "", bBanco: "", bFecha: "", bDesc: "", bOp: "", bImporte: null, estado: "No conciliado", punto1: "", punto2: "", obs: "" });
  const punto2De = (c: Cobro): string => {
    const e = enlace.get(c.id); if (!e) return "";
    const m = e.movs[0], monto = `Monto ${c.importe.toFixed(2)}`;
    if (e.criterio === "N° de operación") return `N° de operación ${/[A-Z]/i.test(c.op.replace(/^[A-Z]{1,3}-/i, "")) ? c.op : soloDigitos(c.op) || c.op}`;
    if (e.criterio === "N° de operación del voucher") return `N° de operación ${c.op} (voucher del depósito) + monto ${(c.voucher?.monto ?? c.importe).toFixed(2)}`;
    if (e.criterio === "Fecha y monto del voucher") return `Voucher del depósito: ${dmy(c.voucher?.fecha || m.fecha)} por ${(c.voucher?.monto ?? c.importe).toFixed(2)}${c.op ? ` (op. ${c.op}: el extracto no la trae)` : ""}`;
    if (c.tipo === "efectivo") return e.movs.length > 1 ? `${monto} = ${e.movs.map((x) => x.abono.toFixed(2)).join(" + ")} (dos depósitos)` : `${monto} = depósito del ${dmy(m.fecha)}`;
    const nombre = puntosNombre(c, m) >= 1 ? " + nombre del cliente" : "";
    const grupo = /cobros iguales/.test(e.criterio) ? " (varios iguales ese día: cuadran en conjunto)" : "";
    return m.fecha === c.fecha ? `Fecha ${dmy(c.fecha)} + ${monto.toLowerCase()}${nombre}${grupo}` : `${monto}${nombre}, abono del ${dmy(m.fecha)}`;
  };
  const conBanco = (f: FilaUnica, c: Cobro) => {
    const e = enlace.get(c.id); if (!e) return;
    f.bBanco = Array.from(new Set(e.movs.map((m) => m.banco))).join(" + "); f.bFecha = e.movs[0].fecha;
    f.bDesc = e.movs.map((m) => m.desc).join(" + "); f.bOp = e.movs.map((m) => m.op).filter(Boolean).join(" + "); f.bImporte = r2(e.movs.reduce((a, m) => a + m.abono, 0));
  };
  const conCaja = (f: FilaUnica, c: Cobro, doc: string, importe: number) => {
    f.vDoc = doc; f.vCobro = c.id; f.vFecha = c.fecha; f.vMedio = [c.medio, c.sede].filter(Boolean).join(" · "); f.vImporte = importe; f.vTotalCobro = c.importe; f.vOp = c.op;
  };
  const ncPorClave = new Map(cobros.filter((c) => c.ncClave).map((c) => [c.ncClave!, c]));
  const unificada: FilaUnica[] = [];
  ventas.map((v, i) => ({ v, fc: comprobantes[i] })).sort((a, b) => a.v.fecha.localeCompare(b.v.fecha) || a.v.doc.localeCompare(b.v.doc)).forEach(({ v, fc }) => {
    const f = vacia();
    f.cFecha = v.fecha; f.cDoc = v.doc; f.cTipo = TIPO_DOC[v.td] ?? v.td; f.cCliente = v.nombre; f.cTotal = v.td === "07" ? -v.total : v.total;
    f.estado = fc.estado; f.obs = fc.motivo ? (/^Sin cobro/.test(fc.motivo) && fc.criterio ? `${fc.motivo}. ${fc.criterio}` : fc.motivo) : (fc.estado === "No conciliado" ? fc.criterio : "");
    if (v.td === "07") {
      const c = ncPorClave.get(v.clave);
      if (c) { conCaja(f, c, v.doc, c.importe); f.punto1 = `Comprobante ${v.doc}`; f.punto2 = "Nota de crédito: no pasa por el banco"; }
    } else {
      const cs = cobrosDe.get(v.clave) ?? [];
      const pr = cs.find((x) => x.c.tipo !== "nc") ?? cs[0];
      if (pr) {
        conCaja(f, pr.c, v.doc, r2(cs.reduce((a, x) => a + x.d.importe, 0)));
        f.punto1 = `Comprobante ${v.doc}`;
        if (pr.c.tipo === "nc") f.punto2 = "Cancelado con nota de crédito: no pasa por el banco";
        else {
          conBanco(f, pr.c); f.punto2 = punto2De(pr.c);
          const e = enlace.get(pr.c.id);
          if (e && pr.c.tipo === "transferencia" && e.criterio !== "N° de operación" && puntosNombre(pr.c, e.movs[0]) === 0 && nombreCliente(pr.c).length) {
            f.obs = "El nombre que trae el banco no es el del cliente: se concilió solo por fecha y monto (pudo pagar otra persona). Verificar.";
          }
        }
        if (fc.estado === "Conciliado" && pr.c.tipo === "efectivo" && pr.c.voucher && Math.abs(pr.c.voucher.diferencia) >= 0.01 && enlace.has(pr.c.id)) f.obs = difVoucher(pr.c);
        else if (fc.estado === "Conciliado" && pr.c.tipo === "efectivo" && pr.c.origen === "reporte" && !pr.c.voucher && enlace.has(pr.c.id)) f.obs = SIN_VOUCHER;
        if (!f.obs && fc.estado === "No conciliado") f.obs = pistaCobro.get(pr.c.id) ?? pr.c.nota ?? "";
        else if (fc.estado === "No conciliado" && pistaCobro.has(pr.c.id) && !f.obs.includes("Posible")) f.obs = `${f.obs}. ${pistaCobro.get(pr.c.id)}`;
      }
    }
    unificada.push(f);
  });
  // Cobrado en la caja pero el comprobante no está en el Registro de Ventas.
  const minSerie = new Map<string, number>();
  for (const v of ventas) { const [se, nu] = v.clave.split("-"); const n = Number(nu); if (Number.isFinite(n) && (minSerie.get(se) ?? Infinity) > n) minSerie.set(se, n); }
  for (const k of fuera) for (const x of cobrosDe.get(k) ?? []) {
    const f = vacia(); conCaja(f, x.c, x.d.doc, x.d.importe); conBanco(f, x.c); f.punto2 = punto2De(x.c);
    const [se, nu] = k.split("-"); const min = minSerie.get(se);
    f.obs = `Cobrado en la caja virtual: el comprobante no está en el Registro de Ventas${min != null && Number(nu) < min ? " (su número es anterior a los del periodo: puede ser una venta de un mes anterior cobrada en este)" : ""}`; unificada.push(f);
  }
  // Lo que hay en el banco y no corresponde a ningún cobro (y, al final, los cargos).
  for (const b of bancos.filter((x) => x.estado === "No conciliado")) { const f = vacia(); f.bBanco = b.banco; f.bFecha = b.fecha; f.bDesc = b.desc; f.bOp = b.op; f.bImporte = b.abono; f.obs = b.detalle || "Abono del banco sin cobro en la caja virtual"; unificada.push(f); }
  for (const b of bancos.filter((x) => x.estado === "Cargo")) { const f = vacia(); f.bBanco = b.banco; f.bFecha = b.fecha; f.bDesc = b.desc; f.bOp = b.op; f.bImporte = -b.cargo; f.estado = "Cargo"; f.obs = "Cargo del banco (no es cobranza)"; unificada.push(f); }

  // ---- resumen
  const sum = (xs: { v: number }[]) => r2(xs.reduce((a, x) => a + x.v, 0));
  const noConc = comprobantes.filter((f) => f.estado === "No conciliado");
  const porMotivo: Record<string, { n: number; importe: number }> = {};
  for (const f of noConc) { const k = f.motivo.replace(/ \(cobro .+? por [\d.]+\)/, "").replace(/ \(tiene nota.*$/, "").replace(/ \(fin de mes.*$/, " — fin de mes (puede estar depositado el mes siguiente)").replace(/:.*$/, ""); const o = (porMotivo[k] = porMotivo[k] ?? { n: 0, importe: 0 }); o.n++; o.importe = r2(o.importe + f.total); }
  const cobrosBanco = filaCobros.filter((f) => f.estado !== "No aplica");
  const porCriterio: Record<string, number> = {};
  for (const f of cobrosBanco.filter((x) => x.estado === "Conciliado")) { const k = f.criterio.replace(/ \(\d+ cobros.*$/, " (varios iguales el mismo día)"); porCriterio[k] = (porCriterio[k] ?? 0) + 1; }
  const nombresBanco = Array.from(new Set(movs.map((m) => m.banco)));
  const fechas = ventas.map((v) => v.fecha).sort();
  const resumen: ResumenConciliacion = {
    empresa: meta.empresa, ruc: meta.ruc,
    periodo: fechas.length ? `${fechas[0].split("-").reverse().join("/")} al ${fechas[fechas.length - 1].split("-").reverse().join("/")}` : "",
    ventas: {
      total: comprobantes.length, importe: sum(comprobantes.map((f) => ({ v: f.td === "07" ? -f.total : f.total }))),
      conciliados: comprobantes.length - noConc.length, importeConciliado: sum(comprobantes.filter((f) => f.estado === "Conciliado").map((f) => ({ v: f.td === "07" ? -f.total : f.total }))),
      noConciliados: noConc.length, importeNoConciliado: sum(noConc.map((f) => ({ v: f.td === "07" ? -f.total : f.total }))), porMotivo,
    },
    cobros: {
      total: cobrosBanco.length, importe: sum(cobrosBanco.map((f) => ({ v: f.importe }))),
      conciliados: cobrosBanco.filter((f) => f.estado === "Conciliado").length, importeConciliado: sum(cobrosBanco.filter((f) => f.estado === "Conciliado").map((f) => ({ v: f.importe }))),
      noConciliados: cobrosBanco.filter((f) => f.estado === "No conciliado").length, importeNoConciliado: sum(cobrosBanco.filter((f) => f.estado === "No conciliado").map((f) => ({ v: f.importe }))), porCriterio,
    },
    bancos: nombresBanco.map((b) => {
      const fs = bancos.filter((f) => f.banco === b), ab = fs.filter((f) => f.abono > 0), co = ab.filter((f) => f.estado === "Conciliado"), nc = ab.filter((f) => f.estado === "No conciliado"), ca = fs.filter((f) => f.estado === "Cargo");
      return { banco: b, abonos: ab.length, importeAbonos: sum(ab.map((f) => ({ v: f.abono }))), conciliados: co.length, importeConciliado: sum(co.map((f) => ({ v: f.abono }))), noConciliados: nc.length, importeNoConciliado: sum(nc.map((f) => ({ v: f.abono }))), cargos: ca.length, importeCargos: sum(ca.map((f) => ({ v: f.cargo }))) };
    }),
  };
  return { resumen, unificada, comprobantes, cobros: filaCobros, bancos, porFecha, avisos };
}

/** Lee los archivos subidos (cualquier hoja en cualquier casilla), los clasifica y concilia. */
export interface EntradasExtra {
  /** Cobros de la caja virtual armados desde los ZIP por sede (reporte de caja + vouchers). */
  cobros?: Cobro[]; notasSinCobro?: Record<string, string>;
  /** Movimientos de bancos leídos de PDF o Word. */
  movs?: Omit<MovBanco, "id">[];
  avisos?: string[];
}
export async function conciliarArchivos(archivos: { nombre: string; buf: Buffer }[], extra: EntradasExtra = {}): Promise<ResultadoConciliacion> {
  const avisos: string[] = [...(extra.avisos ?? [])];
  let empresa = "", ruc = "";
  let registro: Venta[] = []; const diario: Venta[] = [], cobros: Cobro[] = [], movs: MovBanco[] = [];
  const porEmpresa = new Map<string, { empresa: string; ruc: string; ventas: Venta[] }>();
  const nBancos: string[] = [];
  let otrosDiario = 0;
  for (const a of archivos) {
    let hojas: Hoja[];
    try { hojas = await leerHojas(a.buf, a.nombre); } catch { throw new Error(`No se pudo leer "${a.nombre}". Debe ser un Excel (.xlsx).`); }
    const unaSola = hojas.length === 1;
    for (const h of hojas) {
      const t = tipoDeHoja(h);
      if (t.tipo === "ventas") {
        const p = parseVentas(h, t.fila); const k = p.ruc || p.empresa || "?";
        const g = porEmpresa.get(k) ?? porEmpresa.set(k, { empresa: p.empresa, ruc: p.ruc, ventas: [] }).get(k)!;
        g.ventas.push(...p.ventas);
      }
      else if (t.tipo === "diario") { const p = parseDiario(h, t.fila); if (!empresa) empresa = p.empresa; diario.push(...p.ventas); otrosDiario += p.otros; }
      else if (t.tipo === "caja") cobros.push(...parseCaja(h, t.fila));
      else if (t.tipo === "banco") { const nombre = (unaSola ? a.nombre.replace(/\.xlsx?$/i, "") : h.hoja).trim(); nBancos.push(nombre); movs.push(...parseBanco(h, t.fila, nombre, movs.length)); }
      else if (h.rows.length > 3) avisos.push(`No se reconoció la hoja "${h.hoja}" de "${a.nombre}" (no parece Registro de Ventas, Libro Diario, caja virtual ni banco): se omitió.`);
    }
  }
  for (const m of extra.movs ?? []) { if (!nBancos.includes(m.banco)) nBancos.push(m.banco); movs.push({ ...m, id: movs.length }); }
  // Caja virtual: los ZIP por sede (traen el N° de operación y el voucher) mandan sobre las tramas.
  let cobrosFin = cobros;
  if (extra.cobros?.length) {
    if (cobros.length) avisos.push("Se subieron las tramas de cobranza (Excel) y también los ZIP de la caja virtual: se usaron los ZIP, que traen el N° de operación y el voucher del depósito. Las tramas no se usaron.");
    cobrosFin = extra.cobros;
  }
  // Registro de Ventas con VARIAS empresas (una pestaña por empresa): las series se repiten entre
  // empresas, así que se usa solo la empresa de la caja virtual subida (la que más comprobantes
  // comparte con ella, por número e importe).
  const grupos = Array.from(porEmpresa.values());
  if (grupos.length > 1 && cobrosFin.length) {
    const enCaja = new Set(cobrosFin.flatMap((c) => c.docs.map((d) => `${d.clave}|${d.importe.toFixed(2)}`)));
    const puntos = grupos.map((g) => g.ventas.filter((v) => enCaja.has(`${v.clave}|${v.total.toFixed(2)}`)).length);
    const mejor = puntos.indexOf(Math.max(...puntos));
    avisos.push(`El Registro de Ventas trae ${grupos.length} empresas: se usó ${grupos[mejor].empresa || grupos[mejor].ruc} (${grupos[mejor].ventas.length} comprobantes), que es la de la caja virtual subida. Las demás no se tomaron: ${grupos.filter((_, i) => i !== mejor).map((g) => g.empresa || g.ruc).join(", ")}.`);
    registro = grupos[mejor].ventas; empresa = grupos[mejor].empresa || empresa; ruc = grupos[mejor].ruc || ruc;
  } else {
    registro = grupos.flatMap((g) => g.ventas);
    if (grupos[0]) { empresa = grupos[0].empresa || empresa; ruc = grupos[0].ruc || ruc; }
  }
  // Contabilidad: Registro de Ventas, Libro Diario (asientos de ventas) o los dos.
  const kv = (v: Venta) => v.td + v.clave;
  let ventas: Venta[] = registro;
  if (diario.length && !registro.length) {
    ventas = diario;
    avisos.push(`La contabilidad se tomó del Libro Diario (${diario.length} asientos de ventas). El Diario no trae el nombre del cliente: las transferencias del mismo monto y día se concilian en conjunto, sin confirmar cuál abono es de cuál comprobante. Para afinarlo, sube también el Registro de Ventas en la casilla de Contabilidad.`);
  } else if (diario.length) {
    // Los dos: manda el Registro (trae el nombre) y el Diario sirve de control cruzado.
    const enDiario = new Map(diario.map((v) => [kv(v), v])), enRegistro = new Set(registro.map(kv));
    for (const v of registro) { const d = enDiario.get(kv(v)); if (d) { v.glosa = d.glosa; v.asiento = d.asiento; } }
    const soloDiario = diario.filter((v) => !enRegistro.has(kv(v))), soloRegistro = registro.filter((v) => !enDiario.has(kv(v)));
    const distinto = registro.filter((v) => { const d = enDiario.get(kv(v)); return d && Math.abs(d.total - v.total) >= 0.01; });
    const lista = (vs: Venta[]) => `${vs.slice(0, 8).map((v) => v.doc).join(", ")}${vs.length > 8 ? "…" : ""}`;
    if (soloDiario.length) avisos.push(`${soloDiario.length} comprobante(s) tienen asiento en el Libro Diario y no están en el Registro de Ventas: ${lista(soloDiario)}. Se incluyeron en la conciliación.`);
    if (soloRegistro.length) avisos.push(`${soloRegistro.length} comprobante(s) del Registro de Ventas no tienen asiento en el Libro Diario: ${lista(soloRegistro)}.`);
    if (distinto.length) avisos.push(`${distinto.length} comprobante(s) tienen distinto importe en el Libro Diario y en el Registro de Ventas: ${lista(distinto)}. Se usó el del Registro.`);
    if (!soloDiario.length && !soloRegistro.length && !distinto.length) avisos.push(`Control: el Libro Diario y el Registro de Ventas coinciden (${registro.length} comprobantes, mismo importe).`);
    ventas = [...registro, ...soloDiario];
  }
  if (otrosDiario && diario.length) avisos.push(`El Libro Diario trae ${otrosDiario} asiento(s) que no son de ventas (otros subdiarios): no se usaron.`);
  const falta: string[] = [];
  if (!ventas.length) falta.push("la Contabilidad (Registro de Ventas o Libro Diario)");
  if (!cobrosFin.length) falta.push("la Caja virtual (los ZIP por sede o las tramas de cobranza)");
  if (!movs.length) falta.push("los Bancos (extractos en Excel, PDF o Word)");
  if (falta.length) throw new Error(`Falta ${falta.join(" y ")}. Revisa que cada archivo sea el correcto.`);
  // Extractos sin año en la fecha ("02-10"): se toma el del periodo de las ventas.
  const sinAnio = movs.filter((m) => m.fecha.startsWith("0000-"));
  if (sinAnio.length && ventas.some((v) => v.fecha)) {
    const fs = ventas.map((v) => v.fecha).filter(Boolean).sort(), ref = fs[Math.floor(fs.length / 2)] ?? "";
    const anio = Number(ref.slice(0, 4)), mes = Number(ref.slice(5, 7));
    for (const m of sinAnio) { const mm = Number(m.fecha.slice(5, 7)); m.fecha = `${mes >= 11 && mm <= 2 ? anio + 1 : mes <= 2 && mm >= 11 ? anio - 1 : anio}${m.fecha.slice(4)}`; }
    avisos.push(`${sinAnio.length} movimiento(s) del banco venían sin año en la fecha: se les puso el año del periodo de las ventas (${anio}).`);
  }
  // Comprobantes repetidos en el registro (dos hojas con lo mismo): se deja uno.
  const vistos = new Set<string>(); const unicas = ventas.filter((v) => (vistos.has(v.td + v.clave) ? false : (vistos.add(v.td + v.clave), true)));
  if (unicas.length < ventas.length) avisos.push(`${ventas.length - unicas.length} comprobante(s) repetidos en la contabilidad: se contó cada uno una sola vez.`);
  // Series de la contabilidad que no aparecen en la caja virtual subida (¿falta el ZIP de una sede?).
  const seriesCaja = new Set(cobrosFin.flatMap((c) => [...c.docs.map((d) => d.clave), c.ncClave ?? ""]).filter(Boolean).map((k) => k.split("-")[0]));
  const sinSerie = new Map<string, number>();
  for (const v of unicas) { const se = v.clave.split("-")[0]; if (!seriesCaja.has(se)) sinSerie.set(se, (sinSerie.get(se) ?? 0) + 1); }
  if (sinSerie.size && seriesCaja.size) {
    const n = Array.from(sinSerie.values()).reduce((a, b) => a + b, 0);
    avisos.push(`${n} comprobante(s) de la contabilidad son de series que no están en la caja virtual subida (${Array.from(sinSerie.entries()).sort().map(([k, c]) => `${k}: ${c}`).join(" · ")}): salen como "Sin cobro en la caja virtual". Si son de otra sede, falta subir su ZIP.`);
  }
  return conciliarTresVias(unicas, cobrosFin, movs, { empresa, ruc, notasSinCobro: extra.notasSinCobro }, avisos);
}

// ---------------------------------------------------------------- Excel
const AZUL = "FF102B4D", ROJO = "FFFDE2E2", GRIS = "FFF1F5F9";
function hoja(wb: ExcelJS.Workbook, nombre: string, cols: { t: string; w: number; n?: boolean }[], filas: (string | number | null)[][], colEstado = -1) {
  const ws = wb.addWorksheet(nombre, { views: [{ state: "frozen", ySplit: 1 }] });
  ws.addRow(cols.map((c) => c.t));
  ws.getRow(1).eachCell((c) => { c.font = { bold: true, color: { argb: "FFFFFFFF" } }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AZUL } }; c.alignment = { vertical: "middle", wrapText: true }; });
  for (const f of filas) {
    const row = ws.addRow(f);
    const e = colEstado >= 0 ? String(f[colEstado] ?? "") : "";
    const color = e === "No conciliado" ? ROJO : e === "Cargo" || e === "No aplica" ? GRIS : null;
    if (color) row.eachCell({ includeEmpty: true }, (c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } }; });
  }
  cols.forEach((c, i) => { const col = ws.getColumn(i + 1); col.width = c.w; if (c.n) col.numFmt = "#,##0.00"; });
  if (filas.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
  return ws;
}
const fch = (iso: string) => (iso ? iso.split("-").reverse().join("/") : "");

/** HOJA ÚNICA: tres bloques (Contabilidad · Caja virtual · Bancos) en la misma fila; las columnas en
 *  dorado son el PUNTO EN COMÚN con que se concilia cada salto. */
function hojaUnica(wb: ExcelJS.Workbook, filas: FilaUnica[]) {
  const ws = wb.addWorksheet("Conciliación", { views: [{ state: "frozen", ySplit: 2, xSplit: 2 }] });
  const DORADO = "FFFDE68A", ORO_T = "FF7C2D12";
  // c = columna que es punto en común
  const cols: { t: string; w: number; n?: boolean; c?: boolean }[] = [
    { t: "Fecha", w: 11 }, { t: "Comprobante ★", w: 16, c: true }, { t: "Tipo", w: 13 }, { t: "Cliente", w: 32 }, { t: "Total", w: 11, n: true },
    { t: "Comprobante ★", w: 16, c: true }, { t: "N° cobro", w: 10 }, { t: "Fecha cobro ◆", w: 12, c: true }, { t: "Medio · sede", w: 26 }, { t: "Importe cobrado", w: 13, n: true }, { t: "Total del cobro ◆", w: 14, n: true, c: true }, { t: "N° operación ◆", w: 15, c: true },
    { t: "Cuenta", w: 15 }, { t: "Fecha ◆", w: 11, c: true }, { t: "Concepto", w: 34 }, { t: "N° operación ◆", w: 15, c: true }, { t: "Importe ◆", w: 13, n: true, c: true },
    { t: "Estado", w: 15 }, { t: "Punto en común: contabilidad ↔ caja", w: 28 }, { t: "Punto en común: caja ↔ banco", w: 46 }, { t: "Observación", w: 60 },
  ];
  const grupos: [string, number, number, string][] = [["CONTABILIDAD (Registro de Ventas)", 1, 5, "FF102B4D"], ["CAJA VIRTUAL (cobranza)", 6, 12, "FF1E5A8A"], ["BANCOS (extracto)", 13, 17, "FF0F766E"], ["RESULTADO  ·  ★ = punto en común contabilidad ↔ caja   ◆ = punto en común caja ↔ banco", 18, 21, "FF475569"]];
  const r1 = ws.addRow(cols.map(() => ""));
  for (const [t, a, b, color] of grupos) {
    ws.mergeCells(1, a, 1, b); const c = r1.getCell(a); c.value = t;
    c.font = { bold: true, color: { argb: "FFFFFFFF" } }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } }; c.alignment = { horizontal: "center", vertical: "middle" };
  }
  r1.height = 20;
  const r2h = ws.addRow(cols.map((c) => c.t));
  r2h.eachCell((cell, n) => {
    const col = cols[n - 1], grupo = grupos.find((g) => n >= g[1] && n <= g[2])!;
    cell.font = { bold: true, color: { argb: col.c ? ORO_T : "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: col.c ? DORADO : grupo[3] } };
    cell.alignment = { vertical: "middle", wrapText: true };
  });
  r2h.height = 30;
  for (const f of filas) {
    const row = ws.addRow([fch(f.cFecha), f.cDoc, f.cTipo, f.cCliente, f.cTotal, f.vDoc, f.vCobro, fch(f.vFecha), f.vMedio, f.vImporte, f.vTotalCobro, f.vOp, f.bBanco, fch(f.bFecha), f.bDesc, f.bOp, f.bImporte, f.estado, f.punto1, f.punto2, f.obs]);
    const color = f.estado === "No conciliado" ? ROJO : f.estado === "Cargo" ? GRIS : null;
    if (color) row.eachCell({ includeEmpty: true }, (c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } }; });
    else cols.forEach((c, i) => { if (c.c) row.getCell(i + 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFBEB" } }; });
  }
  cols.forEach((c, i) => { const col = ws.getColumn(i + 1); col.width = c.w; if (c.n) col.numFmt = "#,##0.00"; });
  ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: cols.length } };
}

export async function excelConciliacionTresVias(r: ResultadoConciliacion): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  hojaUnica(wb, r.unificada);
  // ---- Una hoja por cuenta: el extracto con la columna CONCILIACIÓN (como la arma contabilidad a mano)
  const usados = new Set<string>(["conciliación", "resumen", "por fecha"]);
  for (const b of r.resumen.bancos) {
    let nombre = `Banco ${b.banco}`.replace(/[\\/*?:[\]]/g, " ").slice(0, 31).trim();
    for (let i = 2; usados.has(nombre.toLowerCase()); i++) nombre = `${nombre.slice(0, 28)} ${i}`;
    usados.add(nombre.toLowerCase());
    const fs = r.bancos.filter((f) => f.banco === b.banco);
    const wsB = hoja(wb, nombre, [{ t: "FECHA", w: 11 }, { t: "DESCRIPCIÓN", w: 40 }, { t: "N° OPER.", w: 14 }, { t: "IMPORTE", w: 12, n: true }, { t: "CONCILIACIÓN", w: 52 }, { t: "Comprobantes que cancela", w: 44 }, { t: "Estado", w: 15 }, { t: "Observación", w: 70 }],
      fs.map((f) => [fch(f.fecha), f.desc, f.op, f.abono > 0 ? f.abono : -f.cargo, f.conciliacion, f.estado === "Conciliado" ? f.detalle : "", f.estado, f.obs]), 6);
    wsB.getColumn(5).font = { bold: true };
    wsB.getRow(1).getCell(5).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F766E" } };
    const tb = wsB.addRow(["", "TOTAL ABONOS", "", b.importeAbonos, `${b.conciliados} de ${b.abonos} abonos con su conciliación`]); tb.font = { bold: true };
    wsB.addRow(["", "TOTAL CARGOS", "", -b.importeCargos, "Los cargos sin texto los completa contabilidad"]).font = { bold: true };
  }
  // ---- Resumen
  const ws = wb.addWorksheet("Resumen");
  const s = r.resumen;
  const tit = (t: string) => { const row = ws.addRow([t]); row.font = { bold: true, color: { argb: "FFFFFFFF" } }; row.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: AZUL } }; ws.mergeCells(row.number, 1, row.number, 4); };
  const lin = (a: string, n: number | string, imp?: number) => { const row = ws.addRow([a, n, imp ?? ""]); if (imp !== undefined) row.getCell(3).numFmt = "#,##0.00"; return row; };
  ws.addRow([`Conciliación bancaria — ${s.empresa}`]).font = { bold: true, size: 14 };
  ws.addRow([`RUC ${s.ruc} · Periodo ${s.periodo}`]); ws.addRow([]);
  tit("1. COMPROBANTES DE VENTA (Contabilidad)"); ws.addRow(["", "Cantidad", "Importe S/"]).font = { bold: true };
  lin("Total del registro", s.ventas.total, s.ventas.importe); lin("Conciliados (cobrados y depositados)", s.ventas.conciliados, s.ventas.importeConciliado);
  const rn = lin("NO CONCILIADOS", s.ventas.noConciliados, s.ventas.importeNoConciliado); rn.font = { bold: true, color: { argb: "FFB91C1C" } };
  for (const [k, v] of Object.entries(s.ventas.porMotivo)) lin(`   · ${k}`, v.n, v.importe);
  ws.addRow([]); tit("2. COBROS DE LA CAJA VIRTUAL vs BANCOS"); ws.addRow(["", "Cantidad", "Importe S/"]).font = { bold: true };
  lin("Cobros que deben estar en el banco", s.cobros.total, s.cobros.importe); lin("Conciliados con el banco", s.cobros.conciliados, s.cobros.importeConciliado);
  lin("NO CONCILIADOS (sin depósito / abono)", s.cobros.noConciliados, s.cobros.importeNoConciliado).font = { bold: true, color: { argb: "FFB91C1C" } };
  ws.addRow(["   Cómo se vinculó cada cobro conciliado:"]).font = { italic: true };
  for (const [k, n] of Object.entries(s.cobros.porCriterio)) lin(`   · ${k}`, n);
  ws.addRow([]); tit("3. BANCOS"); ws.addRow(["Cuenta", "Abonos", "Importe S/", "Conciliados", "Importe S/", "NO conciliados", "Importe S/", "Cargos", "Importe S/"]).font = { bold: true };
  for (const b of s.bancos) { const row = ws.addRow([b.banco, b.abonos, b.importeAbonos, b.conciliados, b.importeConciliado, b.noConciliados, b.importeNoConciliado, b.cargos, b.importeCargos]); [3, 5, 7, 9].forEach((c) => (row.getCell(c).numFmt = "#,##0.00")); }
  if (r.avisos.length) { ws.addRow([]); tit("AVISOS"); for (const a of r.avisos) ws.addRow([a]); }
  ws.getColumn(1).width = 58; [2, 3, 4, 5, 6, 7, 8, 9].forEach((c) => (ws.getColumn(c).width = 16));

  // ---- Por fecha
  const tot = (k: keyof FilaFecha) => r2(r.porFecha.reduce((a, f) => a + (Number(f[k]) || 0), 0));
  const wsF = hoja(wb, "Por fecha", [{ t: "Fecha", w: 11 }, { t: "Comprobantes", w: 12 }, { t: "Ventas (contabilidad)", w: 15, n: true }, { t: "Notas de crédito", w: 13, n: true },
    { t: "Caja: efectivo", w: 14, n: true }, { t: "Caja: transferencias", w: 15, n: true }, { t: "Caja: total cobrado", w: 15, n: true }, { t: "Dif. ventas − caja", w: 14, n: true },
    { t: "De la caja del día: ya en banco", w: 17, n: true }, { t: "De la caja del día: sin banco", w: 17, n: true }, { t: "El banco lo recibió desde", w: 14 }, { t: "hasta", w: 11 },
    { t: "Abonos que entraron al banco ese día", w: 18, n: true }, { t: "Estado", w: 15 }, { t: "Observación", w: 70 }],
    r.porFecha.map((f) => [fch(f.fecha), f.comprobantes || null, f.ventas || null, f.notasCredito || null, f.cajaEfectivo || null, f.cajaTransferencias || null, f.cajaTotal || null, f.difVentasCaja || null, f.depositado || null, f.sinDepositar || null, fch(f.depositoDesde), fch(f.depositoHasta), f.abonosBanco || null, f.cajaTotal || f.ventas ? f.estado : "", f.nota]), 13);
  const rt = wsF.addRow(["TOTAL", tot("comprobantes"), tot("ventas"), tot("notasCredito"), tot("cajaEfectivo"), tot("cajaTransferencias"), tot("cajaTotal"), tot("difVentasCaja"), tot("depositado"), tot("sinDepositar"), "", "", tot("abonosBanco"), "", ""]);
  rt.font = { bold: true };

  return Buffer.from(await wb.xlsx.writeBuffer());
}
