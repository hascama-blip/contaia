// ============================================================
//  Caja virtual → relación  N° DE OPERACIÓN ↔ COMPROBANTES
// ============================================================
// Entrada: los archivos que baja el utilitario "Caja virtual · reportes por sede" (un ZIP por
// sede, una carpeta por día):
//   AAAA-MM-DD/reporte_ingreso_….xlsx   "REPORTE DE CAJA DIARIO": cada comprobante del día con su
//                                        Tipo Pago (EFECTIVO · YAPE · DEPOSITO · VISA…), Banco y
//                                        Nro. Operación (vacío cuando es efectivo) y Cobro Total.
//   AAAA-MM-DD/drive/DEPOSITO ….pdf      voucher ESCANEADO del depósito en el banco del efectivo
//                                        de ese día (N° de operación, fecha, hora, monto).
// Salida: por cada operación, qué comprobantes cubre y por cuánto.
//   · Pagos que NO son efectivo: la operación ya viene en el Excel (comprobante → N° operación).
//   · EFECTIVO: todos los comprobantes en efectivo del día pertenecen al depósito del voucher de
//     ese día; el N° de operación, la fecha y el monto se LEEN del voucher (OCR) y se comprueba
//     que el monto depositado sea igual a la suma del efectivo.
// Caso real (RTP Andahuaylas, oct-2026): 26 días, 24 vouchers BBVA con "OPERACION 0000000NNNNN"
// y 2 de ventanilla con "CLAVE:"; el depósito cuadra con el efectivo salvo un día con S/ 80 de
// diferencia explicada en el propio voucher (boleta anulada).
// Otros formatos previstos: BCP ("OP-0916720 07/10/2026 … IMPORTE DEPOSITADO: S/ ***2,035.00").

import { execFile } from "child_process";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import ExcelJS from "exceljs";

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const txt = (v: unknown): string => {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") { const o = v as Record<string, unknown>; return txt("result" in o ? o.result : "text" in o ? o.text : Array.isArray(o.richText) ? (o.richText as { text: string }[]).map((x) => x.text).join("") : ""); }
  return String(v).trim();
};

// ---------------------------------------------------------------- tipos
export interface FilaCaja { tipoDoc: string; comprobante: string; tipoPago: string; banco: string; operacion: string; importe: number }
export interface DiaCajaReporte { fecha: string; sede: string; responsable: string; filas: FilaCaja[] }
export interface Voucher {
  archivo: string; pagina: number;
  /** "deposito" = voucher de depósito en efectivo; "otro" = constancia de pago, boleta, etc. */
  tipo: "deposito" | "otro";
  banco: string; operacion: string; fecha: string; hora: string; monto: number | null;
  /** Texto adicional útil del voucher (p. ej. la nota que explica una diferencia). */
  nota: string; resumen: string;
}
export interface ComprobanteOp { tipoDoc: string; comprobante: string; importe: number }
export interface OperacionCaja {
  sede: string; fechaVenta: string; medio: string; banco: string;
  /** N° de operación ("" si no se pudo leer). Varias = "a + b". */
  operacion: string; fechaOperacion: string; horaOperacion: string;
  /** Monto del voucher (solo efectivo); null si no hay voucher. */
  montoVoucher: number | null; sumaComprobantes: number; diferencia: number | null;
  comprobantes: ComprobanteOp[];
  estado: "Cuadra" | "Diferencia" | "Sin voucher" | "Según caja virtual";
  obs: string; archivo: string;
}
export interface ResultadoOperaciones {
  sede: string; dias: number; comprobantes: number; total: number;
  operaciones: OperacionCaja[];
  /** Filas del reporte sin medio de pago (importe 0) o devoluciones por nota de crédito. */
  sinOperacion: (ComprobanteOp & { fecha: string; motivo: string })[];
  /** Páginas de los PDF del Drive que no son un depósito (constancias, boletas…). */
  otros: { fecha: string; archivo: string; pagina: number; resumen: string }[];
  avisos: string[];
}

// ---------------------------------------------------------------- reporte de caja diario (Excel)
export async function leerReporteCaja(buf: Buffer | Uint8Array, fechaCarpeta: string): Promise<DiaCajaReporte | null> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) return null;
  let ih = 0; const meta: Record<string, string> = {};
  ws.eachRow((row, i) => {
    const a = txt(row.getCell(1).value).toLowerCase();
    if (!ih && a.startsWith("item")) ih = i;
    if (!ih && ["sede", "fecha", "responsable"].includes(a)) meta[a] = txt(row.getCell(2).value);
  });
  if (!ih) return null;
  const H: string[] = []; for (let c = 1; c <= ws.columnCount; c++) H.push(txt(ws.getRow(ih).getCell(c).value).toLowerCase());
  const col = (p: (h: string) => boolean) => H.findIndex(p) + 1;
  const cDoc = col((h) => h === "doc."), cComp = col((h) => h.startsWith("nro. comprob")), cTP = col((h) => h.startsWith("tipo pago"));
  const cBanco = col((h) => h.startsWith("banco")), cOp = col((h) => h.startsWith("nro. oper")), cTot = col((h) => h.startsWith("cobro total"));
  if (!cComp || !cTP || !cTot) return null;
  const filas: FilaCaja[] = [];
  for (let i = ih + 1; i <= ws.rowCount; i++) {
    const row = ws.getRow(i);
    const comprobante = txt(row.getCell(cComp).value).toUpperCase();
    if (!/^[A-Z0-9]{4}-\d+$/.test(comprobante)) continue; // vacías y TOTALES
    filas.push({
      tipoDoc: cDoc ? txt(row.getCell(cDoc).value).toUpperCase() : "", comprobante,
      tipoPago: txt(row.getCell(cTP).value).toUpperCase(), banco: cBanco ? txt(row.getCell(cBanco).value).toUpperCase() : "",
      operacion: cOp ? txt(row.getCell(cOp).value).toUpperCase() : "", importe: r2(Number(txt(row.getCell(cTot).value).replace(/,/g, ""))),
    });
  }
  const f = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(meta.fecha ?? "");
  return { fecha: f ? `${f[3]}-${f[2]}-${f[1]}` : fechaCarpeta, sede: meta.sede ?? "", responsable: meta.responsable ?? "", filas };
}

// ---------------------------------------------------------------- PDF escaneado → imágenes
function ejecutar(cmd: string, args: string[], ms = 60000): Promise<boolean> {
  return new Promise((ok) => execFile(cmd, args, { timeout: ms }, (err) => ok(!err)));
}
/** Imágenes JPEG incrustadas en el PDF (los escáneres guardan una por página). Respaldo sin poppler. */
function jpegsDelPdf(buf: Buffer): Buffer[] {
  const s = buf.toString("latin1"); const out: Buffer[] = [];
  const re = /<<([^>]*(?:>(?!>)[^>]*)*)>>\s*stream\r?\n/g; let m: RegExpExecArray | null;
  while ((m = re.exec(s)) && out.length < 12) {
    if (!/\/DCTDecode/.test(m[1]) || !/\/Subtype\s*\/Image/.test(m[1])) continue;
    const ini = m.index + m[0].length, fin = s.indexOf("endstream", ini);
    if (fin > ini) out.push(buf.subarray(ini, fin));
  }
  return out;
}
/** Páginas de un PDF como imágenes (PNG con `pdftoppm` de poppler; si no está, los JPEG incrustados). */
export async function paginasDelPdf(buf: Buffer, maxPaginas = 8): Promise<Buffer[]> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "voucher-"));
  try {
    const pdf = path.join(dir, "in.pdf");
    await fs.writeFile(pdf, buf);
    if (await ejecutar("pdftoppm", ["-r", "150", "-png", "-l", String(maxPaginas), pdf, path.join(dir, "p")])) {
      const fs_ = (await fs.readdir(dir)).filter((f) => f.endsWith(".png")).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      if (fs_.length) return Promise.all(fs_.map((f) => fs.readFile(path.join(dir, f))));
    }
    return jpegsDelPdf(buf).slice(0, maxPaginas);
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => null);
  }
}

// ---------------------------------------------------------------- OCR
/** Lector de texto (tesseract). `TESSDATA_DIR` = carpeta local con `spa.traineddata(.gz)`; si no, lo baja del CDN. */
export async function crearLector(): Promise<{ leer: (img: Buffer) => Promise<string>; cerrar: () => Promise<void> }> {
  const { createWorker } = await import("tesseract.js");
  const dir = process.env.TESSDATA_DIR;
  const worker = dir ? await createWorker("spa", 1, { langPath: dir, cachePath: dir }) : await createWorker("spa");
  return {
    leer: async (img) => { try { return (await worker.recognize(img)).data.text ?? ""; } catch { return ""; } },
    cerrar: async () => { await worker.terminate().catch(() => null); },
  };
}

// ---------------------------------------------------------------- lectura del voucher
/** Número leído por OCR: "1,630.00" · "1.810.00" · "2,160,00" · "***2,035.0" → 1630 / 1810 / 2160 / 2035. */
export function numOcr(s: string): number | null {
  const t = s.replace(/[^\d.,]/g, "").replace(/^[.,]+|[.,]+$/g, "");
  if (!/\d/.test(t)) return null;
  const m = /^(.*)[.,](\d{1,2})$/.exec(t);
  const n = m ? Number(`${m[1].replace(/[.,]/g, "")}.${m[2]}`) : Number(t.replace(/[.,]/g, ""));
  return Number.isFinite(n) ? r2(n) : null;
}
/** N° de operación sin ceros de relleno. El OCR a veces lee el primer 0 como 9 o agrega un dígito:
 *  "000000041549" · "900000042011" · "0900000000796" → 41549 · 42011 · 796. */
export function operacionLimpia(s: string): string {
  const d = s.replace(/\D/g, "");
  const m = /^[09]{0,2}0{4,}(\d+)$/.exec(d);
  return (m ? m[1] : d).replace(/^0+(?=\d)/, "");
}

export function leerVoucher(texto: string, fechaVenta: string): Omit<Voucher, "archivo" | "pagina"> {
  const lineas = texto.split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const T = lineas.join("\n").toUpperCase();
  const anio = Number(fechaVenta.slice(0, 4));
  // Monto: la etiqueta más confiable primero.
  let monto: number | null = null;
  for (const re of [/MONTO\s+DEPOSITADO/, /IMPORTE\s+DEPOSITADO/, /IMPORTE\s+DE\s+ABONO/, /\b[IA1][MN]PORTE\b/]) {
    const l = lineas.find((x) => re.test(x.toUpperCase()));
    const v = l ? numOcr(l.toUpperCase().split(re)[1] ?? "") : null;
    if (v != null && v > 0) { monto = v; break; }
  }
  // Fecha, hora y N° de operación.
  let fecha = "", hora = "", operacion = "";
  const iso = (d: string, m: string, y: string) => {
    let a = Number(y);
    // Año mal leído por el OCR ("2006", "2028"): el depósito es del mismo año de la venta (o enero siguiente).
    if (a !== anio && !(a === anio + 1 && Number(m) === 1)) a = Number(m) === 1 && fechaVenta.slice(5, 7) === "12" ? anio + 1 : anio;
    return `${a}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  };
  // BBVA cajero: "02/10/2026 11:59:09 2456 000000041549" (fecha · hora · cajero · operación)
  let m = /(\d{2})[\/-](\d{2})[\/-](\d{4})\s+(\d{2}:\d{2}(?::\d{2})?)\s+\d{3,5}\s+\(?(\d{9,14})/.exec(T);
  if (m) { fecha = iso(m[1], m[2], m[3]); hora = m[4]; operacion = operacionLimpia(m[5]); }
  // BCP: "OP-0916720 07/10/2026" … "Hora:09:22:41"
  if (!operacion) {
    m = /\bOP[-\s.:]*(\d{5,10})/.exec(T);
    if (m) operacion = operacionLimpia(m[1]);
  }
  if (!operacion) { m = /OPERACI[OÓ]N\D{0,12}(\d{5,14})/.exec(T); if (m) operacion = operacionLimpia(m[1]); }
  // BBVA ventanilla: no trae N° de operación, solo "CLAVE: 6633/1541/0032872 …"
  if (!operacion) { m = /CLAVE\s*:?\s*([A-Z0-9]{3,6}\/[A-Z0-9]{3,6}\/[A-Z0-9]{5,9})/.exec(T); if (m) operacion = `CLAVE ${m[1]}`; }
  if (!fecha) { m = /(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/.exec(T.replace(/FECHA\s+DE\s+EMISI[OÓ]N.*$/m, "")); if (m && Number(m[1]) <= 31 && Number(m[2]) <= 12) fecha = iso(m[1], m[2], m[3]); }
  if (!hora) { m = /HORA\s*:?\s*(\d{2}:\d{2}(?::\d{2})?)/.exec(T); if (m) hora = m[1]; }
  const cuenta = /(?:CUENTA|CTA)[^\d\n]{0,14}([\d][\d\s-]{9,26}\d)/.exec(T)?.[1].replace(/[\s-]/g, "") ?? "";
  const banco = /BBVA|CONTINENTAL/.test(T) ? "BBVA" : /\bBCP\b|BANCO DE CR[EÉ]DITO/.test(T) ? "BCP" : /INTERBANK/.test(T) ? "INTERBANK" : /SCOTIA/.test(T) ? "SCOTIABANK" : /BANCO DE LA NACI[OÓ]N/.test(T) ? "NACION" : cuenta.startsWith("0011") ? "BBVA" : "";
  const esDeposito = /DEP[OÓ0]SITO\s+(EN\s+EFECTIVO|CUENTA)/.test(T) && monto != null;
  // Notas del voucher que explican diferencias (boleta anulada, descuento…).
  const nota = lineas.filter((l) => /ANUL|DESCONT|DEVOL|NOTA DE CR|\bSOLO\b.*DEP|DEPOSITO ES/i.test(l)).join(" ").slice(0, 300);
  const resumen = (lineas.find((l) => /CONSTANCIA|BOLETA|FACTURA|TRANSFERENCIA|DEP[OÓ]SITO/i.test(l)) ?? lineas[0] ?? "").slice(0, 120);
  return { tipo: esDeposito ? "deposito" : "otro", banco, operacion, fecha, hora, monto, nota, resumen };
}

// ---------------------------------------------------------------- armado de la relación
const esEfectivo = (tp: string) => /^EFECTIVO/.test(tp);

/** Operaciones de UN día: las del Excel (no efectivo) + el efectivo contra el voucher del depósito. */
export function operacionesDelDia(dia: DiaCajaReporte, vouchers: Voucher[], sinPdf: string): { operaciones: OperacionCaja[]; sinOperacion: ResultadoOperaciones["sinOperacion"] } {
  const operaciones: OperacionCaja[] = []; const sinOperacion: ResultadoOperaciones["sinOperacion"] = [];
  const sumar = (fs_: FilaCaja[]): ComprobanteOp[] => {
    const m = new Map<string, ComprobanteOp>();
    for (const f of fs_) { const o = m.get(f.comprobante); if (o) o.importe = r2(o.importe + f.importe); else m.set(f.comprobante, { tipoDoc: f.tipoDoc, comprobante: f.comprobante, importe: f.importe }); }
    return Array.from(m.values());
  };
  // 1) Lo que no es efectivo: el N° de operación viene en el reporte.
  const grupos = new Map<string, FilaCaja[]>();
  const efectivo: FilaCaja[] = [];
  for (const f of dia.filas) {
    if (esEfectivo(f.tipoPago)) { efectivo.push(f); continue; }
    if (!f.tipoPago || /NOTA\s+CREDITO|DEV\b/.test(f.tipoPago) || !f.operacion) {
      sinOperacion.push({ tipoDoc: f.tipoDoc, comprobante: f.comprobante, importe: f.importe, fecha: dia.fecha, motivo: !f.tipoPago ? "Sin medio de pago en el reporte" : !f.operacion ? `${f.tipoPago} sin N° de operación` : f.tipoPago });
      continue;
    }
    const k = `${f.tipoPago}|${f.banco}|${f.operacion}`;
    (grupos.get(k) ?? grupos.set(k, []).get(k)!).push(f);
  }
  for (const [k, fs_] of Array.from(grupos.entries())) {
    const [tipoPago, banco, operacion] = k.split("|");
    const comprobantes = sumar(fs_);
    // En VISA la columna "Banco/Fecha Visa" trae la fecha del pago con tarjeta.
    const fechaVisa = /^\d{4}-\d{2}-\d{2}$/.test(banco) ? banco : "";
    operaciones.push({
      sede: dia.sede, fechaVenta: dia.fecha, medio: tipoPago, banco: fechaVisa ? "" : banco, operacion, fechaOperacion: fechaVisa, horaOperacion: "",
      montoVoucher: null, sumaComprobantes: r2(comprobantes.reduce((a, c) => a + c.importe, 0)), diferencia: null, comprobantes,
      estado: "Según caja virtual", obs: "", archivo: "",
    });
  }
  // 2) Efectivo: todos los comprobantes en efectivo del día ↔ el depósito del voucher.
  if (efectivo.length) {
    const vistos = new Set<string>();
    const deps = vouchers.filter((v) => v.tipo === "deposito").filter((v) => { const k = `${v.operacion}|${v.monto}|${v.fecha}`; return vistos.has(k) ? false : (vistos.add(k), true); });
    const comprobantes = sumar(efectivo);
    const suma = r2(comprobantes.reduce((a, c) => a + c.importe, 0));
    const base = { sede: dia.sede, fechaVenta: dia.fecha, medio: "EFECTIVO (depósito)", sumaComprobantes: suma, comprobantes };
    if (!deps.length) {
      operaciones.push({ ...base, banco: "", operacion: "", fechaOperacion: "", horaOperacion: "", montoVoucher: null, diferencia: null, estado: "Sin voucher", obs: sinPdf || "No se reconoció un voucher de depósito en los PDF del Drive de ese día.", archivo: "" });
    } else {
      const monto = r2(deps.reduce((a, v) => a + (v.monto ?? 0), 0)), dif = r2(monto - suma);
      const sinNumero = deps.some((v) => !v.operacion);
      const obs = [
        Math.abs(dif) >= 0.01 ? `El depósito es ${dif < 0 ? "MENOR" : "MAYOR"} que el efectivo del día en S/ ${Math.abs(dif).toFixed(2)}.` : "",
        deps.length > 1 ? `${deps.length} depósitos para el efectivo de este día.` : "",
        sinNumero ? "No se pudo leer el N° de operación del voucher: revisarlo en el PDF." : "",
        deps.some((v) => v.operacion.startsWith("CLAVE")) ? "Voucher de ventanilla: no trae N° de operación, se muestra su CLAVE." : "",
        ...deps.map((v) => v.nota).filter(Boolean).map((n) => `Nota del voucher: ${n}`),
      ].filter(Boolean).join(" ");
      operaciones.push({
        ...base, banco: Array.from(new Set(deps.map((v) => v.banco).filter(Boolean))).join(" + "),
        operacion: deps.map((v) => v.operacion || "(sin leer)").join(" + "), fechaOperacion: deps[0].fecha, horaOperacion: deps[0].hora,
        montoVoucher: monto, diferencia: dif, estado: Math.abs(dif) < 0.01 ? "Cuadra" : "Diferencia", obs,
        archivo: Array.from(new Set(deps.map((v) => v.archivo))).join(" · "),
      });
    }
  }
  return { operaciones, sinOperacion };
}

/** Lee los archivos de UNA sede (rutas "AAAA-MM-DD/…") y arma la relación completa. */
export async function analizarCarpetaCaja(archivos: Record<string, Uint8Array>, lector: { leer: (img: Buffer) => Promise<string> }): Promise<ResultadoOperaciones> {
  const avisos: string[] = [];
  const dias = new Map<string, { xlsx?: Uint8Array; pdfs: { nombre: string; data: Uint8Array }[]; hayDrive: boolean }>();
  for (const [ruta, data] of Object.entries(archivos)) {
    const m = /(?:^|\/)(\d{4}-\d{2}-\d{2})\/(.+)$/.exec(ruta.replace(/\\/g, "/"));
    if (!m) continue;
    const d = dias.get(m[1]) ?? dias.set(m[1], { pdfs: [], hayDrive: false }).get(m[1])!;
    const nombre = m[2];
    if (/^drive\//i.test(nombre)) d.hayDrive = true;
    if (!nombre.includes("/") && /\.xlsx$/i.test(nombre)) d.xlsx = data;
    // Del Drive interesan los vouchers; "REPORTE …pdf" es el reporte del día escaneado y los Yape van en el Excel.
    else if (/^drive\/[^/]+\.pdf$/i.test(nombre) && !/^drive\/REPORTE/i.test(nombre)) d.pdfs.push({ nombre: nombre.slice(6), data });
  }
  const res: ResultadoOperaciones = { sede: "", dias: 0, comprobantes: 0, total: 0, operaciones: [], sinOperacion: [], otros: [], avisos };
  for (const fecha of Array.from(dias.keys()).sort()) {
    const d = dias.get(fecha)!;
    if (!d.xlsx) { avisos.push(`${fecha}: falta el Excel del reporte de caja.`); continue; }
    const dia = await leerReporteCaja(d.xlsx, fecha).catch(() => null);
    if (!dia) { avisos.push(`${fecha}: no se pudo leer el Excel del reporte de caja.`); continue; }
    if (!res.sede) res.sede = dia.sede;
    res.dias++; res.comprobantes += new Set(dia.filas.map((f) => f.comprobante)).size; res.total = r2(res.total + dia.filas.reduce((a, f) => a + f.importe, 0));
    const vouchers: Voucher[] = [];
    if (dia.filas.some((f) => esEfectivo(f.tipoPago))) {
      for (const p of d.pdfs.slice(0, 6)) {
        const paginas = await paginasDelPdf(Buffer.from(p.data)).catch(() => [] as Buffer[]);
        if (!paginas.length) avisos.push(`${fecha}: no se pudo abrir "${p.nombre}".`);
        for (const [i, img] of paginas.entries()) {
          const v = { ...leerVoucher(await lector.leer(img), fecha), archivo: p.nombre, pagina: i + 1 };
          vouchers.push(v);
          if (v.tipo === "otro") res.otros.push({ fecha, archivo: p.nombre, pagina: i + 1, resumen: v.resumen });
        }
      }
    }
    const sinPdf = !d.hayDrive ? "La sede no subió nada a la carpeta de Drive de ese día." : !d.pdfs.length ? "La carpeta de Drive de ese día no tiene un PDF de depósito." : "";
    const r = operacionesDelDia(dia, vouchers, sinPdf);
    res.operaciones.push(...r.operaciones); res.sinOperacion.push(...r.sinOperacion);
  }
  if (!res.dias) avisos.push("No se encontró ninguna carpeta de día (AAAA-MM-DD) con su Excel: ¿es un ZIP del utilitario Caja virtual?");
  return res;
}

// ---------------------------------------------------------------- Excel
const fch = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split("-").reverse().join("/") : iso);
export async function excelOperaciones(sedes: ResultadoOperaciones[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const AZUL = "FF102B4D";
  const cab = (ws: ExcelJS.Worksheet) => { ws.getRow(1).eachCell((c) => { c.font = { bold: true, color: { argb: "FFFFFFFF" } }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AZUL } }; c.alignment = { vertical: "middle", wrapText: true }; }); ws.views = [{ state: "frozen", ySplit: 1 }]; };
  const color = (row: ExcelJS.Row, estado: string) => { const c = estado === "Diferencia" ? "FFFDE2E2" : estado === "Sin voucher" ? "FFFEF3C7" : null; if (c) row.eachCell({ includeEmpty: true }, (x) => { x.fill = { type: "pattern", pattern: "solid", fgColor: { argb: c } }; }); };

  // Hoja 1: una fila por COMPROBANTE con la operación a la que pertenece.
  const d = wb.addWorksheet("Comprobantes por operación");
  d.columns = [{ header: "Sede", width: 20 }, { header: "Fecha de venta", width: 13 }, { header: "Medio de pago", width: 20 }, { header: "Banco", width: 10 }, { header: "N° de operación", width: 24 },
    { header: "Fecha de la operación", width: 14 }, { header: "Monto de la operación (voucher)", width: 17 }, { header: "Tipo", width: 7 }, { header: "Comprobante", width: 16 }, { header: "Importe del comprobante", width: 15 }, { header: "Estado", width: 18 }, { header: "Observación", width: 70 }];
  cab(d);
  // Hoja 2: una fila por OPERACIÓN.
  const o = wb.addWorksheet("Operaciones");
  o.columns = [{ header: "Sede", width: 20 }, { header: "Fecha de venta", width: 13 }, { header: "Medio de pago", width: 20 }, { header: "Banco", width: 10 }, { header: "N° de operación", width: 24 }, { header: "Fecha de la operación", width: 14 }, { header: "Hora", width: 9 },
    { header: "Monto del voucher", width: 14 }, { header: "Suma de comprobantes", width: 15 }, { header: "Diferencia", width: 12 }, { header: "N° de comprobantes", width: 12 }, { header: "Comprobantes", width: 60 }, { header: "Estado", width: 18 }, { header: "Observación", width: 70 }, { header: "Archivo del voucher", width: 30 }];
  cab(o);
  for (const s of sedes) for (const op of s.operaciones) {
    const ro = o.addRow([op.sede, fch(op.fechaVenta), op.medio, op.banco, op.operacion, fch(op.fechaOperacion), op.horaOperacion, op.montoVoucher, op.sumaComprobantes, op.diferencia, op.comprobantes.length,
      op.comprobantes.map((c) => c.comprobante).join(", "), op.estado, op.obs, op.archivo]);
    color(ro, op.estado);
    for (const c of op.comprobantes) color(d.addRow([op.sede, fch(op.fechaVenta), op.medio, op.banco, op.operacion, fch(op.fechaOperacion), op.montoVoucher, c.tipoDoc, c.comprobante, c.importe, op.estado, op.obs]), op.estado);
  }
  [7, 10].forEach((i) => (d.getColumn(i).numFmt = "#,##0.00")); [8, 9, 10].forEach((i) => (o.getColumn(i).numFmt = "#,##0.00"));
  d.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 12 } }; o.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 15 } };

  // Hoja 3: resumen por sede.
  const r = wb.addWorksheet("Resumen");
  r.columns = [{ header: "Sede", width: 22 }, { header: "Días", width: 7 }, { header: "Comprobantes", width: 13 }, { header: "Total cobrado", width: 14 }, { header: "Efectivo", width: 13 }, { header: "Depositado (vouchers)", width: 16 },
    { header: "Depósitos que cuadran", width: 14 }, { header: "Con diferencia", width: 12 }, { header: "Días sin voucher", width: 12 }, { header: "Otras operaciones (Yape, depósito, Visa)", width: 18 }];
  cab(r);
  for (const s of sedes) {
    const ef = s.operaciones.filter((x) => x.medio.startsWith("EFECTIVO"));
    r.addRow([s.sede, s.dias, s.comprobantes, s.total, r2(ef.reduce((a, x) => a + x.sumaComprobantes, 0)), r2(ef.reduce((a, x) => a + (x.montoVoucher ?? 0), 0)),
      ef.filter((x) => x.estado === "Cuadra").length, ef.filter((x) => x.estado === "Diferencia").length, ef.filter((x) => x.estado === "Sin voucher").length, s.operaciones.length - ef.length]);
  }
  [4, 5, 6].forEach((i) => (r.getColumn(i).numFmt = "#,##0.00"));
  // Hoja 4: lo que no tiene operación.
  const sin = sedes.flatMap((s) => s.sinOperacion.map((x) => [s.sede, fch(x.fecha), x.tipoDoc, x.comprobante, x.importe, x.motivo]));
  if (sin.length) { const w = wb.addWorksheet("Sin operación"); w.columns = [{ header: "Sede", width: 20 }, { header: "Fecha", width: 12 }, { header: "Tipo", width: 7 }, { header: "Comprobante", width: 16 }, { header: "Importe", width: 12 }, { header: "Motivo", width: 46 }]; cab(w); for (const f of sin) w.addRow(f); w.getColumn(5).numFmt = "#,##0.00"; }
  const otros = sedes.flatMap((s) => s.otros.map((x) => [s.sede, fch(x.fecha), x.archivo, x.pagina, x.resumen]));
  if (otros.length) { const w = wb.addWorksheet("Otros documentos del Drive"); w.columns = [{ header: "Sede", width: 20 }, { header: "Fecha", width: 12 }, { header: "Archivo", width: 40 }, { header: "Página", width: 8 }, { header: "Qué es (primera línea leída)", width: 70 }]; cab(w); for (const f of otros) w.addRow(f); }
  const av = sedes.flatMap((s) => s.avisos.map((a) => [s.sede, a]));
  if (av.length) { const w = wb.addWorksheet("Avisos"); w.columns = [{ header: "Sede", width: 20 }, { header: "Aviso", width: 100 }]; cab(w); for (const f of av) w.addRow(f); }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
