// ============================================================
//  PDF de estado de cuenta bancario (BCP) → Word (.docx)
// ============================================================
// Lee el PDF del banco (capa de texto), extrae los movimientos y arma un Word con
// la estructura de conciliación:
//   FECHA · DESCRIPCIÓN · NUM OP · HORA · CARGO / ABONO · SALDO CONTABLE · CONCILIACIÓN
// SALDO CONTABLE = saldo corrido (saldo inicial + movimientos). CONCILIACIÓN queda
// en blanco para llenar a mano.

const MED_AT = /\b(VEN|CAJ|POS|TLC|INT|BPT|BPI)\b/;

export interface MovBanco {
  fecha: string;      // "02-01"
  descripcion: string;
  numOp: string;
  hora: string;       // "10:55"
  monto: number;      // + abono, - cargo
  saldo: number;      // saldo corrido
}
export interface EstadoBanco {
  empresa: string;
  cuenta: string;
  periodo: string;
  saldoInicial: number;
  movimientos: MovBanco[];
}

const num = (s: string): number => {
  const neg = /-\s*$/.test(s);
  const n = Number(String(s).replace(/[^\d.]/g, ""));
  return (Number.isFinite(n) ? n : 0) * (neg ? -1 : 1);
};

/** Extrae el texto del PDF (unpdf, sin OCR). */
export async function textoDePdf(buffer: Buffer): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: true });
  return Array.isArray(text) ? text.join("\n") : text;
}

/** Parsea el estado de cuenta BCP a movimientos + saldo corrido. */
export function parseEstadoBcp(texto: string): EstadoBanco {
  const t = texto.replace(/\s+/g, " ").trim();

  // Datos de cabecera (best-effort).
  const empresa = (/([A-ZÑ&.,\- ]*S\.A\.C\.|[A-ZÑ&.,\- ]*E\.I\.R\.L\.|[A-ZÑ&.,\- ]*S\.A\b)/.exec(t)?.[1] || "").trim();
  const cuenta = (/\b(\d{3}-\d{7}-\d-\d{2})\b/.exec(t)?.[1] || /\b(\d{3}-\d{7,})\b/.exec(t)?.[1] || "").trim();
  const perM = /(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})/.exec(t);
  const periodo = perM ? `${perM[1]} al ${perM[2]}` : "";
  // Saldo inicial = 1er importe tras el rango de fechas del resumen.
  const saldoM = /(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})\s+([\d,]+\.\d{2})/.exec(t);
  const saldoInicial = saldoM ? num(saldoM[3]) : 0;

  // Movimientos: cada uno empieza con "dd-dd". Cortamos por ese patrón.
  const trozos = t.split(/(?=\b\d{2}-\d{2}\s)/).filter((x) => /^\d{2}-\d{2}\s/.test(x));
  const movimientos: MovBanco[] = [];
  let saldo = saldoInicial;
  for (const raw of trozos) {
    const chunk = raw.trim();
    const fecha = /^(\d{2}-\d{2})/.exec(chunk)?.[1] ?? "";
    if (!fecha) continue;
    // Monto = último importe del trozo (con signo por "-" final).
    const amts = [...chunk.matchAll(/([\d,]*\.\d{2})(-?)/g)];
    if (!amts.length) continue;
    const last = amts[amts.length - 1];
    const monto = num(last[1] + last[2]);
    const hora = /(\d{2}:\d{2})/.exec(chunk)?.[1] ?? "";
    // Descripción = entre la fecha y el "medio de atención".
    const med = MED_AT.exec(chunk);
    const desc = (med ? chunk.slice(fecha.length, med.index) : chunk.slice(fecha.length)).replace(/\s+/g, " ").trim();
    // NUM OP = último bloque de 6 dígitos antes de la hora.
    let numOp = "";
    if (hora) {
      const pre = chunk.slice(0, chunk.indexOf(hora));
      const seis = pre.match(/\b\d{6}\b/g);
      if (seis) numOp = seis[seis.length - 1];
    }
    saldo = +(saldo + monto).toFixed(2);
    movimientos.push({ fecha, descripcion: desc, numOp, hora, monto, saldo });
  }
  return { empresa, cuenta, periodo, saldoInicial, movimientos };
}

const soles = (n: number): string =>
  (n < 0 ? "-" : "") + Math.abs(n).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Genera el Excel (.xlsx) con la misma estructura de conciliación (montos como
 *  número, columna CONCILIACIÓN en blanco). */
export async function excelEstadoBanco(est: EstadoBanco): Promise<Buffer> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Radar Tributar IA";
  const ws = wb.addWorksheet(est.cuenta ? est.cuenta.slice(-4) : "Banco");

  ws.columns = [
    { header: "FECHA", key: "fecha", width: 9 },
    { header: "DESCRIPCIÓN", key: "desc", width: 30 },
    { header: "NUM OP", key: "op", width: 11 },
    { header: "HORA", key: "hora", width: 8 },
    { header: "CARGO / ABONO", key: "monto", width: 15 },
    { header: "SALDO CONTABLE", key: "saldo", width: 16 },
    { header: "CONCILIACIÓN", key: "conc", width: 40 },
  ];
  for (const m of est.movimientos) {
    const row = ws.addRow({ fecha: m.fecha, desc: m.descripcion, op: m.numOp, hora: m.hora, monto: m.monto, saldo: m.saldo, conc: "" });
    row.getCell("monto").numFmt = "#,##0.00;[Red]-#,##0.00";
    row.getCell("saldo").numFmt = "#,##0.00";
  }
  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A8A" } };
  ws.getRow(1).alignment = { horizontal: "center" };
  ws.views = [{ state: "frozen", ySplit: 1 }];

  const ab = await wb.xlsx.writeBuffer();
  return Buffer.from(ab);
}

/** Genera el Word (.docx) con la tabla de conciliación. */
export async function wordEstadoBanco(est: EstadoBanco): Promise<Buffer> {
  const docx = await import("docx");
  const { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun, WidthType, AlignmentType, HeadingLevel, BorderStyle } = docx as any;

  const COLS = ["FECHA", "DESCRIPCIÓN", "NUM OP", "HORA", "CARGO / ABONO", "SALDO CONTABLE", "CONCILIACIÓN"];
  const anchos = [9, 26, 10, 8, 13, 14, 20];

  const celda = (txt: string, opts: { bold?: boolean; align?: any; fill?: string } = {}) =>
    new TableCell({
      shading: opts.fill ? { fill: opts.fill } : undefined,
      margins: { top: 40, bottom: 40, left: 60, right: 60 },
      children: [new Paragraph({
        alignment: opts.align,
        children: [new TextRun({ text: txt, bold: opts.bold, size: 16 })],
      })],
    });

  const headRow = new TableRow({
    tableHeader: true,
    children: COLS.map((c, i) => new TableCell({
      width: { size: anchos[i], type: WidthType.PERCENTAGE },
      shading: { fill: "1E3A8A" },
      margins: { top: 40, bottom: 40, left: 60, right: 60 },
      children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: c, bold: true, color: "FFFFFF", size: 16 })] })],
    })),
  });

  const filas = est.movimientos.map((m) => new TableRow({
    children: [
      celda(m.fecha, { align: AlignmentType.CENTER }),
      celda(m.descripcion),
      celda(m.numOp, { align: AlignmentType.CENTER }),
      celda(m.hora, { align: AlignmentType.CENTER }),
      celda(soles(m.monto), { align: AlignmentType.RIGHT }),
      celda(soles(m.saldo), { align: AlignmentType.RIGHT }),
      celda("", {}),
    ],
  }));

  const tabla = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 2, color: "BBBBBB" },
      bottom: { style: BorderStyle.SINGLE, size: 2, color: "BBBBBB" },
      left: { style: BorderStyle.SINGLE, size: 2, color: "BBBBBB" },
      right: { style: BorderStyle.SINGLE, size: 2, color: "BBBBBB" },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: "DDDDDD" },
      insideVertical: { style: BorderStyle.SINGLE, size: 1, color: "DDDDDD" },
    },
    rows: [headRow, ...filas],
  });

  const encabezado: any[] = [
    new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: "Conciliación bancaria", bold: true })] }),
  ];
  if (est.empresa) encabezado.push(new Paragraph({ children: [new TextRun({ text: est.empresa, bold: true, size: 20 })] }));
  const sub = [est.cuenta && `Cuenta: ${est.cuenta}`, est.periodo && `Periodo: ${est.periodo}`, `Saldo inicial: S/ ${soles(est.saldoInicial)}`].filter(Boolean).join("   ·   ");
  encabezado.push(new Paragraph({ children: [new TextRun({ text: sub, size: 16, color: "555555" })] }));
  encabezado.push(new Paragraph({ children: [new TextRun({ text: "", size: 8 })] }));

  const doc = new Document({
    sections: [{
      properties: { page: { size: { orientation: "landscape" } } },
      children: [...encabezado, tabla],
    }],
  });
  const buf = await Packer.toBuffer(doc);
  return Buffer.from(buf);
}
