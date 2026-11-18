// ============================================================
//  Conciliación bancaria de 3 vías: Contabilidad ↔ Caja virtual ↔ Bancos
// ============================================================
// Tres documentos (Excel):
//   1) CONTABILIDAD  = Registro de Ventas (StarSoft): un comprobante por fila.
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
export interface Venta { td: string; clave: string; doc: string; fecha: string; ruc: string; nombre: string; total: number; ref: string }
export interface DocCobro { clave: string; doc: string; td: string; importe: number }
export interface Cobro {
  id: string; fecha: string; tipo: "efectivo" | "transferencia" | "nc";
  medio: string; sede: string; op: string; importe: number; glosa: string; docs: DocCobro[];
  /** NC que se aplica (solo tipo "nc"). */
  ncClave?: string;
}
export interface MovBanco { id: number; banco: string; fecha: string; desc: string; op: string; abono: number; cargo: number }

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
export interface FilaBanco { banco: string; fecha: string; desc: string; op: string; abono: number; cargo: number; estado: Estado | "Cargo"; cobro: string; detalle: string }
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
const num = (v: unknown) => { if (typeof v === "number") return v; const n = Number(String(v ?? "").replace(/[^\d.,-]/g, "").replace(/,(?=\d{3}\b)/g, "").replace(",", ".")); return Number.isFinite(n) ? n : 0; };
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
const docVisible = (clave: string) => { const [s, n] = clave.split("-"); return n ? `${s}-${n.padStart(7, "0")}` : clave; };
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

export type TipoHoja = "ventas" | "caja" | "banco" | "desconocida";
/** Reconoce qué es cada hoja por sus encabezados (no importa en qué casilla se subió). */
export function tipoDeHoja(h: Hoja): { tipo: TipoHoja; fila: number } {
  for (let i = 0; i < Math.min(h.rows.length, 15); i++) {
    const c = h.rows[i].map(H);
    if (c.includes("cta contable") && c.includes("debe/haber")) return { tipo: "caja", fila: i };
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

export function parseBanco(h: Hoja, fila: number, nombre: string, idBase: number): MovBanco[] {
  const c = h.rows[fila].map(H);
  const col = (f: (x: string, i: number) => boolean) => c.findIndex(f);
  const iF = col((x) => /^f\.? ?operaci|^fecha/.test(x));
  const iD = col((x) => /concepto|referencia|descrip|glosa|detalle/.test(x));
  const iOp = col((x, i) => i !== iF && i !== iD && /n[º°o]?\.? ?doc|operacion|n[º°] ?oper|nro|numero/.test(x));
  const iCar = col((x) => /cargo|debito|egreso|retiro/.test(x)), iAbo = col((x) => /abono|credito|ingreso|deposito/.test(x));
  const iImp = col((x) => /^importe|^monto/.test(x));
  const movs: MovBanco[] = [];
  for (const row of h.rows.slice(fila + 1)) {
    const fecha = aIso(row[iF]); if (!fecha) continue;
    let abono = 0, cargo = 0;
    if (iCar >= 0 && iAbo >= 0) { cargo = Math.abs(num(row[iCar])); abono = Math.abs(num(row[iAbo])); }
    else if (iImp >= 0) {
      // Un solo Importe con signo; algunos bancos ponen el cargo (negativo) en la columna vecina sin título.
      let v = num(row[iImp]);
      if (!v && !c[iImp + 1]) v = num(row[iImp + 1]);
      if (v >= 0) abono = v; else cargo = -v;
    }
    if (!abono && !cargo) continue;
    movs.push({ id: idBase + movs.length, banco: nombre, fecha, desc: iD >= 0 ? txt(row[iD]) : "", op: iOp >= 0 ? txt(row[iOp]) : "", abono: r2(abono), cargo: r2(cargo) });
  }
  return movs;
}

// ---------------------------------------------------------------- conciliación
interface Enlace { movs: MovBanco[]; criterio: string }

export function conciliarTresVias(ventas: Venta[], cobros: Cobro[], movs: MovBanco[], meta: { empresa: string; ruc: string }, avisos: string[] = []): ResultadoConciliacion {
  const ventaDe = new Map(ventas.map((v) => [v.clave, v]));
  const libres = new Map(movs.filter((m) => m.abono > 0).map((m) => [m.id, m]));
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

  // (A) Transferencias por N° de operación (si el banco lo trae).
  for (const c of transf) {
    const op = soloDigitos(c.op); if (op.length < 5) continue;
    const m = disponibles().find((x) => igual(x.abono, c.importe) && (soloDigitos(x.op) === op || x.desc.replace(/\D/g, "").includes(op)));
    if (m) tomar(c, [m], "N° de operación");
  }
  // (A2) Transferencias por NOMBRE: el concepto del banco trae al cliente (2 o más palabras) con el
  // mismo monto, aunque el abono sea de un día cercano. Va antes que "fecha y monto" porque es más seguro.
  for (const c of transf.filter((x) => !enlace.has(x.id))) {
    const m = disponibles().filter((x) => igual(x.abono, c.importe) && Math.abs(dias(c.fecha, x.fecha)) <= 3 && puntosNombre(c, x) >= 2)
      .sort((a, b) => puntosNombre(c, b) - puntosNombre(c, a) || Math.abs(dias(c.fecha, a.fecha)) - Math.abs(dias(c.fecha, b.fecha)))[0];
    if (m) tomar(c, [m], m.fecha === c.fecha ? "Fecha, monto y nombre del cliente" : "Monto y nombre del cliente");
  }
  // (A3) Una sola palabra del nombre (p. ej. el apellido) también vale si no hay duda: ese abono es el
  // único con su nombre para ese cobro, y ese cobro el único pendiente que calza con ese abono.
  for (const c of transf.filter((x) => !enlace.has(x.id))) {
    const calza = (x: Cobro, m: MovBanco) => igual(m.abono, x.importe) && Math.abs(dias(x.fecha, m.fecha)) <= 3 && puntosNombre(x, m) >= 1;
    const ms = disponibles().filter((m) => calza(c, m));
    if (ms.length !== 1) continue;
    if (transf.filter((x) => !enlace.has(x.id) && calza(x, ms[0])).length !== 1) continue;
    tomar(c, [ms[0]], ms[0].fecha === c.fecha ? "Fecha, monto y nombre del cliente" : "Monto y nombre del cliente");
  }
  // (B) Efectivo: el total del día por sede = un depósito por el mismo monto en los 7 días siguientes.
  for (const c of efectivo) {
    const m = disponibles().filter((x) => igual(x.abono, c.importe) && dias(c.fecha, x.fecha) >= 0 && dias(c.fecha, x.fecha) <= 7).sort((a, b) => a.fecha.localeCompare(b.fecha))[0];
    if (m) tomar(c, [m], "Monto exacto del depósito");
  }
  // (C) Transferencias del mismo día y monto; si hay varias iguales, por el nombre del cliente.
  const pend = () => transf.filter((c) => !enlace.has(c.id));
  const grupos = new Map<string, Cobro[]>();
  for (const c of pend()) { const k = `${c.fecha}|${c.importe.toFixed(2)}`; if (!grupos.has(k)) grupos.set(k, []); grupos.get(k)!.push(c); }
  for (const [k, cs] of Array.from(grupos.entries())) {
    const [fecha, imp] = k.split("|");
    let ms = disponibles().filter((m) => m.fecha === fecha && igual(m.abono, Number(imp)));
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
    const m = disponibles().filter((x) => igual(x.abono, c.importe) && Math.abs(dias(c.fecha, x.fecha)) <= 3).sort((a, b) => Math.abs(dias(c.fecha, a.fecha)) - Math.abs(dias(c.fecha, b.fecha)))[0];
    if (m) tomar(c, [m], "Monto exacto, fecha cercana");
  }
  // (D2) Transferencias cuyo abono llegó bastante después (p. ej. pagos de entidades por otro
  // banco): solo si ese monto es ÚNICO entre lo pendiente de ambos lados (sin riesgo de cruce).
  for (const c of pend()) {
    const iguales = pend().filter((x) => igual(x.importe, c.importe));
    const ms = disponibles().filter((x) => igual(x.abono, c.importe) && dias(c.fecha, x.fecha) >= 0);
    if (iguales.length === 1 && ms.length === 1) tomar(c, [ms[0]], "Monto exacto único, abono posterior");
  }
  // (E) Efectivo depositado en DOS partes dentro de los 7 días siguientes.
  for (const c of efectivo.filter((x) => !enlace.has(x.id))) {
    const cand = disponibles().filter((x) => dias(c.fecha, x.fecha) >= 0 && dias(c.fecha, x.fecha) <= 7 && x.abono < c.importe).sort((a, b) => a.fecha.localeCompare(b.fecha));
    let par: MovBanco[] | null = null;
    for (let i = 0; i < cand.length && !par; i++) for (let j = i + 1; j < cand.length; j++) if (igual(cand[i].abono + cand[j].abono, c.importe)) { par = [cand[i], cand[j]]; break; }
    if (par) tomar(c, par, "Suma de dos depósitos");
  }
  // (F) Efectivo con el mismo monto depositado más adelante (más de 7 días).
  for (const c of efectivo.filter((x) => !enlace.has(x.id))) {
    const m = disponibles().filter((x) => igual(x.abono, c.importe) && dias(c.fecha, x.fecha) > 7).sort((a, b) => a.fecha.localeCompare(b.fecha))[0];
    if (m) tomar(c, [m], "Monto exacto, depósito tardío");
  }

  // Pistas para lo que quedó suelto: un efectivo sin depósito EXACTO pero con un abono libre de monto
  // parecido en los días siguientes (p. ej. depositaron S/ 1,000 de un cobro de S/ 1,030). No se da
  // por conciliado: se muestra como posible, con la diferencia.
  const pistaCobro = new Map<string, string>(), pistaMov = new Map<number, string>();
  const dmy = (f: string) => f.split("-").reverse().join("/");
  for (const c of efectivo.filter((x) => !enlace.has(x.id))) {
    const tol = Math.max(50, c.importe * 0.03);
    const m = disponibles().filter((x) => !pistaMov.has(x.id) && dias(c.fecha, x.fecha) >= 0 && dias(c.fecha, x.fecha) <= 7 && Math.abs(x.abono - c.importe) <= tol)
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

  // ---- filas: cobros vs banco
  const filaCobros: FilaCobro[] = cobros.slice().sort(ordenCobro).map((c) => {
    const e = enlace.get(c.id); const m0 = e?.movs[0];
    return {
      cobro: c.id, fecha: c.fecha, medio: c.medio, sede: c.sede, op: c.op, importe: c.importe, comprobantes: c.docs.length,
      banco: e ? Array.from(new Set(e.movs.map((m) => m.banco))).join(" + ") : "", bancoFecha: m0?.fecha ?? "", bancoDesc: e ? e.movs.map((m) => m.desc).join(" + ") : "",
      bancoOp: e ? e.movs.map((m) => m.op).filter(Boolean).join(" + ") : "", bancoImporte: e ? r2(e.movs.reduce((a, m) => a + m.abono, 0)) : 0,
      dias: m0 ? dias(c.fecha, e!.movs[e!.movs.length - 1].fecha) : null,
      estado: c.tipo === "nc" ? "No aplica" : e ? "Conciliado" : "No conciliado",
      criterio: c.tipo === "nc" ? "Aplicación de nota de crédito (no pasa por el banco)" : e?.criterio ?? pistaCobro.get(c.id) ?? (esFinDeMes(c.fecha) ? `Sin movimiento en el banco (${NOTA_FIN})` : "Sin movimiento en el banco"),
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
      return { ...base, estado: "No conciliado", motivo: `Sin cobro en la caja virtual${nc ? ` (tiene nota de crédito ${nc.doc})` : ""}` } as FilaComprobante;
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
      const base = (sb.c.tipo === "efectivo" ? "Cobrado en efectivo, sin depósito en el banco" : "Cobrado por transferencia, sin abono en el banco") + (cs.length > 1 ? ` (cobro ${sb.c.id} por ${sb.d.importe.toFixed(2)})` : "");
      return { ...lleno, criterio: pistaCobro.get(sb.c.id) ?? "", estado: "No conciliado", motivo: esFinDeMes(sb.c.fecha) ? `${base} (${NOTA_FIN})` : base } as FilaComprobante;
    }
    return { ...lleno, estado: "Conciliado", motivo: "" } as FilaComprobante;
  });
  // Cobros de comprobantes que no están en el registro de ventas.
  const fuera = Array.from(cobrosDe.keys()).filter((k) => !ventaDe.has(k));
  if (fuera.length) avisos.push(`${fuera.length} comprobante(s) cobrados en la caja virtual no están en el Registro de Ventas: ${fuera.slice(0, 8).map(docVisible).join(", ")}${fuera.length > 8 ? "…" : ""}`);

  // ---- filas: bancos
  const usoDe = new Map<number, Cobro>();
  for (const [id, e] of Array.from(enlace.entries())) for (const m of e.movs) usoDe.set(m.id, cobros.find((c) => c.id === id)!);
  const bancos: FilaBanco[] = movs.slice().sort((a, b) => a.banco.localeCompare(b.banco) || a.fecha.localeCompare(b.fecha) || a.id - b.id).map((m) => {
    const c = usoDe.get(m.id);
    return {
      banco: m.banco, fecha: m.fecha, desc: m.desc, op: m.op, abono: m.abono, cargo: m.cargo,
      estado: m.cargo > 0 && !m.abono ? "Cargo" : c ? "Conciliado" : "No conciliado",
      cobro: c?.id ?? "", detalle: !c ? pistaMov.get(m.id) ?? (m.abono > 0 && esInicioDeMes(m.fecha) ? `Sin cobro en la caja de este periodo (${NOTA_INICIO})` : m.abono > 0 ? "Sin cobro en la caja virtual" : "") : (c.tipo === "efectivo" ? `Efectivo del ${c.fecha.split("-").reverse().join("/")} ${c.sede} (${c.docs.length} comprobantes)` : `${c.docs.map((d) => d.doc).join(", ")}`),
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
    if (e.criterio === "N° de operación") return `N° de operación ${soloDigitos(c.op)}`;
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
    f.estado = fc.estado; f.obs = fc.motivo || (fc.estado === "No conciliado" ? fc.criterio : "");
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
        if (!f.obs && fc.estado === "No conciliado") f.obs = pistaCobro.get(pr.c.id) ?? "";
        else if (fc.estado === "No conciliado" && pistaCobro.has(pr.c.id) && !f.obs.includes("Posible")) f.obs = `${f.obs}. ${pistaCobro.get(pr.c.id)}`;
      }
    }
    unificada.push(f);
  });
  // Cobrado en la caja pero el comprobante no está en el Registro de Ventas.
  for (const k of fuera) for (const x of cobrosDe.get(k) ?? []) {
    const f = vacia(); conCaja(f, x.c, x.d.doc, x.d.importe); conBanco(f, x.c); f.punto2 = punto2De(x.c);
    f.obs = "Cobrado en la caja virtual: el comprobante no está en el Registro de Ventas"; unificada.push(f);
  }
  // Lo que hay en el banco y no corresponde a ningún cobro (y, al final, los cargos).
  for (const b of bancos.filter((x) => x.estado === "No conciliado")) { const f = vacia(); f.bBanco = b.banco; f.bFecha = b.fecha; f.bDesc = b.desc; f.bOp = b.op; f.bImporte = b.abono; f.obs = b.detalle || "Abono del banco sin cobro en la caja virtual"; unificada.push(f); }
  for (const b of bancos.filter((x) => x.estado === "Cargo")) { const f = vacia(); f.bBanco = b.banco; f.bFecha = b.fecha; f.bDesc = b.desc; f.bOp = b.op; f.bImporte = -b.cargo; f.estado = "Cargo"; f.obs = "Cargo del banco (no es cobranza)"; unificada.push(f); }

  // ---- resumen
  const sum = (xs: { v: number }[]) => r2(xs.reduce((a, x) => a + x.v, 0));
  const noConc = comprobantes.filter((f) => f.estado === "No conciliado");
  const porMotivo: Record<string, { n: number; importe: number }> = {};
  for (const f of noConc) { const k = f.motivo.replace(/ \(cobro [\w-]+ por [\d.]+\)/, "").replace(/ \(tiene nota.*$/, "").replace(/ \(fin de mes.*$/, " — fin de mes (puede estar depositado el mes siguiente)").replace(/:.*$/, ""); const o = (porMotivo[k] = porMotivo[k] ?? { n: 0, importe: 0 }); o.n++; o.importe = r2(o.importe + f.total); }
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
export async function conciliarArchivos(archivos: { nombre: string; buf: Buffer }[]): Promise<ResultadoConciliacion> {
  const avisos: string[] = [];
  let empresa = "", ruc = "";
  const ventas: Venta[] = [], cobros: Cobro[] = [], movs: MovBanco[] = [];
  const nBancos: string[] = [];
  for (const a of archivos) {
    let hojas: Hoja[];
    try { hojas = await leerHojas(a.buf, a.nombre); } catch { throw new Error(`No se pudo leer "${a.nombre}". Debe ser un Excel (.xlsx).`); }
    const unaSola = hojas.length === 1;
    for (const h of hojas) {
      const t = tipoDeHoja(h);
      if (t.tipo === "ventas") { const p = parseVentas(h, t.fila); if (!empresa) empresa = p.empresa; if (!ruc) ruc = p.ruc; ventas.push(...p.ventas); }
      else if (t.tipo === "caja") cobros.push(...parseCaja(h, t.fila));
      else if (t.tipo === "banco") { const nombre = (unaSola ? a.nombre.replace(/\.xlsx?$/i, "") : h.hoja).trim(); nBancos.push(nombre); movs.push(...parseBanco(h, t.fila, nombre, movs.length)); }
      else if (h.rows.length > 3) avisos.push(`No se reconoció la hoja "${h.hoja}" de "${a.nombre}" (no parece Registro de Ventas, caja virtual ni banco): se omitió.`);
    }
  }
  const falta: string[] = [];
  if (!ventas.length) falta.push("la Contabilidad (Registro de Ventas)");
  if (!cobros.length) falta.push("la Caja virtual (tramas de cobranza)");
  if (!movs.length) falta.push("los Bancos (extractos)");
  if (falta.length) throw new Error(`Falta ${falta.join(" y ")}. Revisa que cada archivo sea el Excel correcto.`);
  // Comprobantes repetidos en el registro (dos hojas con lo mismo): se deja uno.
  const vistos = new Set<string>(); const unicas = ventas.filter((v) => (vistos.has(v.td + v.clave) ? false : (vistos.add(v.td + v.clave), true)));
  if (unicas.length < ventas.length) avisos.push(`${ventas.length - unicas.length} comprobante(s) repetidos en el Registro de Ventas: se contó cada uno una sola vez.`);
  return conciliarTresVias(unicas, cobros, movs, { empresa, ruc }, avisos);
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
