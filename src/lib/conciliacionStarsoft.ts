// ============================================================
//  Conciliación bancaria StarSoft: BANCO (formato StarSoft) vs CONTABLE
// ============================================================
// Entradas:
//   - 3 Excel del sistema (StarSoft "trama"):
//       * S_movStandard  → asientos; las filas de cuenta 104x son los BANCOS.
//       * V_movVentas    → ventas (para enriquecer: factura/cliente cobrado).
//       * trama_anexos   → maestro de anexos (código anexo → RUC / razón social).
//   - 1 Excel FORMATO BANCO STARSOFT → movimientos del banco (una hoja por cuenta),
//       columnas: FECHA, REFERENCIA, CARGO, ABONO, SUCURSAL-AGENCIA, OPERACION-NUMERO.
//
// Conciliación: se cruza por N° de operación (banco OPERACION-NUMERO ↔ contable
// NRO DOCUMENTO de las filas 104x) y se valida el monto (banco ABONO/CARGO ↔
// contable DEBE/HABER). Respaldo: monto + fecha. Resultado: conciliados y los que
// no concilian (banco sin contabilizar + contable sin banco).
//
// Lee .xls (BIFF) y .xlsx con SheetJS; escribe el resultado con ExcelJS.

import * as XLSX from "xlsx";
import ExcelJS from "exceljs";

// ---- Utilidades ------------------------------------------------------------
const num = (s: any): number => {
  const n = Number(String(s ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
/** Normaliza un N° de operación: sin espacios; recorta ceros a la izquierda para
 *  comparar "006227" con "6227", pero conserva el original para mostrar. */
const opKey = (s: any): string => String(s ?? "").replace(/\s+/g, "").replace(/^0+(?=\d)/, "").trim();
const opRaw = (s: any): string => String(s ?? "").replace(/\s+/g, " ").trim();

/** Normaliza fecha a "YYYY-MM-DD". Acepta d/m/yy, dd/mm/yyyy, Date. */
function fechaISO(v: any): string {
  if (v instanceof Date && !isNaN(v.getTime())) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  }
  const s = String(v ?? "").trim();
  const m = /^(\d{1,2})[/\-](\d{1,2})[/\-](\d{2,4})$/.exec(s);
  if (m) {
    let [, d, mo, y] = m;
    if (y.length === 2) y = "20" + y;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return s;
}

function leerHojas(buf: Buffer): Record<string, string[][]> {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  const out: Record<string, string[][]> = {};
  for (const sn of wb.SheetNames) {
    out[sn] = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: "", raw: false }) as string[][];
  }
  return out;
}
function idxDe(headers: string[], ...nombres: string[]): number {
  const norm = (s: string) => String(s || "").toUpperCase().replace(/\s+/g, " ").trim();
  const H = headers.map(norm);
  for (const n of nombres) { const i = H.indexOf(norm(n)); if (i >= 0) return i; }
  // por inclusión
  for (const n of nombres) { const i = H.findIndex((h) => h.includes(norm(n))); if (i >= 0) return i; }
  return -1;
}

/** Clasifica cuál de los 3 Excel del sistema es (por sus encabezados). */
export function detectarTipoSistema(buf: Buffer): "standard" | "ventas" | "anexos" | "desconocido" {
  try {
    const filas = leerHojas(buf).Resultado ?? Object.values(leerHojas(buf))[0] ?? [];
    const H = (filas[0] ?? []).map((s) => String(s).toUpperCase());
    const has = (t: string) => H.some((h) => h.includes(t));
    if (has("DENOMINACION") || has("RUC DEL ANEXO") || (has("CODIGO ANEXO") && has("APELLIDO PATERNO"))) return "anexos";
    if (has("RAZON SOCIAL") && has("IGV")) return "ventas";
    if (has("CTA CONTABLE") && (has("MEDIO DE PAGO") || has("DEBE/HABER") || has("SUBDIARIO"))) return "standard";
    return "desconocido";
  } catch { return "desconocido"; }
}

// ---- Modelos ---------------------------------------------------------------
export interface BancoMov {
  cuenta: string;      // hoja = cuenta (últimos dígitos)
  fecha: string;       // ISO
  fechaRaw: string;
  referencia: string;
  cargo: number;
  abono: number;
  monto: number;       // abono si hay, si no cargo
  tipo: "ABONO" | "CARGO";
  op: string;          // key normalizada
  opRaw: string;       // original
}
export interface StdMov {
  ctaContable: string;
  comprobante: string;
  importe: number;
  dh: string;          // "D" | "H"
  op: string;          // key normalizada (de NRO DOCUMENTO)
  opRaw: string;
  glosa: string;
  medioPago: string;
  fecha: string;       // ISO
  docCobrado: string;  // FT/BV extraído de la glosa
}
export interface ParConciliado {
  op: string;
  banco: BancoMov;
  std: StdMov;
  difMonto: number;
  via: "operacion" | "monto+fecha";
  cliente?: string;
}

// ---- Parsers ---------------------------------------------------------------
/** Nombres de las hojas (cuentas) del FORMATO BANCO STARSOFT. */
export function listarHojasBanco(buf: Buffer): string[] {
  return Object.keys(leerHojas(buf));
}

/** Lee los movimientos del banco. Si se pasan `sel` (nombres de hoja), SOLO esas. */
export function parseBancoStarsoft(buf: Buffer, sel?: string[]): BancoMov[] {
  let hojas = leerHojas(buf);
  if (sel && sel.length) {
    const filt: Record<string, string[][]> = {};
    for (const s of sel) if (hojas[s]) filt[s] = hojas[s];
    hojas = filt;
  }
  const movs: BancoMov[] = [];
  for (const [sn, filas] of Object.entries(hojas)) {
    if (!filas.length) continue;
    // Encabezado = primera fila con REFERENCIA + CARGO (presentes en TODAS las hojas,
    // aunque a veces falte el rótulo FECHA/OPERACION). Si no, fila 0.
    let hRow = filas.findIndex((f) => f.some((c) => /REFERENCIA/i.test(c)) && f.some((c) => /CARGO/i.test(c)));
    if (hRow < 0) hRow = 0;
    const H = filas[hRow];
    // El formato StarSoft es POSICIONAL; los rótulos a veces faltan. Anclamos por
    // los que sí están y caemos a posición fija: FECHA=0, REFERENCIA=2, CARGO=3,
    // ABONO=4; OPERACION = columna siguiente a SUCURSAL-AGENCIA.
    const iF = (idxDe(H, "FECHA") + 1 || 1) - 1;            // -1 → 0
    const iRef = (idxDe(H, "REFERENCIA") + 1 || 3) - 1;     // -1 → 2
    const iCargo = (idxDe(H, "CARGO") + 1 || 4) - 1;        // -1 → 3
    const iAbono = (idxDe(H, "ABONO") + 1 || 5) - 1;        // -1 → 4
    const iSuc = idxDe(H, "SUCURSAL-AGENCIA", "SUCURSAL");
    let iOp = idxDe(H, "OPERACION-NUMERO", "OPERACION", "NUMERO");
    if (iOp < 0) iOp = iSuc >= 0 ? iSuc + 1 : 7;            // OP va tras SUCURSAL
    for (let i = hRow + 1; i < filas.length; i++) {
      const f = filas[i]; if (!f) continue;
      const fecha = f[iF]; if (!fecha || !String(fecha).trim()) continue;
      const cargo = num(f[iCargo]); const abono = num(f[iAbono]);
      if (!cargo && !abono) continue;
      movs.push({
        cuenta: sn,
        fecha: fechaISO(fecha), fechaRaw: String(fecha).trim(),
        referencia: String(f[iRef] ?? "").trim(),
        cargo, abono,
        monto: abono || cargo, tipo: abono ? "ABONO" : "CARGO",
        op: opKey(f[iOp]), opRaw: opRaw(f[iOp]),
      });
    }
  }
  return movs;
}

/** Del standard, SOLO las filas de cuentas de banco (104x). */
export function parseStandardBancos(buf: Buffer): StdMov[] {
  const filas = leerHojas(buf).Resultado ?? Object.values(leerHojas(buf))[0] ?? [];
  if (!filas.length) return [];
  const H = filas[0];
  const iCta = idxDe(H, "CTA CONTABLE");
  const iComp = idxDe(H, "COMPROBANTE");
  const iImp = idxDe(H, "IMPORTE");
  const iDH = idxDe(H, "DEBE/HABER", "DEBE / HABER");
  const iNro = idxDe(H, "NRO DOCUMENTO");
  const iGlosa = idxDe(H, "GLOSA MOVIMIENTO", "GLOSA");
  const iMed = idxDe(H, "MEDIO DE PAGO");
  const iFec = idxDe(H, "FECHA DOCUMENTO", "FECHA REGISTRO");
  const out: StdMov[] = [];
  for (let i = 1; i < filas.length; i++) {
    const f = filas[i]; if (!f) continue;
    const cta = String(f[iCta] ?? "");
    if (!cta.startsWith("104")) continue; // solo bancos
    const glosa = String(f[iGlosa] ?? "").trim();
    const doc = /\b(FT|BV|NC|ND|F|B)\s*([A-Z0-9-]{6,})/i.exec(glosa);
    out.push({
      ctaContable: cta,
      comprobante: String(f[iComp] ?? "").trim(),
      importe: num(f[iImp]), dh: String(f[iDH] ?? "").trim().toUpperCase(),
      op: opKey(f[iNro]), opRaw: opRaw(f[iNro]),
      glosa, medioPago: String(f[iMed] ?? "").trim(),
      fecha: fechaISO(f[iFec]),
      docCobrado: doc ? `${doc[1]} ${doc[2]}` : "",
    });
  }
  return out;
}

/** Maestro anexos: código anexo → razón social / RUC. */
export function parseAnexos(buf: Buffer): Record<string, { nombre: string; ruc: string }> {
  const filas = leerHojas(buf).Resultado ?? Object.values(leerHojas(buf))[0] ?? [];
  const map: Record<string, { nombre: string; ruc: string }> = {};
  if (!filas.length) return map;
  const H = filas[0];
  const iCod = idxDe(H, "CODIGO ANEXO");
  const iRuc = idxDe(H, "RUC DEL ANEXO");
  const iDen = idxDe(H, "DENOMINACION");
  const iAp = idxDe(H, "APELLIDO PATERNO"), iAm = idxDe(H, "APELLIDO MATERNO"), iN1 = idxDe(H, "PRIMER NOMBRE"), iN2 = idxDe(H, "SEGUNDO NOMBRE");
  for (let i = 1; i < filas.length; i++) {
    const f = filas[i]; if (!f) continue;
    const cod = String(f[iCod] ?? "").trim(); if (!cod) continue;
    const den = String(f[iDen] ?? "").trim();
    const nombre = den || [f[iAp], f[iAm], f[iN1], f[iN2]].map((x) => String(x ?? "").trim()).filter(Boolean).join(" ");
    map[cod] = { nombre, ruc: String(f[iRuc] ?? "").trim() };
  }
  return map;
}

/** Ventas: NRO DOCUMENTO (factura) → { codigo cliente, ruc, razón social }. */
export function parseVentas(buf: Buffer): Record<string, { codigo: string; ruc: string; nombre: string }> {
  const filas = leerHojas(buf).Resultado ?? Object.values(leerHojas(buf))[0] ?? [];
  const map: Record<string, { codigo: string; ruc: string; nombre: string }> = {};
  if (!filas.length) return map;
  const H = filas[0];
  const iNro = idxDe(H, "NRO DOCUMENTO");
  const iTipo = idxDe(H, "TIPO DOCUMENTO");
  const iCod = idxDe(H, "CODIGO CLIENTE", "CODIGO ANEXO");
  const iRuc = idxDe(H, "RUC CLIENTE");
  const iRs = idxDe(H, "RAZON SOCIAL");
  for (let i = 1; i < filas.length; i++) {
    const f = filas[i]; if (!f) continue;
    const nro = String(f[iNro] ?? "").trim(); if (!nro) continue;
    const key = `${String(f[iTipo] ?? "").trim().toUpperCase()} ${nro}`.trim();
    if (!map[nro]) map[nro] = { codigo: String(f[iCod] ?? "").trim(), ruc: String(f[iRuc] ?? "").trim(), nombre: String(f[iRs] ?? "").trim() };
    if (!map[key]) map[key] = map[nro];
  }
  return map;
}

// ---- Conciliación ----------------------------------------------------------
export interface ResultadoConc {
  conciliados: ParConciliado[];
  bancoSolo: BancoMov[];   // en banco, sin contable
  stdSolo: StdMov[];       // en contable, sin banco
  resumen: {
    bancoTotal: number; stdTotal: number; conciliados: number;
    porOperacion: number; porMontoFecha: number;
    bancoSolo: number; stdSolo: number; montoConciliado: number;
  };
}

const TOL = 0.5; // tolerancia de monto (soles)

export function conciliar(
  banco: BancoMov[],
  std: StdMov[],
  ventas: Record<string, { codigo: string; ruc: string; nombre: string }> = {},
  anexos: Record<string, { nombre: string; ruc: string }> = {},
): ResultadoConc {
  const stdUsado = new Set<number>();
  // Índices del standard.
  const byOp = new Map<string, number[]>();
  std.forEach((s, i) => { if (s.op) { const a = byOp.get(s.op) ?? []; a.push(i); byOp.set(s.op, a); } });
  const byMontoFecha = new Map<string, number[]>();
  std.forEach((s, i) => { const k = `${s.importe.toFixed(2)}|${s.fecha}`; const a = byMontoFecha.get(k) ?? []; a.push(i); byMontoFecha.set(k, a); });

  const clienteDe = (s: StdMov): string => {
    if (!s.docCobrado) return "";
    const v = ventas[s.docCobrado] || ventas[s.docCobrado.replace(/^\w+\s/, "")];
    if (v) return v.nombre || (v.codigo && anexos[v.codigo]?.nombre) || v.ruc || "";
    return "";
  };

  const conciliados: ParConciliado[] = [];
  const bancoSolo: BancoMov[] = [];

  for (const b of banco) {
    let elegido = -1; let via: "operacion" | "monto+fecha" = "operacion";
    // 1) por N° de operación (elige el de monto más cercano no usado).
    if (b.op && b.op !== "0") {
      const cand = (byOp.get(b.op) ?? []).filter((i) => !stdUsado.has(i));
      if (cand.length) {
        cand.sort((a, c) => Math.abs(std[a].importe - b.monto) - Math.abs(std[c].importe - b.monto));
        elegido = cand[0];
      }
    }
    // 2) respaldo: monto + fecha exactos.
    if (elegido < 0) {
      const cand = (byMontoFecha.get(`${b.monto.toFixed(2)}|${b.fecha}`) ?? []).filter((i) => !stdUsado.has(i));
      if (cand.length) { elegido = cand[0]; via = "monto+fecha"; }
    }
    if (elegido >= 0) {
      stdUsado.add(elegido);
      const s = std[elegido];
      conciliados.push({ op: b.opRaw || s.opRaw, banco: b, std: s, difMonto: +(b.monto - s.importe).toFixed(2), via, cliente: clienteDe(s) });
    } else {
      bancoSolo.push(b);
    }
  }
  const stdSolo = std.filter((_, i) => !stdUsado.has(i));

  const porOperacion = conciliados.filter((c) => c.via === "operacion").length;
  return {
    conciliados, bancoSolo, stdSolo,
    resumen: {
      bancoTotal: banco.length, stdTotal: std.length, conciliados: conciliados.length,
      porOperacion, porMontoFecha: conciliados.length - porOperacion,
      bancoSolo: bancoSolo.length, stdSolo: stdSolo.length,
      montoConciliado: +conciliados.reduce((a, c) => a + c.banco.monto, 0).toFixed(2),
    },
  };
}

// ---- Excel de salida -------------------------------------------------------
export async function excelConciliacionStarsoft(r: ResultadoConc): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Radar Tributar IA";

  // Hoja 1: Conciliado
  const s1 = wb.addWorksheet("Conciliado");
  s1.columns = [
    { header: "Cuenta", key: "cuenta", width: 10 },
    { header: "Fecha banco", key: "fb", width: 12 },
    { header: "N° Operación", key: "op", width: 16 },
    { header: "Referencia banco", key: "ref", width: 34 },
    { header: "Tipo", key: "tipo", width: 8 },
    { header: "Monto banco", key: "mb", width: 14 },
    { header: "Cta contable", key: "cta", width: 14 },
    { header: "Comprob.", key: "comp", width: 10 },
    { header: "D/H", key: "dh", width: 6 },
    { header: "Importe contable", key: "ic", width: 15 },
    { header: "Dif.", key: "dif", width: 10 },
    { header: "Doc. cobrado", key: "doc", width: 18 },
    { header: "Cliente", key: "cli", width: 34 },
    { header: "Glosa", key: "glosa", width: 44 },
    { header: "Cruce", key: "via", width: 12 },
  ];
  for (const c of r.conciliados) {
    s1.addRow({
      cuenta: c.banco.cuenta, fb: c.banco.fechaRaw, op: c.op, ref: c.banco.referencia, tipo: c.banco.tipo,
      mb: c.banco.monto, cta: c.std.ctaContable, comp: c.std.comprobante, dh: c.std.dh, ic: c.std.importe,
      dif: c.difMonto, doc: c.std.docCobrado, cli: c.cliente ?? "", glosa: c.std.glosa, via: c.via,
    });
  }

  // Hoja 2: No concilia (unión banco-sin-contable + contable-sin-banco)
  const s2 = wb.addWorksheet("No concilia");
  s2.columns = [
    { header: "Origen", key: "origen", width: 16 },
    { header: "Cuenta", key: "cuenta", width: 12 },
    { header: "Fecha", key: "fecha", width: 12 },
    { header: "N° Operación", key: "op", width: 16 },
    { header: "Tipo/DH", key: "tipo", width: 8 },
    { header: "Monto", key: "monto", width: 14 },
    { header: "Comprob.", key: "comp", width: 10 },
    { header: "Doc. cobrado", key: "doc", width: 18 },
    { header: "Referencia / Glosa", key: "ref", width: 60 },
  ];
  for (const b of r.bancoSolo) {
    s2.addRow({ origen: "BANCO sin contab.", cuenta: b.cuenta, fecha: b.fechaRaw, op: b.opRaw, tipo: b.tipo, monto: b.monto, comp: "", doc: "", ref: b.referencia });
  }
  for (const s of r.stdSolo) {
    s2.addRow({ origen: "CONTABLE sin banco", cuenta: s.ctaContable, fecha: s.fecha, op: s.opRaw, tipo: s.dh, monto: s.importe, comp: s.comprobante, doc: s.docCobrado, ref: s.glosa });
  }

  // Hoja 3: Resumen
  const s3 = wb.addWorksheet("Resumen");
  const R = r.resumen;
  ([
    ["Movimientos banco", R.bancoTotal],
    ["Movimientos contables (104x)", R.stdTotal],
    ["Conciliados", R.conciliados],
    ["  · por N° operación", R.porOperacion],
    ["  · por monto+fecha", R.porMontoFecha],
    ["Banco sin contabilizar", R.bancoSolo],
    ["Contable sin banco", R.stdSolo],
    ["Monto conciliado (S/)", R.montoConciliado],
  ] as [string, any][]).forEach(([k, v]) => s3.addRow([k, v]));

  for (const s of [s1, s2, s3]) {
    s.getRow(1).font = { bold: true };
    s.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A8A" } };
    s.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  }
  const ab = await wb.xlsx.writeBuffer();
  return Buffer.from(ab);
}
