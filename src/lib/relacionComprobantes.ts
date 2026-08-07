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
  ws.getColumn("monto").numFmt = "#,##0.00";
  // Filas vacías para pegar los datos reales. (NO se pone fila de ejemplo aquí
  // a propósito: si el usuario sube la plantilla sin llenar, no se descarga
  // nada — así no se cuela el comprobante de ejemplo por error.)
  for (let i = 0; i < 40; i++) ws.addRow({});

  const ins = wb.addWorksheet("Instrucciones");
  ins.columns = [{ header: "Cómo llenar la plantilla", key: "t", width: 90 }] as any;
  ins.getRow(1).font = { bold: true };
  [
    "1) Llena una fila por cada comprobante RECIBIDO (compra) que quieras descargar.",
    "2) RUC Emisor: el RUC del proveedor que te emitió la factura/boleta.",
    "3) Tipo: 01 = Factura · 03 = Boleta · 07 = Nota de Crédito · 08 = Nota de Débito.",
    "4) Serie y Número: tal cual salen en el comprobante (ej. Serie E001, Número 448).",
    "5) Fecha Emisión: dd/mm/aaaa.  ·  6) Monto Total: el importe con IGV.",
    "",
    "EJEMPLO (una fila real): RUC 20126931680 | Tipo 01 | Serie E001 | Número 448 | 02/01/2026 | 2100.00",
    "",
    "IMPORTANTE: el comprobante debe EXISTIR en SUNAT (que puedas verlo en la",
    "Consulta de Comprobantes). Si pones datos inventados, SUNAT no lo encuentra.",
  ].forEach((t) => ins.addRow({ t }));

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

/** Genera la plantilla YA LLENA con la relaci\u00f3n dada (mismas columnas que la
 *  plantilla en blanco), lista para subir tal cual al m\u00f3dulo de Comprobantes XML. */
export async function plantillaRelacionLlenaXlsx(items: ItemRelacion[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Relaci\u00f3n");
  ws.columns = COLS as any;
  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF102B4D" } };
  ws.getColumn("monto").numFmt = "#,##0.00";
  for (const it of items) {
    ws.addRow({ rucEmisor: it.rucEmisor, tipo: it.tipo, serie: it.serie, numero: it.numero, fecha: it.fecha, monto: it.monto || 0 });
  }
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

const norm = (s: any) =>
  String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Convierte el DETALLE SIRE de compras (columnas + filas de la propuesta RCE) en
 * una relaci\u00f3n de comprobantes para descargar sus XML. En compras, el emisor es
 * el PROVEEDOR: su RUC est\u00e1 en "Nro Doc Identidad".
 */
export function relacionDesdeSireCompras(columnas: string[], filas: string[][]): ItemRelacion[] {
  const H = (columnas ?? []).map(norm);
  const col = (pred: (h: string) => boolean) => H.findIndex(pred);
  const cCar = col((h) => h.includes("carsunat"));             // CAR SUNAT (autoritativo)
  const cRuc = col((h) => h.includes("nrodocidentidad"));      // RUC del proveedor
  const cTipo = col((h) => h.includes("tipocp"));               // Tipo CP/Doc.
  const cSerie = col((h) => h.includes("serie"));               // Serie del CDP
  const cNum = col((h) => h.includes("nrocp") || h.includes("nroinicial")); // N\u00ba inicial
  const cFecha = col((h) => h.includes("fechadeemision") || h === "fechaemision");
  const cMonto = col((h) => h.includes("totalcp"));
  const cel = (f: string[], i: number) => (i >= 0 ? String(f[i] ?? "").trim() : "");

  const items: ItemRelacion[] = [];
  for (const f of filas ?? []) {
    // Fuente AUTORITATIVA: el CAR SUNAT codifica RUC(11)+tipo(2)+serie(4)+correlativo.
    // As\u00ed serie y n\u00famero salen EXACTOS (evita errores de las columnas sueltas).
    const car = cel(f, cCar).replace(/\s/g, "");
    let rucCar = "", tipoCar = "", serieCar = "", numCar = "";
    if (/^\d{11}\d{2}[A-Za-z0-9]{4}\d{1,}$/.test(car)) {
      rucCar = car.slice(0, 11);
      tipoCar = car.slice(11, 13);
      serieCar = car.slice(13, 17).toUpperCase();
      numCar = car.slice(17).replace(/^0+/, "") || "0";
    }
    // Respaldo: columnas dedicadas si el CAR no calza.
    const rucEmisor = (cel(f, cRuc).replace(/\D/g, "")) || rucCar;
    const tipo = tipoCar || (cel(f, cTipo).replace(/\D/g, "").padStart(2, "0").slice(-2)) || "01";
    const serie = serieCar || cel(f, cSerie).toUpperCase();
    const numero = numCar || cel(f, cNum).replace(/^0+/, "") || cel(f, cNum);
    if (!rucEmisor && !serie && !numero) continue;
    items.push({
      rucEmisor,
      tipo: tipo || "01",
      serie,
      numero,
      fecha: cel(f, cFecha),
      monto: Number(cel(f, cMonto).replace(/[^\d.-]/g, "")) || 0,
    });
  }
  return items;
}

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
