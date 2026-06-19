import { XMLParser } from "fast-xml-parser";

// ============================================================
//  Lector de XML de comprobantes electrónicos (UBL 2.1 SUNAT)
// ============================================================
// Lee Factura / Boleta / Nota de crédito-débito y extrae el DETALLE
// (descripción, cantidad, valor por línea) + emisor, serie-número, fecha y
// montos. El XML es la fuente exacta y liviana (no usa OCR ni pdf.js).

const parser = new XMLParser({
  removeNSPrefix: true,
  ignoreAttributes: true,
  parseTagValue: true,
  trimValues: true,
});

export interface LineaXml {
  descripcion: string;
  cantidad: number;
  valor: number;
}

export interface FacturaXml {
  tipo: string;
  serie: string;
  numero: string;
  serieNumero: string;
  fecha: string;
  moneda: string;
  rucEmisor: string;
  razonSocialEmisor: string;
  rucReceptor: string;
  base: number;
  igv: number;
  total: number;
  lineas: LineaXml[];
  /** Glosa para contabilidad: descripciones de las líneas unidas. */
  glosa: string;
}

function asArray<T>(x: T | T[] | undefined): T[] {
  if (x === undefined || x === null) return [];
  return Array.isArray(x) ? x : [x];
}
function txt(x: any): string {
  if (x === undefined || x === null) return "";
  if (typeof x === "object") return String(x["#text"] ?? "");
  return String(x);
}
function num(x: any): number {
  const n = Number(txt(x).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** Parsea un XML UBL de comprobante. Devuelve null si no se reconoce. */
export function parseFacturaXml(xml: string): FacturaXml | null {
  let obj: any;
  try {
    obj = parser.parse(xml);
  } catch {
    return null;
  }
  const root = obj.Invoice ?? obj.CreditNote ?? obj.DebitNote;
  if (!root) return null;
  const tipo = obj.Invoice ? "Factura/Boleta" : obj.CreditNote ? "Nota de crédito" : "Nota de débito";

  const id = txt(root.ID); // "F001-00000123"
  const [serie, numero] = id.includes("-") ? [id.split("-")[0], id.split("-").slice(1).join("-")] : ["", id];

  const emisor = root.AccountingSupplierParty?.Party ?? {};
  const receptor = root.AccountingCustomerParty?.Party ?? {};
  const rucEmisor = txt(asArray(emisor.PartyIdentification)[0]?.ID);
  const razonSocialEmisor =
    txt(asArray(emisor.PartyLegalEntity)[0]?.RegistrationName) ||
    txt(asArray(emisor.PartyName)[0]?.Name);
  const rucReceptor = txt(asArray(receptor.PartyIdentification)[0]?.ID);

  // IGV: suma de TaxTotal/TaxAmount a nivel documento.
  const igv = asArray(root.TaxTotal).reduce((a: number, t: any) => a + num(t?.TaxAmount), 0);
  const mon = root.LegalMonetaryTotal ?? {};
  const base = num(mon.LineExtensionAmount);
  const total = num(mon.PayableAmount) || num(mon.TaxInclusiveAmount);

  const lineasRaw = asArray(root.InvoiceLine ?? root.CreditNoteLine ?? root.DebitNoteLine);
  const lineas: LineaXml[] = lineasRaw.map((l: any) => ({
    descripcion: asArray(l?.Item?.Description).map(txt).join(" ").trim(),
    cantidad: num(l?.InvoicedQuantity ?? l?.CreditedQuantity ?? l?.DebitedQuantity ?? l?.Quantity),
    valor: num(l?.LineExtensionAmount),
  }));
  const glosa = lineas
    .map((l) => l.descripcion)
    .filter(Boolean)
    .join("; ")
    .slice(0, 300);

  return {
    tipo,
    serie,
    numero,
    serieNumero: id,
    fecha: txt(root.IssueDate),
    moneda: txt(root.DocumentCurrencyCode) || "PEN",
    rucEmisor,
    razonSocialEmisor,
    rucReceptor,
    base,
    igv,
    total,
    lineas,
    glosa,
  };
}
