// ============================================================
//  Conciliación LIBRO DE VENTAS vs CAJA VIRTUAL
// ============================================================
// - Libro de Ventas (Registro de Ventas por mes): Fecha, [T/D], Documento
//   (serie-número), RUC, Nombre, Total. Puede subirse 1 archivo por mes.
// - Caja Virtual (Reporte de ingreso comprobante detalle): Fecha Pago, Tipo
//   Comprobante, Comprobante (serie-número, con pagos parciales "-N"), Total,
//   Contratante, Tipo Pago, Banco.
// Cruce por COMPROBANTE (serie-número). Un comprobante de ventas puede tener
// varios pagos en caja (se suman). Resultado: conciliado, ventas sin pago en caja
// ("faltan") y comprobantes de caja sin venta en el libro.

import * as XLSX from "xlsx";
import ExcelJS from "exceljs";

const num = (s: any): number => {
  const n = Number(String(s ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

function leerHoja(buf: Buffer, hoja?: string): string[][] {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  const sn = hoja && wb.Sheets[hoja] ? hoja : wb.SheetNames[0];
  return XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: "", raw: false }) as string[][];
}
function idxDe(H: string[], ...nombres: string[]): number {
  const norm = (s: string) => String(s || "").toUpperCase().replace(/[.\s]+/g, " ").trim();
  const NH = H.map(norm);
  for (const n of nombres) { const i = NH.indexOf(norm(n)); if (i >= 0) return i; }
  for (const n of nombres) { const i = NH.findIndex((h) => h.includes(norm(n))); if (i >= 0) return i; }
  return -1;
}

/** Clave de comprobante: SERIE-NUMERO (sin ceros a la izquierda, sin sufijo de
 *  pago parcial). "F001 0234862" y "F001-0234862-1" → "F001-234862". */
export function compKey(doc: any): string {
  const p = String(doc ?? "").toUpperCase().trim().split(/[\s\-/]+/).filter(Boolean);
  if (p.length < 2) return "";
  const serie = p[0];
  const numRaw = (p[1] || "").replace(/\D/g, "");
  if (!serie || !numRaw) return "";
  return `${serie}-${numRaw.replace(/^0+(?=\d)/, "")}`;
}
const compBonito = (doc: any): string => String(doc ?? "").replace(/\s+/g, " ").trim();

const MESES: Record<string, string> = {
  ENERO: "01", FEBRERO: "02", MARZO: "03", ABRIL: "04", MAYO: "05", JUNIO: "06",
  JULIO: "07", AGOSTO: "08", SETIEMBRE: "09", SEPTIEMBRE: "09", OCTUBRE: "10", NOVIEMBRE: "11", DICIEMBRE: "12",
};
/** Detecta el periodo "YYYY-MM" del título del libro ("...Mes de ABRIL del 2026"). */
function periodoDeTitulo(filas: string[][]): string {
  const txt = filas.slice(0, 6).map((f) => f.join(" ")).join(" ").toUpperCase();
  const m = /MES DE\s+([A-ZÁÉ]+)\s+DEL?\s+(\d{4})/.exec(txt);
  if (m && MESES[m[1]]) return `${m[2]}-${MESES[m[1]]}`;
  return "";
}
/** Formato de una columna de fechas: d/m/y o m/d/y (heurística por >12). */
function detectarFmt(vals: any[]): "dmy" | "mdy" {
  for (const v of vals) {
    const m = /^(\d{1,2})[/\-](\d{1,2})[/\-]\d{2,4}$/.exec(String(v ?? "").trim());
    if (!m) continue;
    if (Number(m[1]) > 12) return "dmy";
    if (Number(m[2]) > 12) return "mdy";
  }
  return "dmy";
}
/** "YYYY-MM" de una fecha con formato conocido. */
function ymDe(v: any, fmt: "dmy" | "mdy"): string {
  const m = /^(\d{1,2})[/\-](\d{1,2})[/\-](\d{2,4})$/.exec(String(v ?? "").trim());
  if (!m) return "";
  const mo = fmt === "mdy" ? m[1] : m[2];
  let y = m[3]; if (y.length === 2) y = "20" + y;
  return `${y}-${mo.padStart(2, "0")}`;
}

// ---- Modelos ---------------------------------------------------------------
export interface VentaRow {
  fecha: string; tipoDoc: string; documento: string; comp: string;
  ruc: string; nombre: string; total: number; mes?: string;
}
export interface CajaRow {
  fechaPago: string; tipoComp: string; comprobante: string; comp: string;
  total: number; contratante: string; tipoPago: string; banco: string; ym: string;
}
export interface ConcVenta {
  venta: VentaRow; cajaTotal: number; nPagos: number; dif: number;
  fechaPago: string; tipoPago: string; banco: string;
}

// ---- Parsers ---------------------------------------------------------------
export function parseLibroVentas(buf: Buffer, mesForzado?: string): VentaRow[] {
  const filas = leerHoja(buf);
  const mes = mesForzado || periodoDeTitulo(filas) || "";
  // Encabezado = fila con "Documento" y "Total".
  let h = filas.findIndex((f) => f.some((c) => /DOCUMENTO/i.test(c)) && f.some((c) => /TOTAL/i.test(c)));
  if (h < 0) h = 0;
  const H = filas[h];
  const iF = idxDe(H, "FECHA");
  const iTD = idxDe(H, "[T/D]", "T/D", "TIPO DOC");
  const iDoc = idxDe(H, "DOCUMENTO");
  const iRuc = idxDe(H, "R.U.C.", "RUC");
  const iNom = idxDe(H, "NOMBRE O RAZON SOCIAL", "NOMBRE", "RAZON SOCIAL");
  const iTot = idxDe(H, "TOTAL");
  const out: VentaRow[] = [];
  for (let i = h + 1; i < filas.length; i++) {
    const f = filas[i]; if (!f) continue;
    const doc = String(f[iDoc] ?? "").trim();
    const comp = compKey(doc);
    if (!comp) continue;                 // salta subtotales / "Total Ventas"
    out.push({
      fecha: String(f[iF] ?? "").trim(), tipoDoc: String(f[iTD] ?? "").trim(),
      documento: compBonito(doc), comp,
      ruc: String(f[iRuc] ?? "").trim(), nombre: String(f[iNom] ?? "").trim(),
      total: num(f[iTot]), mes,
    });
  }
  return out;
}

export function parseCajaVirtual(buf: Buffer): CajaRow[] {
  const filas = leerHoja(buf);
  let h = filas.findIndex((f) => f.some((c) => /COMPROBANTE/i.test(c)) && f.some((c) => /TOTAL/i.test(c)));
  if (h < 0) h = 0;
  const H = filas[h];
  const iF = idxDe(H, "FECHA PAGO", "FECHA");
  const iTC = idxDe(H, "TIPO COMPROBANTE");
  const iC = idxDe(H, "COMPROBANTE");
  const iTot = idxDe(H, "TOTAL");
  const iCon = idxDe(H, "CONTRATANTE");
  const iTP = idxDe(H, "TIPO PAGO");
  const iB = idxDe(H, "BANCO / FECHA VISA", "BANCO");
  const fmt = detectarFmt(filas.slice(h + 1).map((f) => f?.[iF]));
  const out: CajaRow[] = [];
  let ultimoYm = "";      // arrastre: si una fila con comprobante no trae fecha
  let ultimaFecha = "";   // (reporte con fecha agrupada), hereda la de arriba.
  for (let i = h + 1; i < filas.length; i++) {
    const f = filas[i]; if (!f) continue;
    const c = String(f[iC] ?? "").trim();
    const comp = compKey(c);
    // Actualiza el "último visto" con cualquier fila que traiga fecha (aunque no
    // sea comprobante), para que el arrastre sea correcto.
    const fRaw = String(f[iF] ?? "").trim();
    const ymFila = ymDe(f[iF], fmt);
    if (ymFila) { ultimoYm = ymFila; ultimaFecha = fRaw; }
    if (!comp) continue;
    out.push({
      fechaPago: fRaw || ultimaFecha, tipoComp: String(f[iTC] ?? "").trim().toUpperCase(),
      comprobante: compBonito(c), comp,
      total: num(f[iTot]), contratante: String(f[iCon] ?? "").trim(),
      tipoPago: String(f[iTP] ?? "").trim(), banco: String(f[iB] ?? "").trim(),
      ym: ymFila || ultimoYm,   // sin fecha propia → hereda el mes de arriba
    });
  }
  return out;
}

// ---- Conciliación ----------------------------------------------------------
export interface MesResumen {
  mes: string;               // "YYYY-MM"
  contabilidad: number;      // ingresos del Libro de Ventas
  cajaVirtual: number;       // ingresos de la Caja Virtual
  banco: number | null;      // abonos del banco (null si no se subió)
}
export interface ResultadoVC {
  conciliados: ConcVenta[];
  faltanEnCaja: VentaRow[];     // ventas sin pago en la caja
  cajaSinVenta: CajaRow[];      // comprobantes de caja (fact/bol) sin venta
  porMes: MesResumen[];         // ingresos por mes: contabilidad vs caja vs banco
  resumen: {
    ventasTotal: number; cajaTotal: number;
    conciliados: number; faltanEnCaja: number; cajaSinVenta: number;
    montoVentas: number; montoConciliado: number; montoFaltante: number;
    conDiferencia: number;
  };
}

export function conciliarVentasCaja(
  ventas: VentaRow[],
  caja: CajaRow[],
  bancoAbonoPorMes?: Record<string, number>,
): ResultadoVC {
  // Agrupa caja por comprobante (suma pagos parciales).
  const grupos = new Map<string, { total: number; n: number; rows: CajaRow[] }>();
  for (const c of caja) {
    const g = grupos.get(c.comp) ?? { total: 0, n: 0, rows: [] };
    g.total += c.total; g.n += 1; g.rows.push(c);
    grupos.set(c.comp, g);
  }
  const usados = new Set<string>();
  const conciliados: ConcVenta[] = [];
  const faltanEnCaja: VentaRow[] = [];

  for (const v of ventas) {
    const g = grupos.get(v.comp);
    if (g) {
      usados.add(v.comp);
      const primero = g.rows[0];
      conciliados.push({
        venta: v, cajaTotal: +g.total.toFixed(2), nPagos: g.n,
        dif: +(v.total - g.total).toFixed(2),
        fechaPago: primero.fechaPago, tipoPago: g.rows.map((r) => r.tipoPago).filter(Boolean).join(", "),
        banco: g.rows.map((r) => r.banco).filter(Boolean).join(", "),
      });
    } else {
      faltanEnCaja.push(v);
    }
  }
  // Comprobantes de caja (factura/boleta/NC, NO recibos) sin venta en el libro.
  // Se acota a los MESES que sí subiste (según el título de cada libro), para no
  // listar como "sin venta" meses de la caja que aún no cargaste.
  const mesesVentas = new Set(ventas.map((v) => v.mes).filter(Boolean) as string[]);
  const scope = mesesVentas.size > 0;
  const cajaSinVenta = caja.filter((c) => {
    if (usados.has(c.comp) || /RECIBO/i.test(c.tipoComp)) return false;
    return scope ? mesesVentas.has(c.ym) : true;
  });

  // Ingresos por mes: Contabilidad (ventas) vs Caja Virtual vs Banco (opcional).
  const cont: Record<string, number> = {}, cajaM: Record<string, number> = {};
  const meses = new Set<string>();
  for (const v of ventas) { if (!v.mes) continue; meses.add(v.mes); cont[v.mes] = (cont[v.mes] ?? 0) + v.total; }
  for (const c of caja) { if (!c.ym) continue; meses.add(c.ym); cajaM[c.ym] = (cajaM[c.ym] ?? 0) + c.total; }
  if (bancoAbonoPorMes) for (const m of Object.keys(bancoAbonoPorMes)) if (/^\d{4}-\d{2}$/.test(m)) meses.add(m);
  const porMes: MesResumen[] = [...meses].sort().map((m) => ({
    mes: m,
    contabilidad: +(cont[m] ?? 0).toFixed(2),
    cajaVirtual: +(cajaM[m] ?? 0).toFixed(2),
    banco: bancoAbonoPorMes ? +(bancoAbonoPorMes[m] ?? 0).toFixed(2) : null,
  }));

  const montoVentas = +ventas.reduce((a, v) => a + v.total, 0).toFixed(2);
  const montoConciliado = +conciliados.reduce((a, c) => a + c.venta.total, 0).toFixed(2);
  const montoFaltante = +faltanEnCaja.reduce((a, v) => a + v.total, 0).toFixed(2);
  return {
    conciliados, faltanEnCaja, cajaSinVenta, porMes,
    resumen: {
      ventasTotal: ventas.length, cajaTotal: caja.length,
      conciliados: conciliados.length, faltanEnCaja: faltanEnCaja.length, cajaSinVenta: cajaSinVenta.length,
      montoVentas, montoConciliado, montoFaltante,
      conDiferencia: conciliados.filter((c) => Math.abs(c.dif) >= 0.5).length,
    },
  };
}

// ---- Excel de salida -------------------------------------------------------
const MES_NOMBRE = ["", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Setiembre", "Octubre", "Noviembre", "Diciembre"];
const etiquetaMes = (ym: string): string => {
  const m = /^(\d{4})-(\d{2})$/.exec(ym); return m ? `${MES_NOMBRE[Number(m[2])] ?? m[2]} ${m[1]}` : ym;
};

export async function excelVentasCaja(r: ResultadoVC): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Radar Tributar IA";

  // Hoja 1: Ingresos por mes (Contabilidad vs Caja Virtual vs Banco).
  const conBanco = r.porMes.some((m) => m.banco !== null);
  const s0 = wb.addWorksheet("Ingresos por mes");
  const encab = ["Concepto", ...r.porMes.map((m) => etiquetaMes(m.mes)), "Total"];
  s0.addRow(encab);
  const sumFila = (vals: number[]) => vals.reduce((a, b) => a + b, 0);
  const filaContab = r.porMes.map((m) => m.contabilidad);
  const filaCaja = r.porMes.map((m) => m.cajaVirtual);
  const filaBanco = r.porMes.map((m) => m.banco ?? 0);
  s0.addRow(["Contabilidad (ventas)", ...filaContab, +sumFila(filaContab).toFixed(2)]);
  s0.addRow(["Caja Virtual", ...filaCaja, +sumFila(filaCaja).toFixed(2)]);
  if (conBanco) s0.addRow(["Banco (abonos)", ...filaBanco, +sumFila(filaBanco).toFixed(2)]);

  // Filas de diferencias entre fuentes de evidencia de ingresos.
  const difFilas: [string, number[]][] = [
    ["Dif. Caja − Contabilidad", r.porMes.map((m) => +(m.cajaVirtual - m.contabilidad).toFixed(2))],
  ];
  if (conBanco) {
    difFilas.push(["Dif. Banco − Contabilidad", r.porMes.map((m) => +((m.banco ?? 0) - m.contabilidad).toFixed(2))]);
    difFilas.push(["Dif. Banco − Caja", r.porMes.map((m) => +((m.banco ?? 0) - m.cajaVirtual).toFixed(2))]);
  }
  const difStart = s0.rowCount + 1;
  for (const [label, vals] of difFilas) s0.addRow([label, ...vals, +sumFila(vals).toFixed(2)]);

  // Formato número a las celdas de montos.
  s0.eachRow((row, i) => { if (i > 1) row.eachCell((cell, c) => { if (c > 1) cell.numFmt = "#,##0.00"; }); });
  s0.getColumn(1).width = 28;
  for (let c = 2; c <= encab.length; c++) s0.getColumn(c).width = 14;
  // Resalta las diferencias significativas.
  for (let ri = difStart; ri < difStart + difFilas.length; ri++) {
    s0.getRow(ri).eachCell((cell, c) => { if (c > 1 && Math.abs(Number(cell.value) || 0) >= 1) cell.font = { color: { argb: "FFB45309" }, bold: true }; });
  }

  const s1 = wb.addWorksheet("Conciliado");
  s1.columns = [
    { header: "Fecha venta", key: "fv", width: 12 },
    { header: "T/D", key: "td", width: 6 },
    { header: "Documento", key: "doc", width: 18 },
    { header: "RUC", key: "ruc", width: 14 },
    { header: "Cliente", key: "cli", width: 38 },
    { header: "Total venta", key: "tv", width: 13 },
    { header: "Total caja", key: "tc", width: 13 },
    { header: "N° pagos", key: "np", width: 9 },
    { header: "Dif.", key: "dif", width: 10 },
    { header: "Fecha pago", key: "fp", width: 12 },
    { header: "Tipo pago", key: "tp", width: 16 },
    { header: "Banco", key: "bco", width: 16 },
  ];
  for (const c of r.conciliados) {
    const row = s1.addRow({
      fv: c.venta.fecha, td: c.venta.tipoDoc, doc: c.venta.documento, ruc: c.venta.ruc, cli: c.venta.nombre,
      tv: c.venta.total, tc: c.cajaTotal, np: c.nPagos, dif: c.dif, fp: c.fechaPago, tp: c.tipoPago, bco: c.banco,
    });
    if (Math.abs(c.dif) >= 0.5) row.getCell("dif").font = { color: { argb: "FFB45309" }, bold: true };
  }

  const s2 = wb.addWorksheet("Faltan en Caja");
  s2.columns = [
    { header: "Fecha venta", key: "fv", width: 12 },
    { header: "T/D", key: "td", width: 6 },
    { header: "Documento", key: "doc", width: 18 },
    { header: "RUC", key: "ruc", width: 14 },
    { header: "Cliente", key: "cli", width: 38 },
    { header: "Total venta", key: "tv", width: 13 },
    { header: "Mes", key: "mes", width: 10 },
  ];
  for (const v of r.faltanEnCaja) s2.addRow({ fv: v.fecha, td: v.tipoDoc, doc: v.documento, ruc: v.ruc, cli: v.nombre, tv: v.total, mes: v.mes ?? "" });

  const s3 = wb.addWorksheet("En Caja sin Venta");
  s3.columns = [
    { header: "Fecha pago", key: "fp", width: 12 },
    { header: "Tipo", key: "tc", width: 14 },
    { header: "Comprobante", key: "comp", width: 18 },
    { header: "Contratante", key: "con", width: 38 },
    { header: "Total", key: "tot", width: 13 },
    { header: "Tipo pago", key: "tp", width: 16 },
    { header: "Banco", key: "bco", width: 16 },
  ];
  for (const c of r.cajaSinVenta) s3.addRow({ fp: c.fechaPago, tc: c.tipoComp, comp: c.comprobante, con: c.contratante, tot: c.total, tp: c.tipoPago, bco: c.banco });

  const s4 = wb.addWorksheet("Resumen");
  const R = r.resumen;
  ([
    ["Ventas (libro)", R.ventasTotal],
    ["Pagos en caja", R.cajaTotal],
    ["Conciliados", R.conciliados],
    ["  · con diferencia de monto", R.conDiferencia],
    ["Faltan en caja (ventas sin cobro)", R.faltanEnCaja],
    ["En caja sin venta (fact/bol)", R.cajaSinVenta],
    ["Monto total ventas (S/)", R.montoVentas],
    ["Monto conciliado (S/)", R.montoConciliado],
    ["Monto faltante en caja (S/)", R.montoFaltante],
  ] as [string, any][]).forEach(([k, v]) => s4.addRow([k, v]));

  for (const s of [s0, s1, s2, s3, s4]) {
    s.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A8A" } };
    s.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  }
  const ab = await wb.xlsx.writeBuffer();
  return Buffer.from(ab);
}
