import ExcelJS from "exceljs";

// ============================================================
//  Relación de comprobantes a descargar (plantilla + parseo)
// ============================================================
// El usuario descarga una plantilla Excel, la llena con los comprobantes que
// quiere bajar (los mismos datos que pide SUNAT para identificar un CPE) y la
// sube. Cada fila = un comprobante recibido cuyo XML se descargará.

export interface ItemRelacion {
  rucEmisor: string;   // RUC del proveedor que emitió el comprobante
  tipo: string;        // 01 Factura · 03 Boleta · 07 N. Crédito · 08 N. Débito
  serie: string;       // p. ej. F001
  numero: string;      // p. ej. 1234
  fecha: string;       // dd/mm/aaaa (emisión)
  monto: number;       // total (para validar en SUNAT; opcional)
}

// Columnas de la plantilla (encabezado exacto de la 1ª fila).
const COLS = [
  { header: "RUC Emisor", key: "rucEmisor", width: 16 },
  { header: "Tipo (01/03/07/08)", key: "tipo", width: 18 },
  { header: "Serie", key: "serie", width: 12 },
  { header: "Número", key: "numero", width: 14 },
  { header: "Fecha Emisión (dd/mm/aaaa)", key: "fecha", width: 24 },
  { header: "Monto Total", key: "monto", width: 14 },
];

/** Genera la plantilla Excel (encabezados + ejemplo + instrucciones). */
export async function plantillaRelacionXlsx(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Relación");
  ws.columns = COLS as any;
  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF102B4D" } };
  // Fila de ejemplo (se puede borrar).
  ws.addRow({ rucEmisor: "20123456789", tipo: "01", serie: "F001", numero: "1234", fecha: "15/06/2026", monto: 118.0 });
  ws.getColumn("monto").numFmt = "#,##0.00";
  // Deja algunas filas vacías con bordes para que sea cómodo pegar.
  for (let i = 0; i < 30; i++) ws.addRow({});

  const ins = wb.addWorksheet("Instrucciones");
  ins.columns = [{ header: "Cómo llenar la plantilla", key: "t", width: 90 }] as any;
  ins.getRow(1).font = { bold: true };
  [
    "1) Llena una fila por cada comprobante que quieras descargar.",
    "2) RUC Emisor: el RUC del proveedor que te emitió la factura/boleta.",
    "3) Tipo: 01 = Factura · 03 = Boleta · 07 = Nota de Crédito · 08 = Nota de Débito.",
    "4) Serie y Número: tal cual salen en el comprobante (ej. Serie F001, Número 1234).",
    "5) Fecha Emisión: dd/mm/aaaa.",
    "6) Monto Total: el importe total (con IGV). Ayuda a validar en SUNAT.",
    "7) Puedes borrar la fila de ejemplo. Guarda el archivo y súbelo en la plataforma.",
  ].forEach((t) => ins.addRow({ t }));

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

const norm = (s: any) =>
  String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Lee la relación subida (Excel). Mapea por encabezado (tolerante). */
export async function parseRelacionXlsx(buf: Buffer): Promise<ItemRelacion[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as any);
  const ws = wb.getWorksheet("Relación") ?? wb.worksheets[0];
  if (!ws) return [];

  // Ubica las columnas por su encabezado (1ª fila).
  const headerRow = ws.getRow(1);
  const idx: Record<string, number> = {};
  headerRow.eachCell((cell, col) => {
    const h = norm(cell.value);
    if (h.includes("ruc")) idx.rucEmisor = col;
    else if (h.includes("tipo")) idx.tipo = col;
    else if (h.includes("serie")) idx.serie = col;
    else if (h.includes("numero")) idx.numero = col;
    else if (h.includes("fecha")) idx.fecha = col;
    else if (h.includes("monto") || h.includes("total") || h.includes("importe")) idx.monto = col;
  });

  const cel = (row: ExcelJS.Row, col?: number) => (col ? String(row.getCell(col).value ?? "").trim() : "");
  const items: ItemRelacion[] = [];
  ws.eachRow((row, n) => {
    if (n === 1) return; // encabezado
    const rucEmisor = cel(row, idx.rucEmisor).replace(/\D/g, "");
    const serie = cel(row, idx.serie).toUpperCase();
    const numero = cel(row, idx.numero).replace(/^0+/, "") || cel(row, idx.numero);
    if (!rucEmisor && !serie && !numero) return; // fila vacía
    items.push({
      rucEmisor,
      tipo: cel(row, idx.tipo).replace(/\D/g, "").padStart(2, "0").slice(-2) || "01",
      serie,
      numero,
      fecha: cel(row, idx.fecha),
      monto: Number(cel(row, idx.monto).replace(/[^\d.-]/g, "")) || 0,
    });
  });
  return items;
}
