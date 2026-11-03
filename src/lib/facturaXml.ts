import { XMLParser } from "fast-xml-parser";

// ============================================================
//  Lector de XML de comprobantes electrónicos (UBL 2.1 SUNAT)
// ============================================================
// Lee Factura / Boleta / Nota de crédito-débito y extrae TODO el detalle:
// cabecera (emisor, receptor, montos por afectación) + cada ítem con su
// código, descripción, cantidad, unidad, valor unitario, IGV por línea y
// precio unitario. El XML es la fuente exacta y liviana (no usa OCR ni pdf.js).

const parser = new XMLParser({
  removeNSPrefix: true,
  ignoreAttributes: false,        // necesitamos unitCode, schemeID, etc.
  attributeNamePrefix: "@_",
  parseTagValue: false,           // preserva códigos con cero inicial (01, 03…); los montos se convierten con num()
  trimValues: true,
});

export interface LineaXml {
  numero: number;
  codigo: string;
  descripcion: string;
  cantidad: number;
  unidad: string;
  valorUnitario: number;   // sin IGV
  valor: number;           // valor de venta de la línea (sin IGV)
  igv: number;             // IGV de la línea
  precioUnitario: number;  // con IGV (referencial)
  afectacion: string;      // Gravado / Exonerado / Inafecto / …
}

export interface FacturaXml {
  tipo: string;            // Factura/Boleta, Nota de crédito, Nota de débito
  tipoDoc: string;         // código SUNAT (01, 03, 07, 08)
  serie: string;
  numero: string;
  serieNumero: string;
  fecha: string;
  hora: string;
  moneda: string;
  rucEmisor: string;
  razonSocialEmisor: string;
  rucReceptor: string;
  razonSocialReceptor: string;
  // Montos por afectación (a nivel documento)
  gravado: number;
  exonerado: number;
  inafecto: number;
  gratuito: number;
  descuento: number;
  isc: number;
  igv: number;
  otrosTributos: number;
  base: number;            // valor de venta total (LineExtensionAmount)
  total: number;           // importe total (PayableAmount)
  lineas: LineaXml[];
  /** Glosa para contabilidad: descripciones de las líneas unidas. */
  glosa: string;
  /** PDF OFICIAL de SUNAT (ícono rojo del modal) en base64, si se capturó. */
  pdfBase64?: string;
  /** XML crudo del comprobante en base64 (para descargarlo tal cual). */
  xmlBase64?: string;

  // ---- Datos complementarios (para el Excel completo) ----------------------
  direccionEmisor?: string;
  direccionReceptor?: string;
  /** Contado / Crédito (con N° de cuotas si las hay). */
  formaPago?: string;
  anticipos?: number;
  otrosCargos?: number;
  redondeo?: number;
  /** Impuesto a las bolsas plásticas (esquema 7152). */
  icbper?: number;
  observacion?: string;
  /** Bloque "Información de la detracción" (null = no sujeta). */
  detraccion?: DetraccionXml | null;
  /** De dónde salieron los datos: XML (exacto) o texto del PDF (heurístico). */
  fuente?: "xml" | "pdf";
}

export interface DetraccionXml {
  codigo: string;      // Bien o servicio (Anexo: 022 Otros servicios empresariales…)
  porcentaje: number;  // 12.00
  monto: number;       // 101.95
  cuenta: string;      // N° cuenta Banco de la Nación
  medioPago: string;   // 001 Depósito en cuenta
}

/** Nombres del Anexo de detracciones (los más comunes) para mostrar junto al código. */
export const BIENES_DETRACCION: Record<string, string> = {
  "001": "Azúcar y melaza de caña", "003": "Alcohol etílico", "004": "Recursos hidrobiológicos",
  "005": "Maíz amarillo duro", "007": "Caña de azúcar", "008": "Madera", "009": "Arena y piedra",
  "010": "Residuos, subproductos, desechos", "012": "Intermediación laboral y tercerización",
  "014": "Carnes y despojos comestibles", "017": "Harina, polvo y pellets de pescado",
  "019": "Arrendamiento de bienes", "020": "Mantenimiento y reparación de bienes muebles",
  "021": "Movimiento de carga", "022": "Otros servicios empresariales", "023": "Leche",
  "024": "Comisión mercantil", "025": "Fabricación de bienes por encargo", "026": "Servicio de transporte de personas",
  "027": "Servicio de transporte de carga", "030": "Contratos de construcción", "031": "Oro gravado con el IGV",
  "034": "Minerales metálicos no auríferos", "035": "Bienes exonerados del IGV", "036": "Oro y demás minerales exonerados",
  "037": "Demás servicios gravados con el IGV", "039": "Minerales no metálicos", "040": "Bien inmueble gravado con IGV",
  "041": "Plomo",
};
export const MEDIOS_PAGO: Record<string, string> = {
  "001": "Depósito en cuenta", "002": "Giro", "003": "Transferencia de fondos", "004": "Orden de pago",
  "005": "Tarjeta de débito", "006": "Tarjeta de crédito", "007": "Cheques", "008": "Efectivo",
  "009": "Efectivo, en los demás casos", "010": "Medios de pago usados en comercio exterior",
  "011": "Documentos emitidos por las EDPYMES", "012": "Tarjeta de crédito emitida en el país",
  "013": "Tarjetas de crédito emitidas en el exterior", "101": "Transferencias – Comercio exterior",
  "102": "Cheques bancarios – Comercio exterior", "999": "Otros medios de pago",
};

function asArray<T>(x: T | T[] | undefined): T[] {
  if (x === undefined || x === null) return [];
  return Array.isArray(x) ? x : [x];
}
function txt(x: any): string {
  if (x === undefined || x === null) return "";
  if (typeof x === "object") return String(x["#text"] ?? "");
  return String(x);
}
function attr(x: any, name: string): string {
  if (x && typeof x === "object" && x[`@_${name}`] != null) return String(x[`@_${name}`]);
  return "";
}
function num(x: any): number {
  const n = Number(txt(x).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

// Código de tipo de afectación IGV (Catálogo 07 SUNAT) → etiqueta legible.
function afectacionLabel(cod: string): string {
  if (!cod) return "";
  if (cod === "10") return "Gravado";
  if (["20", "21"].includes(cod)) return "Exonerado";
  if (["30", "31", "32", "33", "34", "35", "36", "37"].includes(cod)) return "Inafecto";
  if (cod.startsWith("1") && cod !== "10") return "Gravado gratuito";
  if (cod.startsWith("2")) return "Exonerado gratuito";
  return cod;
}

// Nombre del régimen por ID de esquema (Catálogo 05 SUNAT).
function esquemaLabel(id: string): string {
  switch (id) {
    case "1000": return "IGV";
    case "1016": return "IVAP";
    case "2000": return "ISC";
    case "9995": return "Exportación";
    case "9997": return "Exonerado";
    case "9998": return "Inafecto";
    case "9999": return "Otros tributos";
    default: return id;
  }
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
  const tipoDoc = txt(root.InvoiceTypeCode); // 01, 03, 07, 08…

  const id = txt(root.ID); // "F001-00000123"
  const [serie, numero] = id.includes("-") ? [id.split("-")[0], id.split("-").slice(1).join("-")] : ["", id];

  const emisor = root.AccountingSupplierParty?.Party ?? {};
  const receptor = root.AccountingCustomerParty?.Party ?? {};
  const rucEmisor = txt(asArray(emisor.PartyIdentification)[0]?.ID);
  const razonSocialEmisor =
    txt(asArray(emisor.PartyLegalEntity)[0]?.RegistrationName) ||
    txt(asArray(emisor.PartyName)[0]?.Name);
  const rucReceptor = txt(asArray(receptor.PartyIdentification)[0]?.ID);
  const razonSocialReceptor =
    txt(asArray(receptor.PartyLegalEntity)[0]?.RegistrationName) ||
    txt(asArray(receptor.PartyName)[0]?.Name);

  // Direcciones (RegistrationAddress del emisor y del receptor).
  const direccionEmisor = direccionDe(emisor);
  const direccionReceptor = direccionDe(receptor);

  // Montos por afectación (a nivel documento) desde TaxTotal/TaxSubtotal.
  let gravado = 0, exonerado = 0, inafecto = 0, isc = 0, otrosTributos = 0, icbper = 0, gratuitoTax = 0;
  let igv = 0;
  for (const tt of asArray(root.TaxTotal)) {
    igv += 0; // el IGV global se calcula abajo con más precisión por esquema
    for (const st of asArray(tt?.TaxSubtotal)) {
      const base = num(st?.TaxableAmount);
      const monto = num(st?.TaxAmount);
      const schemeId = txt(st?.TaxCategory?.TaxScheme?.ID) || attr(st?.TaxCategory?.TaxScheme?.ID, "schemeID");
      switch (schemeId) {
        case "1000": // IGV
        case "1016": // IVAP
          gravado += base; igv += monto; break;
        case "2000": // ISC
          isc += monto; break;
        case "7152": // ICBPER (bolsas plásticas)
          icbper += monto; break;
        case "9996": // Gratuitas
          gratuitoTax += base; break;
        case "9997": // Exonerado
          exonerado += base; break;
        case "9998": // Inafecto
          inafecto += base; break;
        case "9995": // Exportación
          gravado += base; break;
        default:
          otrosTributos += monto; break;
      }
    }
  }

  // Forma de pago (Contado / Crédito + cuotas) y DETRACCIÓN (PaymentTerms +
  // PaymentMeans con ID "Detraccion", según la guía UBL 2.1 de SUNAT).
  let formaPago = "";
  let cuotas = 0;
  const det: DetraccionXml = { codigo: "", porcentaje: 0, monto: 0, cuenta: "", medioPago: "" };
  let hayDetraccion = false;
  for (const pt of asArray(root.PaymentTerms)) {
    const id = txt(pt?.ID);
    const mid = txt(pt?.PaymentMeansID);
    if (/detracci/i.test(id)) {
      hayDetraccion = true;
      det.codigo = mid || det.codigo;
      det.porcentaje = num(pt?.PaymentPercent) || det.porcentaje;
      det.monto = num(pt?.Amount) || det.monto;
    } else if (/formapago/i.test(id)) {
      if (/contado/i.test(mid)) formaPago = "Contado";
      else if (/cr[eé]dito/i.test(mid)) formaPago = "Crédito";
      else if (/^cuota/i.test(mid)) cuotas++;
    }
  }
  if (formaPago === "Crédito" && cuotas) formaPago += ` (${cuotas} cuota${cuotas > 1 ? "s" : ""})`;
  for (const pm of asArray(root.PaymentMeans)) {
    if (!/detracci/i.test(txt(pm?.ID))) continue;
    hayDetraccion = true;
    det.cuenta = txt(pm?.PayeeFinancialAccount?.ID) || det.cuenta;
    det.medioPago = txt(pm?.PaymentMeansCode) || det.medioPago;
  }

  // Observaciones: cbc:Note sin languageLocaleID (el 1000 es el monto en letras
  // y los 2xxx son leyendas fijas como la de detracción).
  const observacion = asArray(root.Note)
    .filter((n: any) => !attr(n, "languageLocaleID"))
    .map(txt).filter(Boolean).join(" | ").slice(0, 300);
  // Respaldo: si no hubo subtotales, usa el IGV agregado de TaxAmount.
  if (igv === 0) igv = asArray(root.TaxTotal).reduce((a: number, t: any) => a + num(t?.TaxAmount), 0);

  const mon = root.LegalMonetaryTotal ?? {};
  const base = num(mon.LineExtensionAmount);
  const total = num(mon.PayableAmount) || num(mon.TaxInclusiveAmount);
  const descuento = num(mon.AllowanceTotalAmount);
  const gratuito = num(mon.FreeOfChargeIndicatorAmount) || gratuitoTax || 0;
  const anticipos = num(mon.PrepaidAmount);
  const otrosCargos = num(mon.ChargeTotalAmount);
  const redondeo = num(mon.PayableRoundingAmount);

  const lineasRaw = asArray(root.InvoiceLine ?? root.CreditNoteLine ?? root.DebitNoteLine);
  const lineas: LineaXml[] = lineasRaw.map((l: any, i: number) => {
    const cantEl = l?.InvoicedQuantity ?? l?.CreditedQuantity ?? l?.DebitedQuantity ?? l?.Quantity;
    const cantidad = num(cantEl);
    const unidad = attr(cantEl, "unitCode");
    const valor = num(l?.LineExtensionAmount);
    // IGV de la línea (suma de TaxTotal/TaxAmount de la línea) y su afectación.
    let igvLinea = 0;
    let afecCod = "";
    for (const tt of asArray(l?.TaxTotal)) {
      igvLinea += num(tt?.TaxAmount);
      for (const st of asArray(tt?.TaxSubtotal)) {
        const c = txt(st?.TaxCategory?.TaxExemptionReasonCode);
        if (c) afecCod = c;
      }
    }
    // Valor unitario (sin IGV) = cac:Price/cbc:PriceAmount.
    const valorUnitario = num(l?.Price?.PriceAmount) || (cantidad ? valor / cantidad : 0);
    // Precio unitario (con IGV) = PricingReference/AlternativeConditionPrice/PriceAmount.
    const precioUnitario =
      num(asArray(l?.PricingReference?.AlternativeConditionPrice)[0]?.PriceAmount) ||
      (cantidad ? (valor + igvLinea) / cantidad : 0);
    const codigo =
      txt(l?.Item?.SellersItemIdentification?.ID) ||
      txt(l?.Item?.StandardItemIdentification?.ID);
    return {
      numero: num(l?.ID) || i + 1,
      codigo,
      descripcion: asArray(l?.Item?.Description).map(txt).join(" ").trim(),
      cantidad,
      unidad,
      valorUnitario,
      valor,
      igv: igvLinea,
      precioUnitario,
      afectacion: afectacionLabel(afecCod),
    };
  });

  const glosa = lineas
    .map((l) => l.descripcion)
    .filter(Boolean)
    .join("; ")
    .slice(0, 300);

  return {
    tipo,
    tipoDoc,
    serie,
    numero,
    serieNumero: id,
    fecha: txt(root.IssueDate),
    hora: txt(root.IssueTime),
    moneda: txt(root.DocumentCurrencyCode) || "PEN",
    rucEmisor,
    razonSocialEmisor,
    rucReceptor,
    razonSocialReceptor,
    gravado,
    exonerado,
    inafecto,
    gratuito,
    descuento,
    isc,
    igv,
    otrosTributos,
    base,
    total,
    lineas,
    glosa,
    direccionEmisor,
    direccionReceptor,
    formaPago,
    anticipos,
    otrosCargos,
    redondeo,
    icbper,
    observacion,
    detraccion: hayDetraccion ? det : null,
    fuente: "xml",
  };
}

// Dirección legible de una Party: AddressLine + distrito + provincia + departamento.
function direccionDe(party: any): string {
  const ra =
    asArray(party?.PartyLegalEntity)[0]?.RegistrationAddress ??
    party?.PostalAddress ??
    asArray(party?.Person)[0]?.RegistrationAddress;
  if (!ra) return "";
  const linea = asArray(ra.AddressLine).map((a: any) => txt(a?.Line)).filter(Boolean).join(" ");
  const partes = [linea, txt(ra.District), txt(ra.CityName), txt(ra.CountrySubentity)]
    .map((s) => s.trim())
    .filter(Boolean);
  // Evita repetir "LIMA LIMA LIMA".
  return partes.filter((p, i) => partes.findIndex((q) => q.toUpperCase() === p.toUpperCase()) === i).join(", ");
}

// Etiqueta de esquema exportada por si la UI la necesita.
export { esquemaLabel };
