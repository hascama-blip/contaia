import ExcelJS from "exceljs";
import { parseFacturaXml, BIENES_DETRACCION, MEDIOS_PAGO, type FacturaXml } from "./facturaXml";
import { parseFacturaPdf } from "./facturaPdf";

// ============================================================
//  Excel completo de la Descarga masiva de comprobantes
// ============================================================
// Hoja "Comprobantes": UNA fila por factura con cabecera, desglose de importes,
// detracción y glosa (columnas A–AH). Hoja "Ítems": una fila por línea. Hoja
// "Faltantes": la relación de los comprobantes que NO se pudieron bajar, con
// el motivo, para reintentarlos (mismo formato de la plantilla).

const HEADER_FILL = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FF102B4D" } };
const HEADER_FONT = { bold: true, color: { argb: "FFFFFFFF" } };
const FALT_FILL = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFB45309" } };

export interface FaltanteExcel {
  rucEmisor?: string; tipo?: string; serie?: string; numero?: string; fecha?: string; monto?: number;
  razonSocial?: string; motivo?: string;
}

const TIPO_NOMBRE: Record<string, string> = {
  "01": "Factura electrónica", "03": "Boleta de venta", "07": "Nota de crédito", "08": "Nota de débito",
  "14": "Recibo de servicios públicos", "02": "Recibo por honorarios",
};

/**
 * Normaliza cada comprobante a la estructura completa: si trae el XML crudo lo
 * vuelve a parsear (para tener detracción, forma de pago, etc. aunque se haya
 * extraído con una versión anterior); si solo trae el PDF oficial, lee su texto.
 */
export async function completarComprobantes(rows: any[]): Promise<FacturaXml[]> {
  const out: FacturaXml[] = [];
  for (const r of rows) {
    let f: FacturaXml | null = null;
    if (typeof r?.xmlBase64 === "string" && r.xmlBase64) {
      try { f = parseFacturaXml(Buffer.from(r.xmlBase64, "base64").toString("utf8")); } catch { f = null; }
    }
    if (!f && !Array.isArray(r?.lineas) && typeof r?.pdfBase64 === "string" && r.pdfBase64) {
      try {
        f = await parseFacturaPdf(Buffer.from(r.pdfBase64, "base64"), {
          rucEmisor: r.rucEmisor, razonSocialEmisor: r.razonSocialEmisor, tipoDoc: r.tipoDoc,
          serie: r.serie, numero: r.numero, serieNumero: r.serieNumero,
        });
      } catch { f = null; }
    }
    // Conserva lo que ya venía (p. ej. razón social del emisor desde SUNAT) si el parseo no lo trajo.
    const base: any = f ? { ...r, ...f } : { ...r, fuente: r?.fuente ?? (Array.isArray(r?.lineas) ? "xml" : "pdf") };
    for (const k of ["razonSocialEmisor", "rucEmisor", "serieNumero", "serie", "numero", "tipoDoc", "fecha"]) {
      if (!base[k] && r?.[k]) base[k] = r[k];
    }
    if (!base.serieNumero && base.serie) base.serieNumero = `${base.serie}-${base.numero ?? ""}`;
    delete base.xmlBase64; delete base.pdfBase64;
    out.push(base as FacturaXml);
  }
  // Orden: fecha (dd/mm/aaaa o aaaa-mm-dd) y luego serie-número.
  const clave = (f: FacturaXml) => {
    const m = String(f.fecha ?? "").match(/(\d{2})\/(\d{2})\/(\d{4})/);
    return (m ? `${m[3]}${m[2]}${m[1]}` : String(f.fecha ?? "")) + "|" + (f.serieNumero ?? "");
  };
  return out.sort((a, b) => clave(a).localeCompare(clave(b)));
}

function n2(x: any): number { const n = Number(x); return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0; }
/** Fecha uniforme dd/mm/aaaa (el XML trae aaaa-mm-dd; el PDF, dd/mm/aaaa). */
function fechaDMY(s: any): string {
  const v = String(s ?? "").trim();
  const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? `${iso[3]}/${iso[2]}/${iso[1]}` : v;
}

export async function excelComprobantesCompleto(
  rows: any[],
  faltantes: FaltanteExcel[],
  opts: { periodo?: string; empresa?: string } = {},
): Promise<Buffer> {
  const facturas = await completarComprobantes(rows);
  const wb = new ExcelJS.Workbook();
  wb.creator = "Radar Tributario";

  // ---------------- Hoja 0: Resumen (se crea primero, se llena al final) ----------------
  const wr = wb.addWorksheet("Resumen");

  // ---------------- Hoja 1: Comprobantes (A–AH) ----------------
  const wc = wb.addWorksheet("Comprobantes", { views: [{ state: "frozen", ySplit: 1, xSplit: 4 }] });
  wc.columns = [
    { header: "Fecha emisión", key: "fecha", width: 12 },                 // A
    { header: "Tipo", key: "tipo", width: 20 },                           // B
    { header: "Cód.", key: "tipoDoc", width: 6 },                         // C
    { header: "Serie-Número", key: "serieNumero", width: 16 },            // D
    { header: "RUC emisor", key: "rucEmisor", width: 13 },                // E
    { header: "Razón social emisor", key: "razonSocialEmisor", width: 36 }, // F
    { header: "Dirección emisor", key: "direccionEmisor", width: 40 },    // G
    { header: "RUC receptor", key: "rucReceptor", width: 13 },            // H
    { header: "Razón social receptor", key: "razonSocialReceptor", width: 36 }, // I
    { header: "Dirección receptor", key: "direccionReceptor", width: 40 }, // J
    { header: "Moneda", key: "moneda", width: 8 },                        // K
    { header: "Forma de pago", key: "formaPago", width: 16 },             // L
    { header: "Op. gravadas", key: "gravado", width: 13 },                // M
    { header: "Op. exoneradas", key: "exonerado", width: 13 },            // N
    { header: "Op. inafectas", key: "inafecto", width: 13 },              // O
    { header: "Op. gratuitas", key: "gratuito", width: 13 },              // P
    { header: "Anticipos", key: "anticipos", width: 11 },                 // Q
    { header: "Descuentos", key: "descuento", width: 11 },                // R
    { header: "ISC", key: "isc", width: 10 },                             // S
    { header: "IGV", key: "igv", width: 12 },                             // T
    { header: "ICBPER", key: "icbper", width: 10 },                       // U
    { header: "Otros cargos", key: "otrosCargos", width: 12 },            // V
    { header: "Otros tributos", key: "otrosTributos", width: 12 },        // W
    { header: "Redondeo", key: "redondeo", width: 10 },                   // X
    { header: "Importe total", key: "total", width: 14 },                 // Y
    { header: "Detracción", key: "detSi", width: 11 },                    // Z
    { header: "Cód. bien/servicio", key: "detCodigo", width: 34 },        // AA
    { header: "% detracción", key: "detPct", width: 12 },                 // AB
    { header: "Monto detracción", key: "detMonto", width: 15 },           // AC
    { header: "Neto a pagar", key: "neto", width: 14 },                   // AD
    { header: "Cta. Banco de la Nación", key: "detCuenta", width: 20 },   // AE
    { header: "Medio de pago", key: "detMedio", width: 24 },              // AF
    { header: "Glosa", key: "glosa", width: 60 },                         // AG
    { header: "Fuente", key: "fuente", width: 8 },                        // AH
  ];
  wc.getRow(1).font = HEADER_FONT;
  wc.getRow(1).fill = HEADER_FILL;
  wc.getRow(1).alignment = { vertical: "middle", wrapText: true };
  wc.getRow(1).height = 30;

  for (const f of facturas) {
    const d = f.detraccion;
    const total = n2(f.total);
    const detMonto = d ? n2(d.monto) : 0;
    const tipoNombre = TIPO_NOMBRE[f.tipoDoc] ?? (f.tipo || "");
    wc.addRow({
      fecha: fechaDMY(f.fecha), tipo: tipoNombre, tipoDoc: f.tipoDoc ?? "", serieNumero: f.serieNumero ?? "",
      rucEmisor: f.rucEmisor ?? "", razonSocialEmisor: f.razonSocialEmisor ?? "", direccionEmisor: f.direccionEmisor ?? "",
      rucReceptor: f.rucReceptor ?? "", razonSocialReceptor: f.razonSocialReceptor ?? "", direccionReceptor: f.direccionReceptor ?? "",
      moneda: f.moneda ?? "", formaPago: f.formaPago ?? "",
      gravado: n2(f.gravado), exonerado: n2(f.exonerado), inafecto: n2(f.inafecto), gratuito: n2(f.gratuito),
      anticipos: n2(f.anticipos), descuento: n2(f.descuento), isc: n2(f.isc), igv: n2(f.igv), icbper: n2(f.icbper),
      otrosCargos: n2(f.otrosCargos), otrosTributos: n2(f.otrosTributos), redondeo: n2(f.redondeo), total,
      detSi: d ? "Sí" : "No",
      detCodigo: d ? [d.codigo, BIENES_DETRACCION[d.codigo]].filter(Boolean).join(" ") : "",
      detPct: d ? n2(d.porcentaje) : null,
      detMonto: d ? detMonto : null,
      neto: d ? n2(total - detMonto) : total,
      detCuenta: d ? d.cuenta : "",
      detMedio: d && d.medioPago ? [d.medioPago, MEDIOS_PAGO[d.medioPago]].filter(Boolean).join(" ") : "",
      glosa: f.glosa ?? "",
      fuente: (f.fuente ?? "xml").toUpperCase(),
    });
  }
  ["gravado", "exonerado", "inafecto", "gratuito", "anticipos", "descuento", "isc", "igv", "icbper", "otrosCargos",
    "otrosTributos", "redondeo", "total", "detPct", "detMonto", "neto"].forEach((k) => (wc.getColumn(k).numFmt = "#,##0.00"));
  // Fila de totales.
  if (facturas.length) {
    const tr = wc.addRow({ serieNumero: `TOTAL (${facturas.length})` });
    tr.font = { bold: true };
    for (const k of ["gravado", "exonerado", "inafecto", "gratuito", "anticipos", "descuento", "isc", "igv", "icbper", "otrosCargos", "otrosTributos", "redondeo", "total", "detMonto", "neto"]) {
      const col = wc.getColumn(k).letter;
      tr.getCell(k).value = { formula: `SUM(${col}2:${col}${facturas.length + 1})` } as any;
      tr.getCell(k).numFmt = "#,##0.00";
    }
  }
  wc.autoFilter = { from: "A1", to: `AH${Math.max(2, facturas.length + 1)}` };

  // ---------------- Hoja 2: Ítems (A–M) ----------------
  const wi = wb.addWorksheet("Ítems", { views: [{ state: "frozen", ySplit: 1 }] });
  wi.columns = [
    { header: "Serie-Número", key: "serieNumero", width: 16 },
    { header: "Fecha", key: "fecha", width: 12 },
    { header: "RUC emisor", key: "rucEmisor", width: 13 },
    { header: "Emisor", key: "razonSocialEmisor", width: 34 },
    { header: "#", key: "numero", width: 5 },
    { header: "Cantidad", key: "cantidad", width: 10 },
    { header: "Unidad", key: "unidad", width: 9 },
    { header: "Descripción", key: "descripcion", width: 60 },
    { header: "Valor unitario", key: "valorUnitario", width: 13 },
    { header: "Valor venta", key: "valor", width: 13 },
    { header: "IGV", key: "igv", width: 11 },
    { header: "ICBPER", key: "icbper", width: 9 },
    { header: "Total ítem", key: "totalItem", width: 13 },
    { header: "Código", key: "codigo", width: 14 },
    { header: "Afectación", key: "afectacion", width: 14 },
    { header: "Moneda", key: "moneda", width: 8 },
  ];
  wi.getRow(1).font = HEADER_FONT;
  wi.getRow(1).fill = HEADER_FILL;
  for (const f of facturas) {
    const lineas = Array.isArray(f.lineas) ? f.lineas : [];
    if (!lineas.length) {
      // Sin ítems reconocidos: una fila con la glosa para no perder el comprobante.
      wi.addRow({ serieNumero: f.serieNumero ?? "", fecha: fechaDMY(f.fecha), rucEmisor: f.rucEmisor ?? "", razonSocialEmisor: f.razonSocialEmisor ?? "",
        numero: 1, cantidad: null, unidad: "", descripcion: f.glosa || "(sin detalle de ítems)", valorUnitario: null,
        valor: n2(f.base || f.gravado), igv: n2(f.igv), icbper: n2(f.icbper), totalItem: n2(f.total), codigo: "", afectacion: "", moneda: f.moneda ?? "" });
      continue;
    }
    // ICBPER por ítem solo si el documento lo tiene y hay una sola línea (el XML no lo trae por línea).
    const icbItem = lineas.length === 1 ? n2(f.icbper) : 0;
    for (const l of lineas) {
      const valor = n2(l.valor), igv = n2(l.igv);
      wi.addRow({
        serieNumero: f.serieNumero ?? "", fecha: fechaDMY(f.fecha), rucEmisor: f.rucEmisor ?? "", razonSocialEmisor: f.razonSocialEmisor ?? "",
        numero: l.numero ?? "", cantidad: n2(l.cantidad), unidad: l.unidad ?? "", descripcion: l.descripcion ?? "",
        valorUnitario: n2(l.valorUnitario), valor, igv, icbper: icbItem, totalItem: n2(valor + igv + icbItem),
        codigo: l.codigo ?? "", afectacion: l.afectacion ?? "", moneda: f.moneda ?? "",
      });
    }
  }
  ["cantidad", "valorUnitario", "valor", "igv", "icbper", "totalItem"].forEach((k) => (wi.getColumn(k).numFmt = "#,##0.00"));
  wi.getColumn("descripcion").alignment = { wrapText: true, vertical: "top" };

  // ---------------- Hoja 3: Faltantes (solo si hay) ----------------
  if (faltantes.length) {
    const wf = wb.addWorksheet("Faltantes", { views: [{ state: "frozen", ySplit: 2 }] });
    wf.mergeCells("A1:H1");
    wf.getCell("A1").value = `⚠ ${faltantes.length} comprobante(s) NO descargado(s)${opts.periodo ? ` · periodo ${opts.periodo}` : ""}. Copia estas filas en la plantilla y vuelve a subirla para reintentar.`;
    wf.getCell("A1").font = { bold: true, color: { argb: "FF92400E" } };
    wf.getRow(2).values = ["RUC Emisor", "Tipo (01/03/07/08)", "Serie", "Número", "Fecha Emisión (dd/mm/aaaa)", "Monto Total", "Proveedor", "Motivo"];
    wf.getRow(2).font = HEADER_FONT;
    wf.getRow(2).fill = FALT_FILL;
    wf.columns = [
      { key: "rucEmisor", width: 16 }, { key: "tipo", width: 18 }, { key: "serie", width: 10 }, { key: "numero", width: 12 },
      { key: "fecha", width: 24 }, { key: "monto", width: 14 }, { key: "razonSocial", width: 36 }, { key: "motivo", width: 60 },
    ];
    for (const x of faltantes) {
      wf.addRow({
        rucEmisor: x.rucEmisor ?? "", tipo: x.tipo ?? "", serie: x.serie ?? "", numero: x.numero ?? "",
        fecha: x.fecha ?? "", monto: x.monto != null && x.monto !== ("" as any) ? n2(x.monto) : null,
        razonSocial: x.razonSocial ?? "", motivo: x.motivo ?? "No descargado",
      });
    }
    wf.getColumn("monto").numFmt = "#,##0.00";
  }

  // ---------------- Llenado de la hoja Resumen ----------------
  wr.columns = [{ key: "k", width: 34 }, { key: "v", width: 40 }];
  const sum = (k: keyof FacturaXml) => n2(facturas.reduce((a, f) => a + (Number(f[k]) || 0), 0));
  const conDet = facturas.filter((f) => f.detraccion);
  const filas: [string, any][] = [
    ["Empresa", opts.empresa ?? ""],
    ["Periodo", opts.periodo ?? "(relación subida)"],
    ["Generado", new Date().toLocaleString("es-PE")],
    ["Comprobantes descargados", facturas.length],
    ["Comprobantes faltantes", faltantes.length],
    ["Estado", faltantes.length ? `INCOMPLETO: revisa la hoja "Faltantes"` : "COMPLETO: toda la relación descargada"],
    ["Desde XML / desde PDF", `${facturas.filter((f) => (f.fuente ?? "xml") === "xml").length} / ${facturas.filter((f) => f.fuente === "pdf").length}`],
    ["Op. gravadas", sum("gravado")], ["IGV", sum("igv")], ["Importe total", sum("total")],
    ["Sujetos a detracción", conDet.length],
    ["Total detracciones", n2(conDet.reduce((a, f) => a + (f.detraccion?.monto ?? 0), 0))],
  ];
  for (const [k, v] of filas) { const r = wr.addRow({ k, v }); r.getCell(1).font = { bold: true }; if (typeof v === "number" && !Number.isInteger(v)) r.getCell(2).numFmt = "#,##0.00"; }
  if (faltantes.length) wr.getRow(6).getCell(2).font = { bold: true, color: { argb: "FFB45309" } };

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}
