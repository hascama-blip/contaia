import type { FacturaXml, LineaXml, DetraccionXml } from "./facturaXml";

// ============================================================
//  Lector del PDF oficial de SUNAT (representación impresa)
// ============================================================
// Para el modo "PDF masivo" no hay XML: se lee la CAPA DE TEXTO del PDF con
// unpdf (sin OCR) y se arma la misma estructura que entrega parseFacturaXml,
// marcada con fuente "pdf". La cabecera y los totales salen por etiquetas
// ("Importe Total :", "Monto detracción:", …) y son confiables; los ítems se
// reconstruyen de la tabla y son heurísticos (una fila = cantidad + unidad +
// descripción + valor unitario; las líneas sin cantidad al inicio son la
// continuación de la descripción anterior).

const RX_MONTO = "(?:S/|US\\$|\\$|USD|PEN)?\\s*(-?[\\d,]+\\.\\d{2})";

function monto(s: string | undefined): number {
  if (!s) return 0;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}
function limpia(s: string | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").replace(/\s*:\s*$/, "").trim();
}
/** Primer monto que sigue a cualquiera de las etiquetas dadas. */
function montoEtiqueta(texto: string, etiquetas: RegExp[]): number | undefined {
  for (const et of etiquetas) {
    const rx = new RegExp(`${et.source}\\s*:?\\s*${RX_MONTO}`, "i");
    const m = texto.match(rx);
    if (m) return monto(m[1]);
  }
  return undefined;
}
function textoEtiqueta(texto: string, etiqueta: RegExp, fin: RegExp): string {
  const rx = new RegExp(`${etiqueta.source}\\s*:?\\s*([\\s\\S]*?)\\s*(?=${fin.source})`, "i");
  const m = texto.match(rx);
  return limpia(m?.[1]);
}

/** Extrae el texto del PDF (capa de texto). "" si no hay texto. */
export async function textoDePdf(buffer: Buffer | Uint8Array): Promise<string> {
  try {
    const { extractText, getDocumentProxy } = await import("./pdfTexto");
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await extractText(pdf, { mergePages: true });
    return Array.isArray(text) ? text.join("\n") : String(text ?? "");
  } catch (err) {
    console.error("[facturaPdf] No se pudo leer el PDF:", err);
    return "";
  }
}

/** Parsea el texto de la representación impresa de un comprobante SUNAT. */
export function parseFacturaPdfTexto(texto: string, pista?: Partial<FacturaXml>): FacturaXml | null {
  const t = texto.replace(/\r/g, "").replace(/[ \t]+/g, " ");
  if (!t.trim()) return null;

  // --- Tipo y serie-número ---------------------------------------------------
  let tipoDoc = pista?.tipoDoc ?? "";
  let tipo = "Factura/Boleta";
  if (/NOTA DE CR[EÉ]DITO/i.test(t)) { tipoDoc = tipoDoc || "07"; tipo = "Nota de crédito"; }
  else if (/NOTA DE D[EÉ]BITO/i.test(t)) { tipoDoc = tipoDoc || "08"; tipo = "Nota de débito"; }
  else if (/BOLETA DE VENTA/i.test(t)) { tipoDoc = tipoDoc || "03"; }
  else if (/FACTURA/i.test(t)) { tipoDoc = tipoDoc || "01"; }
  if (tipoDoc === "07") tipo = "Nota de crédito";
  if (tipoDoc === "08") tipo = "Nota de débito";

  const rucs = Array.from(t.matchAll(/\b((?:10|15|16|17|20)\d{9})\b/g)).map((m) => m[1]);
  // Emisor: el RUC del recuadro del título ("FACTURA ELECTRONICA RUC: …") o el primero.
  const mEmi = t.match(/(?:ELECTR[OÓ]NICA|FACTURA|BOLETA|NOTA DE (?:CR[EÉ]DITO|D[EÉ]BITO))[\s\S]{0,60}?RUC\s*:?\s*((?:10|15|16|17|20)\d{9})/i);
  const rucEmisor = pista?.rucEmisor || mEmi?.[1] || rucs[0] || "";
  const rucReceptor =
    (t.match(/Se[ñn]or\(?es\)?[\s\S]{0,200}?RUC\s*:?\s*((?:10|15|16|17|20)\d{9})/i)?.[1]) ||
    rucs.find((r) => r !== rucEmisor) || "";

  let serie = pista?.serie ?? "", numero = pista?.numero ?? "";
  if (!serie) {
    const mSn = t.match(/\b([EFBMS][A-Z0-9]{3})\s*-\s*(\d{1,8})\b/) || t.match(/\b([A-Z]{1,2}[A-Z0-9]{2,3})\s*-\s*(\d{1,8})\b/);
    if (mSn) { serie = mSn[1]; numero = mSn[2]; }
  }
  const serieNumero = pista?.serieNumero || (serie ? `${serie}-${numero}` : "");

  // --- Cabecera -------------------------------------------------------------
  const fecha = t.match(/Fecha de Emisi[oó]n\s*:?\s*(\d{2}\/\d{2}\/\d{4})/i)?.[1] ?? "";
  const hora = t.match(/Hora(?: de Emisi[oó]n)?\s*:?\s*(\d{2}:\d{2}(?::\d{2})?)/i)?.[1] ?? "";
  const razonSocialReceptor = textoEtiqueta(t, /Se[ñn]or\(?es\)?/, /\bRUC\b|\bDNI\b|Direcci[oó]n/);
  const direccionReceptor = textoEtiqueta(t, /Direcci[oó]n(?: del Receptor(?: de la factura)?| del Cliente)?/, /Establecimiento del Emisor|Tipo de Moneda|Observaci[oó]n|Cantidad/);
  const direccionEmisor = textoEtiqueta(t, /Establecimiento del Emisor/, /Tipo de Moneda|Observaci[oó]n|Cantidad/);
  const monTxt = t.match(/Tipo de Moneda\s*:?\s*([A-ZÁÉÍÓÚ ]{3,20})/i)?.[1] ?? "";
  const moneda = /D[OÓ]LAR|USD/i.test(monTxt) ? "USD" : /EUR/i.test(monTxt) ? "EUR" : "PEN";
  const fp = t.match(/Forma de pago\s*:?\s*(Contado|Cr[eé]dito)/i)?.[1] ?? "";
  const formaPago = fp ? (/contado/i.test(fp) ? "Contado" : "Crédito") : "";
  const observacion = textoEtiqueta(t, /Observaci[oó]n(?:es)?/, /\n\s*Cantidad|Cantidad\s+Unidad|C[oó]digo\s+Cantidad|Descripci[oó]n/).slice(0, 300);

  // Razón social del emisor: el texto de cabecera antes de la fecha de emisión,
  // sin el recuadro del título ("FACTURA ELECTRONICA RUC … E001-7") ni la
  // dirección (que empieza con CAL./AV./JR./…). unpdf puede entregar todo en
  // una sola línea, así que no se depende de saltos de línea.
  let razonSocialEmisor = pista?.razonSocialEmisor ?? "";
  if (!razonSocialEmisor) {
    let cab = t.split(/Fecha de Emisi[oó]n/i)[0];
    cab = cab.replace(/(?:FACTURA|BOLETA|NOTA DE (?:CR[EÉ]DITO|D[EÉ]BITO))[\s\S]*$/i, "");
    cab = cab.replace(/\bRUC\s*:?\s*\d{11}[\s\S]*$/i, "");
    const corte = cab.search(/\b(?:CAL\.|CALLE|AV\.|AVENIDA|AVDA\.?|JR\.|JIR[OÓ]N|PSJE\.?|PASAJE|MZ\.?|MZA\.?|URB\.|CAR\.|CARRETERA|LOTE|LT\.|KM\.?|PJ\.|PROLONG|PQUE|PARQUE|CC\.?HH|AA\.?HH|ASENT|COOP|INT\.|DPTO|OF\.|OFICINA|SECTOR|BLOCK|ZONA|NRO\.|N°|DIRECCI[OÓ]N|DOMICILIO|TEL[EÉ]F|CEL\.|E-?MAIL|CORREO|WEB|WWW\.)/i);
    if (corte > 0) cab = cab.slice(0, corte);
    const lineas = cab.split("\n").map((l) => l.trim()).filter(Boolean);
    razonSocialEmisor =
      lineas.find((l) => /S\.?\s?A\.?\s?C?\.?$|S\.?\s?R\.?\s?L\.?$|E\.?\s?I\.?\s?R\.?\s?L\.?$|\bSAC\b|\bSRL\b|\bEIRL\b|\bS\.A\.\b|\bLTDA\b|\bS\.A\.A\.?\b/i.test(l)) ||
      lineas[0] || "";
    razonSocialEmisor = razonSocialEmisor.replace(/^[\s:|-]+|[\s:|-]+$/g, "").slice(0, 120);
  }

  // --- Totales por etiqueta --------------------------------------------------
  const gravado = montoEtiqueta(t, [/Op\.?\s*Gravadas?/, /Operaciones Gravadas/, /Valor Venta(?! de)/, /Sub\s*Total Ventas/]) ?? 0;
  const exonerado = montoEtiqueta(t, [/Op\.?\s*Exoneradas?/, /Operaciones Exoneradas/]) ?? 0;
  const inafecto = montoEtiqueta(t, [/Op\.?\s*Inafectas?/, /Operaciones Inafectas/]) ?? 0;
  const gratuito = montoEtiqueta(t, [/Valor de Venta de Operaciones Gratuitas/, /Op\.?\s*Gratuitas?/]) ?? 0;
  const anticipos = montoEtiqueta(t, [/Anticipos?/]) ?? 0;
  const descuento = montoEtiqueta(t, [/Descuentos?(?: Globales?)?/]) ?? 0;
  const isc = montoEtiqueta(t, [/\bISC\b/]) ?? 0;
  const igv = montoEtiqueta(t, [/\bIGV\b(?!\s*\()/, /\bIGV\b/]) ?? 0;
  const icbper = montoEtiqueta(t, [/\bICBPER\b\s*:/, /Impuesto a las bolsas/]) ?? 0;
  const otrosCargos = montoEtiqueta(t, [/Otros Cargos/]) ?? 0;
  const otrosTributos = montoEtiqueta(t, [/Otros Tributos/]) ?? 0;
  const redondeo = montoEtiqueta(t, [/Monto de redondeo/, /Redondeo/]) ?? 0;
  const total = montoEtiqueta(t, [/Importe Total/, /Total a Pagar/, /TOTAL A PAGAR/, /Precio Venta/, /\bTOTAL\b/]) ?? 0;
  const base = gravado + exonerado + inafecto;

  // --- Detracción ------------------------------------------------------------
  let detraccion: DetraccionXml | null = null;
  if (/detracci[oó]n/i.test(t)) {
    const cod = t.match(/Bien o Servicio\s*:?\s*(\d{3})/i)?.[1] ?? "";
    const medio = t.match(/Medio de pago\s*:?\s*(\d{3})/i)?.[1] ?? "";
    const cuenta = t.match(/Cta\.?\s*Banco de la Naci[oó]n\s*:?\s*(\d{6,})/i)?.[1] ?? t.match(/Banco de la Naci[oó]n[^\d]{0,30}(\d{8,})/i)?.[1] ?? "";
    const pct = Number(t.match(/Porcentaje de detracci[oó]n\s*:?\s*([\d.]+)/i)?.[1] ?? t.match(/Detracci[oó]n\s*\(?\s*([\d.]+)\s*%/i)?.[1] ?? 0) || 0;
    const mDet = montoEtiqueta(t, [/Monto detracci[oó]n/, /Monto de (?:la )?detracci[oó]n/, /Detracci[oó]n\s*:/]) ?? 0;
    if (cod || mDet > 0 || cuenta) detraccion = { codigo: cod, porcentaje: pct, monto: mDet, cuenta, medioPago: medio };
  }

  // --- Ítems -----------------------------------------------------------------
  const lineas = itemsDeTexto(t, { gravado, igv, moneda });
  const glosa = lineas.map((l) => l.descripcion).filter(Boolean).join("; ").slice(0, 300);

  return {
    tipo, tipoDoc, serie, numero, serieNumero, fecha, hora, moneda,
    rucEmisor, razonSocialEmisor: limpia(razonSocialEmisor), rucReceptor, razonSocialReceptor,
    gravado, exonerado, inafecto, gratuito, descuento, isc, igv, otrosTributos, base, total,
    lineas, glosa,
    direccionEmisor, direccionReceptor, formaPago, anticipos, otrosCargos, redondeo, icbper, observacion,
    detraccion, fuente: "pdf",
  };
}

// Reconstruye la tabla de ítems. Formato típico SUNAT:
//   Cantidad | Unidad Medida | Descripción | Valor Unitario | ICBPER
// o con código al inicio: Código | Cantidad | Unidad | Descripción | Valor unit. | …
// unpdf puede entregar toda la página en UNA línea, así que no se usan saltos:
// cada ítem EMPIEZA en "[código] cantidad unidad" y TERMINA en los montos que
// preceden al siguiente inicio (valor unitario, ICBPER…).
const UNIDADES_SUNAT =
  "UNIDAD(?:ES)?|NIU|ZZ|SERVICIOS?|KGM|KG|GRM|LTR|MTR|MTK|MTQ|M2|M3|CJA|BX|PAQ|PK|DOC|DZN|GLL|GAL|PAR|PR|HUR|HORAS?|DIAS?|DAY|MES(?:ES)?|MON|SET|JGO|BOLSA|BG|CAJA|CENTO|MILLAR|MIL|TNE|TON|ROLLO|RO|BOTELLA|BO|LATA|CAN|GAL[OÓ]N|PZA|PIEZA|UND|UNID|CU|U";

function itemsDeTexto(t: string, ctx: { gravado: number; igv: number; moneda: string }): LineaXml[] {
  const ini = t.search(/Cantidad\s+(?:Unidad(?: de)? Medida|U\.?M\.?\b|Unidad\b)|C[oó]digo\s+Cantidad|Cant\.?\s+U\.?M\.?/i);
  if (ini < 0) return [];
  let cuerpo = t.slice(ini);
  // Cabecera de la tabla: desde "Cantidad…" hasta la última palabra de encabezado.
  const cab = cuerpo.match(/^(?:Cantidad|C[oó]digo|Cant\.?)[\s\S]{0,160}?(?:Descripci[oó]n|Detalle)(?:\s+(?:Valor\s+Unitario|Precio\s+Unitario|P\.?\s*Unit\.?|V\.?\s*Unit\.?|Dscto\.?|Descuento|ICBPER|IGV|Importe(?:\s+Total)?|Total|Valor\s+Venta|Precio\s+Venta))*\s*/i);
  if (cab) cuerpo = cuerpo.slice(cab[0].length);
  const fin = cuerpo.search(/Valor de Venta de Operaciones Gratuitas|Sub\s*Total Ventas|Op\.?\s*Gravad|Operaciones Gravadas|\bSON\s*:|Importe Total|Total a Pagar|Informaci[oó]n de la detracci/i);
  if (fin > 0) cuerpo = cuerpo.slice(0, fin);

  const rxInicio = new RegExp(`(?:^|\\s)(?:([A-Z0-9][A-Z0-9-]{1,19})\\s+)?(\\d{1,3}(?:,\\d{3})*(?:\\.\\d+)?|\\d+(?:\\.\\d+)?)\\s+(${UNIDADES_SUNAT})\\b\\.?\\s+`, "gi");
  const inicios: { index: number; end: number; codigo: string; cantidad: number; unidad: string }[] = [];
  for (const m of cuerpo.matchAll(rxInicio)) {
    const idx = m.index ?? 0;
    // Un inicio posterior al primero debe venir justo después de un monto
    // (el valor unitario / ICBPER del ítem anterior); así "DE 12.00 UNIDADES"
    // dentro de una descripción no se toma como ítem nuevo.
    if (inicios.length && !/\d\.\d{2}\s*$/.test(cuerpo.slice(Math.max(0, idx - 14), idx + 1))) continue;
    inicios.push({ index: idx, end: idx + m[0].length, codigo: m[1] ?? "", cantidad: monto(m[2]), unidad: m[3].replace(/\.$/, "").toUpperCase() });
  }
  const items: { cantidad: number; unidad: string; descripcion: string; valorUnitario: number; codigo: string; extra: number[] }[] = [];
  inicios.forEach((s, i) => {
    let desc = cuerpo.slice(s.end, inicios[i + 1]?.index ?? cuerpo.length).trim();
    // Montos al final del tramo: valor unitario (+ ICBPER / descuento / importe).
    const nums: number[] = [];
    let mm: RegExpMatchArray | null;
    while ((mm = desc.match(/(?:^|\s)(-?[\d,]+\.\d{2,})\s*$/))) { nums.unshift(monto(mm[1])); desc = desc.slice(0, mm.index).trim(); }
    items.push({ codigo: s.codigo, cantidad: s.cantidad, unidad: s.unidad, descripcion: desc, valorUnitario: nums[0] ?? 0, extra: nums.slice(1) });
  });

  const ratioIgv = ctx.gravado > 0 ? ctx.igv / ctx.gravado : 0;
  return items.map((it, i) => {
    const valor = Math.round(it.cantidad * it.valorUnitario * 100) / 100;
    const igv = Math.round(valor * ratioIgv * 100) / 100;
    return {
      numero: i + 1,
      codigo: it.codigo,
      descripcion: it.descripcion.replace(/\s+/g, " ").trim(),
      cantidad: it.cantidad,
      unidad: it.unidad,
      valorUnitario: it.valorUnitario,
      valor,
      igv,
      precioUnitario: Math.round(it.valorUnitario * (1 + ratioIgv) * 100) / 100,
      afectacion: ratioIgv > 0 ? "Gravado" : "",
    };
  });
}

/** Lee el PDF (buffer) y devuelve la factura; null si no tiene capa de texto. */
export async function parseFacturaPdf(buffer: Buffer | Uint8Array, pista?: Partial<FacturaXml>): Promise<FacturaXml | null> {
  const texto = await textoDePdf(buffer);
  if (!texto.trim()) return null;
  return parseFacturaPdfTexto(texto, pista);
}
