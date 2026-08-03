import type { AnalisisCompras } from "./analisisCompras";

// HTML autocontenido para el informe de compras/gastos en PDF.
// IMPORTANTE: informe "normal", SIN logo ni marca (Radar/ASENCO). Solo el
// nombre de la empresa analizada y un diseño sobrio en escala de grises.

const esc = (s: any) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const soles = (n: number) =>
  `S/ ${Number(n || 0).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function barra(pct: number): string {
  const w = Math.max(0, Math.min(100, pct));
  return `<div class="barwrap"><div class="bar" style="width:${w.toFixed(1)}%"></div></div>`;
}

export function informeComprasHtml(a: AnalisisCompras): string {
  const funcRows = a.porFuncion.map((f) => `
    <tr>
      <td><strong>${esc(f.cod)}</strong> · ${esc(f.nombre)}</td>
      <td class="num">${soles(f.debe)}</td>
      <td class="pct">${f.pct.toFixed(1)}%</td>
      <td class="barcell">${barra(f.pct)}</td>
    </tr>`).join("");

  const natRows = a.porNaturaleza.map((n) => `
    <tr>
      <td><strong>${esc(n.cod)}</strong> · ${esc(n.nombre)}</td>
      <td class="num">${soles(n.debe)}</td>
      <td class="pct">${n.pct.toFixed(1)}%</td>
      <td class="barcell">${barra(n.pct)}</td>
    </tr>`).join("");

  const ccRows = a.porCentroCosto.map((c) => `
    <tr>
      <td>${esc(c.cod)}</td>
      <td class="num">${soles(c.debe)}</td>
      <td class="pct">${c.pct.toFixed(1)}%</td>
      <td class="barcell">${barra(c.pct)}</td>
    </tr>`).join("");

  const clase9 = a.porFuncion.map((f) => `
    <table class="tbl detalle">
      <thead>
        <tr class="grp"><td colspan="4"><strong>${esc(f.cod)} · ${esc(f.nombre)}</strong> — ${soles(f.debe)} (${f.pct.toFixed(1)}%)</td></tr>
        <tr class="th"><th>Cuenta</th><th>Concepto</th><th class="num">Nº mov.</th><th class="num">Importe</th></tr>
      </thead>
      <tbody>
        ${f.cuentas.map((c) => `
          <tr>
            <td class="mono">${esc(c.cod)}</td>
            <td>${esc(c.nombre)}</td>
            <td class="num">${c.n}</td>
            <td class="num">${soles(c.debe)}</td>
          </tr>`).join("")}
      </tbody>
    </table>`).join("");

  const conceptos = a.topConceptos.map((c) => `
    <tr><td>${esc(c.nombre)}</td><td class="num">${c.n}</td><td class="num">${soles(c.debe)}</td></tr>`).join("");

  const comprobantes = a.topComprobantes.map((d) => `
    <tr><td class="mono">${esc(d.documento)}</td><td class="mono">${esc(d.proveedor || "—")}</td><td>${esc(d.glosa)}</td><td class="num">${soles(d.debe)}</td></tr>`).join("");

  const detalle = a.detalle.map((d) => `
    <tr>
      <td class="mono">${esc(d.cuenta)}</td>
      <td>${esc(d.funcion)}</td>
      <td>${esc(d.glosa)}</td>
      <td class="mono">${esc(d.documento)}</td>
      <td>${esc(d.fecDoc)}</td>
      <td>${esc(d.cenCos)}</td>
      <td class="num">${soles(d.debe)}</td>
    </tr>`).join("");

  const hoy = new Date().toLocaleDateString("es-PE", { day: "2-digit", month: "long", year: "numeric" });

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"/>
<style>
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", Arial, sans-serif; color: #1a1a1a; font-size: 11px; margin: 0; }
  .page { padding: 4px 2px; }
  h1 { font-size: 20px; margin: 0 0 2px; letter-spacing: .3px; }
  h2 { font-size: 13px; margin: 22px 0 8px; padding-bottom: 4px; border-bottom: 2px solid #333;
       text-transform: uppercase; letter-spacing: .5px; }
  .sub { color: #555; font-size: 11px; margin: 0; }
  .head { border-bottom: 3px solid #1a1a1a; padding-bottom: 10px; margin-bottom: 6px; }
  .meta { color: #666; font-size: 10px; margin-top: 4px; }
  .kpis { display: flex; gap: 10px; margin: 12px 0; }
  .kpi { flex: 1; border: 1px solid #ccc; border-radius: 6px; padding: 8px 10px; }
  .kpi .lbl { color: #666; font-size: 9px; text-transform: uppercase; letter-spacing: .4px; }
  .kpi .val { font-size: 16px; font-weight: 700; margin-top: 2px; }
  .kpi.big { background: #f3f3f3; }
  table.tbl { width: 100%; border-collapse: collapse; margin-top: 6px; }
  table.tbl th { text-align: left; font-size: 9px; text-transform: uppercase; color: #555;
                 border-bottom: 1px solid #999; padding: 4px 6px; }
  table.tbl td { padding: 4px 6px; border-bottom: 1px solid #eee; vertical-align: middle; }
  .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .pct { text-align: right; color: #555; white-space: nowrap; }
  .mono { font-family: "Consolas", monospace; }
  .barcell { width: 120px; }
  .barwrap { background: #eee; border-radius: 3px; height: 9px; width: 100%; overflow: hidden; }
  .bar { background: #333; height: 9px; }
  .grp td { background: #f0f0f0; border-top: 1px solid #999; padding: 5px 6px; }
  .detalle { margin-bottom: 10px; page-break-inside: avoid; }
  .detalle .th th { border-bottom: 1px solid #ccc; }
  .totalrow td { font-weight: 700; border-top: 2px solid #333; }
  tr { page-break-inside: avoid; }
  thead { display: table-header-group; }
  .foot { margin-top: 24px; border-top: 1px solid #ccc; padding-top: 6px; color: #888; font-size: 9px; }
</style></head>
<body><div class="page">

  <div class="head">
    <h1>${esc(a.empresa)}</h1>
    <p class="sub">Informe de análisis de compras y gastos</p>
    <p class="meta">Periodo analizado: ${esc(a.periodo || "—")} &nbsp;·&nbsp; Emitido: ${esc(hoy)}</p>
  </div>

  <div class="kpis">
    <div class="kpi big"><div class="lbl">Total gasto (clase 9)</div><div class="val">${soles(a.totalGasto)}</div></div>
    <div class="kpi"><div class="lbl">IGV / crédito fiscal</div><div class="val">${soles(a.totalIgv)}</div></div>
    <div class="kpi"><div class="lbl">Comprobantes</div><div class="val">${a.nAsientos}</div></div>
    <div class="kpi"><div class="lbl">Movimientos</div><div class="val">${a.nMovimientos}</div></div>
  </div>

  <h2>Gasto por función (destino)</h2>
  <table class="tbl">
    <thead><tr><th>Función</th><th class="num">Importe</th><th class="pct">%</th><th></th></tr></thead>
    <tbody>${funcRows}
      <tr class="totalrow"><td>TOTAL</td><td class="num">${soles(a.totalGasto)}</td><td class="pct">100%</td><td></td></tr>
    </tbody>
  </table>

  <h2>Análisis de la cuenta clase 9 (detallado)</h2>
  ${clase9}

  <h2>Gasto por naturaleza (clase 6)</h2>
  <table class="tbl">
    <thead><tr><th>Naturaleza del gasto</th><th class="num">Importe</th><th class="pct">%</th><th></th></tr></thead>
    <tbody>${natRows}</tbody>
  </table>

  <h2>Gasto por centro de costo</h2>
  <table class="tbl">
    <thead><tr><th>Centro de costo</th><th class="num">Importe</th><th class="pct">%</th><th></th></tr></thead>
    <tbody>${ccRows}</tbody>
  </table>

  <h2>Principales conceptos</h2>
  <table class="tbl">
    <thead><tr><th>Concepto (glosa)</th><th class="num">Nº mov.</th><th class="num">Importe</th></tr></thead>
    <tbody>${conceptos}</tbody>
  </table>

  <h2>Principales comprobantes</h2>
  <table class="tbl">
    <thead><tr><th>Documento</th><th>Proveedor</th><th>Glosa</th><th class="num">Importe</th></tr></thead>
    <tbody>${comprobantes}</tbody>
  </table>

  <h2>Anexo: detalle de movimientos (clase 9)</h2>
  <table class="tbl">
    <thead><tr><th>Cuenta</th><th>Función</th><th>Glosa</th><th>Documento</th><th>Fecha</th><th>C.C.</th><th class="num">Importe</th></tr></thead>
    <tbody>${detalle}</tbody>
  </table>

  <div class="foot">Documento generado automáticamente para uso de gerencia. Cifras en soles (S/).</div>

</div></body></html>`;
}
