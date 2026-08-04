import type { AnalisisCompras } from "./analisisCompras";

// HTML autocontenido para el informe de compras/gastos en PDF.
// Informe SIN logo ni marca (Radar/ASENCO): solo el nombre de la empresa.
// Diseño VIVO con la paleta de la marca (azul brand + dorado + acentos) e
// incluye los mismos gráficos del dashboard (torta + barras) como SVG.

const esc = (s: any) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const soles = (n: number) =>
  `S/ ${Number(n || 0).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const solesK = (n: number) =>
  n >= 1000 ? `${(n / 1000).toLocaleString("es-PE", { maximumFractionDigits: 1 })} mil` : n.toLocaleString("es-PE", { maximumFractionDigits: 0 });

// Paleta viva (misma del dashboard).
const PAL = ["#1d4ed8", "#dca200", "#0ea5e9", "#10b981", "#f97316", "#8b5cf6", "#ef4444", "#64748b"];

// --- Gráfico de torta (SVG) -------------------------------------------------
function svgPie(data: { label: string; value: number; color: string }[], size = 210): string {
  const r = size / 2 - 4, cx = size / 2, cy = size / 2;
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  let ang = -Math.PI / 2;
  let out = "";
  if (data.length === 1 || data[0].value / total >= 0.9999) {
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${cx}" cy="${cy}" r="${r}" fill="${data[0]?.color ?? PAL[0]}"/><text x="${cx}" y="${cy + 4}" fill="#fff" font-size="13" font-weight="700" text-anchor="middle">100%</text></svg>`;
  }
  for (const d of data) {
    const frac = d.value / total;
    const a2 = ang + frac * 2 * Math.PI;
    const x1 = cx + r * Math.cos(ang), y1 = cy + r * Math.sin(ang);
    const x2 = cx + r * Math.cos(a2), y2 = cy + r * Math.sin(a2);
    const large = frac > 0.5 ? 1 : 0;
    out += `<path d="M${cx},${cy} L${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r} 0 ${large} 1 ${x2.toFixed(2)},${y2.toFixed(2)} Z" fill="${d.color}" stroke="#fff" stroke-width="2"/>`;
    if (frac > 0.03) {
      const mid = (ang + a2) / 2;
      const lx = cx + r * 0.62 * Math.cos(mid), ly = cy + r * 0.62 * Math.sin(mid);
      out += `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" fill="#fff" font-size="12" font-weight="700" text-anchor="middle">${(frac * 100).toFixed(0)}%</text>`;
    }
    ang = a2;
  }
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${out}</svg>`;
}

// --- Gráfico de barras (SVG) ------------------------------------------------
function svgBars(data: { label: string; value: number; color: string }[], w = 470, h = 210): string {
  const padL = 12, padR = 12, padT = 18, padB = 30;
  const iw = w - padL - padR, ih = h - padT - padB;
  const max = Math.max(...data.map((d) => d.value), 1);
  const gap = iw / Math.max(data.length, 1);
  const bw = gap * 0.6;
  let out = `<line x1="${padL}" y1="${padT + ih}" x2="${w - padR}" y2="${padT + ih}" stroke="#cbd5e1"/>`;
  data.forEach((d, i) => {
    const bh = (d.value / max) * ih;
    const x = padL + gap * i + (gap - bw) / 2;
    const y = padT + ih - bh;
    out += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(bh, 1).toFixed(1)}" rx="3" fill="${d.color}"/>`;
    out += `<text x="${(x + bw / 2).toFixed(1)}" y="${(y - 4).toFixed(1)}" font-size="9" text-anchor="middle" fill="#334155" font-weight="600">${esc(solesK(d.value))}</text>`;
    out += `<text x="${(x + bw / 2).toFixed(1)}" y="${(padT + ih + 15).toFixed(1)}" font-size="9.5" text-anchor="middle" fill="#64748b">${esc(d.label)}</text>`;
  });
  return `<svg width="100%" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet">${out}</svg>`;
}

function barra(pct: number): string {
  const w = Math.max(0, Math.min(100, pct));
  return `<div class="barwrap"><div class="bar" style="width:${w.toFixed(1)}%"></div></div>`;
}

export function informeComprasHtml(a: AnalisisCompras): string {
  // Datos para gráficos.
  const funcPie = a.porFuncion.map((f, i) => ({ label: `${f.cod} ${f.nombre}`, value: f.debe, color: PAL[i % PAL.length] }));
  const natBars = a.porNaturaleza.slice(0, 8).map((n, i) => ({ label: n.cod, value: n.debe, color: PAL[i % PAL.length] }));
  const ccBars = a.porCentroCosto.slice(0, 8).map((c, i) => ({ label: c.cod, value: c.debe, color: PAL[i % PAL.length] }));
  const porMes = a.porMes ?? [];
  const mesBars = porMes.map((m, i) => ({ label: m.nombre.replace(/ \d{4}$/, ""), value: m.debe, color: PAL[i % PAL.length] }));
  const leyenda = funcPie.map((d) => `<span class="lg"><i style="background:${d.color}"></i>${esc(d.label)} — <strong>${soles(d.value)}</strong></span>`).join("");

  const funcRows = a.porFuncion.map((f, i) => `
    <tr>
      <td><span class="dot" style="background:${PAL[i % PAL.length]}"></span><strong>${esc(f.cod)}</strong> · ${esc(f.nombre)}</td>
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

  const clase9 = a.porFuncion.map((f, i) => `
    <table class="tbl detalle">
      <thead>
        <tr class="grp"><td colspan="4"><span class="dot" style="background:${PAL[i % PAL.length]}"></span><strong>${esc(f.cod)} · ${esc(f.nombre)}</strong> — ${soles(f.debe)} (${f.pct.toFixed(1)}%)</td></tr>
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

  const detalle = a.detalleCuentas.map((g) => `
    <table class="tbl detalle">
      <thead>
        <tr class="grp"><td colspan="4"><span class="dot" style="background:#1d4ed8"></span><strong>${esc(g.cuenta)}</strong> · ${esc(g.funcion)} — ${esc(g.concepto)} — ${soles(g.total)} (${g.movimientos.length} mov.)</td></tr>
        <tr class="th"><th>Fecha</th><th>Glosa</th><th>Factura / Doc.</th><th class="num">Importe</th></tr>
      </thead>
      <tbody>
        ${g.movimientos.map((m) => `
          <tr>
            <td>${esc(m.fecha)}${m.cenCos ? ` <span class="mut">(${esc(m.cenCos)})</span>` : ""}</td>
            <td>${esc(m.glosa)}</td>
            <td class="mono">${esc(m.documento)}</td>
            <td class="num">${soles(m.debe)}</td>
          </tr>`).join("")}
      </tbody>
    </table>`).join("");

  const rev = a.revision;
  const revRows = (rev?.hallazgos ?? []).map((h) => `
    <tr>
      <td><span class="conf ${h.confianza}">${esc(h.confianza)}</span></td>
      <td class="mono"><strong>${esc(h.documento || "—")}</strong><div class="mut">${esc(h.fecha || "")}</div></td>
      <td class="mono">${esc(h.cuenta)}<div class="mut">${esc(h.funcionActual)}</div></td>
      <td>${esc(h.glosa)}</td>
      <td class="num">${soles(h.importe)}</td>
      <td class="mono" style="color:#047857"><strong>${esc(h.cuentaSugerida)}</strong><div class="mut">${esc(h.subcuenta)}</div></td>
      <td>${esc(h.motivo)}</td>
    </tr>`).join("");

  const hoy = new Date().toLocaleDateString("es-PE", { day: "2-digit", month: "long", year: "numeric" });

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"/>
<style>
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", Arial, sans-serif; color: #1e293b; font-size: 11px; margin: 0; }
  .page { padding: 2px; }
  h1 { font-size: 21px; margin: 0 0 2px; }
  h2 { font-size: 13px; margin: 20px 0 8px; padding: 6px 10px; color: #fff;
       background: linear-gradient(90deg, #102b4d, #234d82); border-left: 5px solid #dca200;
       border-radius: 4px; text-transform: uppercase; letter-spacing: .5px; }
  .sub { color: #e2e8f0; font-size: 11px; margin: 0; }
  .head { background: linear-gradient(120deg, #102b4d, #234d82); color: #fff; padding: 16px 18px;
          border-radius: 10px; border-bottom: 4px solid #dca200; }
  .head h1 { color: #fff; }
  .meta { color: #cbd5e1; font-size: 10px; margin-top: 6px; }
  .kpis { display: flex; gap: 10px; margin: 12px 0; }
  .kpi { flex: 1; border: 1px solid #dbe4f0; border-radius: 8px; padding: 9px 11px; background: #f7f9fc; }
  .kpi .lbl { color: #64748b; font-size: 9px; text-transform: uppercase; letter-spacing: .4px; }
  .kpi .val { font-size: 16px; font-weight: 700; margin-top: 2px; color: #102b4d; }
  .kpi.big { background: linear-gradient(120deg, #1d4ed8, #234d82); border: none; }
  .kpi.big .lbl { color: #dbeafe; }
  .kpi.big .val { color: #fff; }
  .charts { display: flex; gap: 12px; margin: 10px 0; page-break-inside: avoid; }
  .chart { flex: 1; border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px 12px; background: #fff; }
  .chart h3 { font-size: 11px; margin: 0 0 6px; color: #102b4d; font-weight: 700; }
  .chart.pie { display: flex; flex-direction: column; align-items: center; }
  .legend { margin-top: 6px; display: flex; flex-wrap: wrap; gap: 4px 12px; justify-content: center; }
  .lg { font-size: 9.5px; color: #334155; }
  .lg i { display: inline-block; width: 9px; height: 9px; border-radius: 2px; margin-right: 4px; vertical-align: middle; }
  table.tbl { width: 100%; border-collapse: collapse; margin-top: 6px; }
  table.tbl th { text-align: left; font-size: 9px; text-transform: uppercase; color: #475569;
                 border-bottom: 2px solid #cbd5e1; padding: 4px 6px; }
  table.tbl td { padding: 4px 6px; border-bottom: 1px solid #eef2f7; vertical-align: middle; }
  .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .pct { text-align: right; color: #64748b; white-space: nowrap; }
  .mono { font-family: "Consolas", monospace; }
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 5px; vertical-align: middle; }
  .barcell { width: 120px; }
  .barwrap { background: #e8edf5; border-radius: 3px; height: 9px; width: 100%; overflow: hidden; }
  .bar { background: linear-gradient(90deg, #1d4ed8, #0ea5e9); height: 9px; }
  .grp td { background: #eef3fa; border-top: 2px solid #1d4ed8; padding: 5px 6px; color: #102b4d; }
  .detalle { margin-bottom: 10px; page-break-inside: avoid; }
  .detalle .th th { border-bottom: 1px solid #dbe4f0; }
  .totalrow td { font-weight: 700; border-top: 2px solid #1d4ed8; color: #102b4d; background: #f7f9fc; }
  tr { page-break-inside: avoid; }
  thead { display: table-header-group; }
  .foot { margin-top: 24px; border-top: 2px solid #dca200; padding-top: 6px; color: #94a3b8; font-size: 9px; }
  .mut { color: #94a3b8; font-size: 8.5px; }
  .conf { display: inline-block; padding: 1px 5px; border-radius: 3px; font-size: 8px; font-weight: 700; text-transform: uppercase; }
  .conf.alta { background: #fee2e2; color: #b91c1c; }
  .conf.media { background: #fef3c7; color: #b45309; }
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

  <div class="charts">
    <div class="chart pie">
      <h3>Gasto por función (destino)</h3>
      ${svgPie(funcPie)}
      <div class="legend">${leyenda}</div>
    </div>
    <div class="chart">
      <h3>Gasto por naturaleza (clase 6)</h3>
      ${svgBars(natBars)}
    </div>
  </div>

  ${mesBars.length > 1 ? `
  <div class="chart" style="margin-bottom:10px;">
    <h3>Gasto por mes</h3>
    ${svgBars(mesBars, 940, 200)}
  </div>` : ""}

  <div class="chart" style="margin-bottom:10px;">
    <h3>Gasto por centro de costo</h3>
    ${svgBars(ccBars, 940, 200)}
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

  <h2>Revisión de clasificación (reclasificación sugerida)</h2>
  ${rev && rev.observados > 0 ? `
  <p style="margin:0 0 6px;color:#475569;">Se detectaron <strong>${rev.observados}</strong> de ${rev.total} movimiento(s) con posible mala clasificación (${soles(rev.importeObservado)}). ${rev.correctos} correctos.</p>
  <table class="tbl">
    <thead><tr><th>Conf.</th><th>Factura / Doc.</th><th>Cuenta actual</th><th>Glosa</th><th class="num">Importe</th><th>Reclasificar a</th><th>Motivo</th></tr></thead>
    <tbody>${revRows}</tbody>
  </table>
  <p class="mut" style="margin-top:4px;">Sugerencias para revisión del contador (no se modifica nada). La cuenta sugerida mantiene la naturaleza y corrige la función. Referencia: 94 Administración · 95 Ventas · 97 Financieros.</p>
  ` : `<p style="color:#047857;">✓ No se detectaron errores de clasificación evidentes. Los ${rev?.total ?? 0} movimientos están asignados por función de forma coherente (94 Administración · 95 Ventas · 97 Financieros).</p>`}

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

  ${porMes.length > 1 ? `
  <h2>Gasto por mes</h2>
  <table class="tbl">
    <thead><tr><th>Mes</th><th class="num">Nº mov.</th><th class="num">Importe</th></tr></thead>
    <tbody>${porMes.map((m) => `<tr><td>${esc(m.nombre)}</td><td class="num">${m.n}</td><td class="num">${soles(m.debe)}</td></tr>`).join("")}
      <tr class="totalrow"><td>TOTAL</td><td class="num">${a.nMovimientos}</td><td class="num">${soles(a.totalGasto)}</td></tr>
    </tbody>
  </table>` : ""}

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

  <h2>Anexo: detalle por cuenta (clase 9)</h2>
  ${detalle}

  <div class="foot">Documento generado automáticamente para uso de gerencia. Cifras en soles (S/).</div>

</div></body></html>`;
}
