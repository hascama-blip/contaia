import type { FacturaXml } from "./facturaXml";

// ============================================================
//  Representación imprimible (PDF) de un comprobante recibido (XML)
// ============================================================
// Arma un HTML limpio con los datos del comprobante (emisor, receptor, líneas,
// totales, glosa) a partir del FacturaXml ya parseado. Se renderiza a PDF con el
// navegador headless (igual que el buzón imprime a PDF).

const TIPO_LABEL: Record<string, string> = {
  "01": "FACTURA ELECTRÓNICA",
  "03": "BOLETA DE VENTA ELECTRÓNICA",
  "07": "NOTA DE CRÉDITO ELECTRÓNICA",
  "08": "NOTA DE DÉBITO ELECTRÓNICA",
  "14": "RECIBO DE SERVICIOS PÚBLICOS",
};

const esc = (s: any) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const money = (n: any) => (Number(n) || 0).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function facturaHtml(f: FacturaXml): string {
  const titulo = TIPO_LABEL[f.tipoDoc] || (f.tipo ? f.tipo.toUpperCase() : "COMPROBANTE ELECTRÓNICO");
  const simbolo = f.moneda === "USD" ? "US$" : f.moneda === "PEN" ? "S/" : (f.moneda || "");

  const filas = (f.lineas ?? []).map((l, i) => `
    <tr>
      <td class="c">${i + 1}</td>
      <td class="c">${esc(l.cantidad ?? "")}</td>
      <td class="c">${esc(l.unidad ?? "")}</td>
      <td>${esc(l.descripcion ?? "")}</td>
      <td class="r">${money(l.valorUnitario)}</td>
      <td class="r">${money(l.valor)}</td>
      <td class="r">${money(l.igv)}</td>
    </tr>`).join("");

  const totalLinea = (etq: string, val: number, fuerte = false) =>
    (Number(val) || fuerte)
      ? `<tr class="${fuerte ? "tot" : ""}"><td class="tlbl">${etq}</td><td class="r">${simbolo} ${money(val)}</td></tr>`
      : "";

  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1e293b; font-size: 11px; margin: 0; padding: 24px; }
  .head { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; }
  .emisor { max-width: 60%; }
  .emisor .rs { font-size: 15px; font-weight: 800; color: #102b4d; }
  .emisor .ruc { color: #475569; margin-top: 2px; }
  .box { border: 2px solid #102b4d; border-radius: 8px; padding: 10px 14px; text-align: center; min-width: 210px; }
  .box .t { font-weight: 800; color: #102b4d; font-size: 12px; letter-spacing: .3px; }
  .box .n { font-size: 15px; font-weight: 800; margin-top: 4px; }
  .meta { margin-top: 16px; display: grid; grid-template-columns: 1fr 1fr; gap: 4px 24px; }
  .meta .k { color: #64748b; }
  table { width: 100%; border-collapse: collapse; margin-top: 16px; }
  th, td { border: 1px solid #e2e8f0; padding: 5px 6px; }
  thead th { background: #102b4d; color: #fff; font-size: 10px; text-transform: uppercase; }
  td.c { text-align: center; } td.r { text-align: right; }
  .totales { margin-top: 12px; width: 46%; margin-left: auto; }
  .totales td { border: none; padding: 3px 6px; }
  .totales .tlbl { color: #475569; }
  .totales .tot td { font-weight: 800; color: #102b4d; border-top: 2px solid #102b4d; font-size: 12px; }
  .glosa { margin-top: 14px; font-size: 10px; color: #475569; }
  .foot { margin-top: 22px; border-top: 1px solid #e2e8f0; padding-top: 8px; font-size: 9px; color: #94a3b8; text-align: center; }
</style></head><body>
  <div class="head">
    <div class="emisor">
      <div class="rs">${esc(f.razonSocialEmisor || "—")}</div>
      <div class="ruc">RUC: ${esc(f.rucEmisor || "—")}</div>
    </div>
    <div class="box">
      <div class="t">${esc(titulo)}</div>
      <div class="n">${esc(f.serieNumero || `${f.serie}-${f.numero}`)}</div>
    </div>
  </div>

  <div class="meta">
    <div><span class="k">Fecha de emisión:</span> ${esc(f.fecha || "—")}${f.hora ? " " + esc(f.hora) : ""}</div>
    <div><span class="k">Moneda:</span> ${esc(f.moneda || "—")}</div>
    <div><span class="k">Adquiriente:</span> ${esc(f.razonSocialReceptor || "—")}</div>
    <div><span class="k">RUC/Doc.:</span> ${esc(f.rucReceptor || "—")}</div>
  </div>

  <table>
    <thead><tr>
      <th>#</th><th>Cant.</th><th>Und.</th><th>Descripción</th>
      <th>V. unit.</th><th>Valor</th><th>IGV</th>
    </tr></thead>
    <tbody>${filas || `<tr><td colspan="7" class="c">Sin detalle de líneas</td></tr>`}</tbody>
  </table>

  <table class="totales">
    ${totalLinea("Gravado", f.gravado)}
    ${totalLinea("Exonerado", f.exonerado)}
    ${totalLinea("Inafecto", f.inafecto)}
    ${totalLinea("Descuentos", f.descuento)}
    ${totalLinea("ISC", f.isc)}
    ${totalLinea("IGV (18%)", f.igv)}
    ${totalLinea("Otros tributos", f.otrosTributos)}
    ${totalLinea("IMPORTE TOTAL", f.total, true)}
  </table>

  ${f.glosa ? `<div class="glosa"><strong>Glosa:</strong> ${esc(f.glosa)}</div>` : ""}

  <div class="foot">Representación impresa del comprobante electrónico · generada por Radar Tributar IA a partir del XML de SUNAT.</div>
</body></html>`;
}
