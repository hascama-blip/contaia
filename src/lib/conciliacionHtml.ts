import type { ConciliacionEmpresa } from "./conciliacionSire";
import type { CierrePeriodo } from "./cronogramaSunat";

// Informe PDF de la conciliación SIRE vs contabilidad: SOLO RESUMEN (cierre +
// resumen por empresa). El detalle comprobante por comprobante va en el Excel.

type FilaCierre = CierrePeriodo & { empresa: string; ruc: string; conciliada: boolean; pendientes: number; difTotal: number; difIgv: number };

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const soles = (n: number) => `S/ ${Number(n || 0).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre"];
const fechaCorta = (iso: string) => { const [y, m, d] = iso.split("-"); return `${d}/${m}/${y}`; };
const fechaLarga = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); return `${d} de ${MESES[m - 1]} de ${y}`; };
const ESTADO: Record<string, [string, string]> = {
  vencido: ["Vencido", "#dc2626"], "vence-hoy": ["Vence hoy", "#dc2626"], urgente: ["Urgente", "#b45309"], "en-plazo": ["En plazo", "#047857"],
};

export function informeConciliacionHtml(empresas: ConciliacionEmpresa[], cierre: FilaCierre[], hoy: string): string {
  const per = empresas[0]?.periodo || "";
  const nombrePer = /^\d{6}$/.test(per) ? `${MESES[Number(per.slice(4)) - 1]} ${per.slice(0, 4)}` : per;
  const libro = empresas.every((e) => e.libro === "compras") ? "Compras (RCE)" : empresas.some((e) => e.libro === "compras") ? "Ventas y compras" : "Ventas (RVIE)";
  const tS = empresas.reduce((a, e) => a + e.cruce.totalesSire.total, 0);
  const tC = empresas.reduce((a, e) => a + e.cruce.totalesContable.total, 0);
  const pend = (e: ConciliacionEmpresa) => e.cruce.difMonto + e.cruce.difFecha + e.cruce.soloSire + e.cruce.soloContable + e.docDistinto;
  const cuadran = empresas.filter((e) => pend(e) === 0).length;

  const filasCierre = cierre.map((c) => {
    const [txt, color] = ESTADO[c.estado] ?? [c.estado, "#334155"];
    const tiempo = c.estado === "vencido" ? `Vencido hace ${-c.diasCalendario} día(s)` : c.estado === "vence-hoy" ? "Vence hoy" : `${c.diasHabiles} día(s) hábil(es) · ${c.diasCalendario} calendario`;
    return `<tr><td><strong>${esc(c.empresa)}</strong></td><td class="c">${esc(c.ultimoDigito)}</td><td>${fechaCorta(c.vence)}${c.oficial ? "" : " <span class='mut'>(ref.)</span>"}</td>
      <td style="color:${color}">${tiempo}</td>
      <td class="num">${!c.conciliada ? "<span class='mut'>Sin SIRE</span>" : c.pendientes ? `${c.pendientes} comprob.` : "Nada"}</td>
      <td class="num">${c.conciliada ? soles(c.difTotal) : "—"}</td><td class="num">${c.conciliada ? soles(c.difIgv) : "—"}</td>
      <td><span class="tag" style="background:${color}">${txt}</span></td></tr>`;
  }).join("");

  const filasEmp = empresas.map((e) => {
    const c = e.cruce, p = pend(e), dif = c.totalesSire.total - c.totalesContable.total;
    return `<tr><td><strong>${esc(e.empresa)}</strong><div class="mut">RUC ${esc(e.ruc)}${empresas.some((x) => x.libro === "compras") ? ` · ${e.libro}` : ""}</div></td>
      <td class="num">${soles(c.totalesSire.total)}<div class="mut">${c.totalesSire.comprobantes} comprob.</div></td>
      <td class="num">${soles(c.totalesContable.total)}<div class="mut">${c.totalesContable.comprobantes} comprob.</div></td>
      <td class="num" style="color:${Math.abs(dif) > 1 ? "#dc2626" : "#94a3b8"}">${soles(dif)}</td>
      <td class="num">${c.ok}</td><td class="num">${c.difMonto || "—"}</td><td class="num">${c.difFecha || "—"}</td>
      <td class="num">${c.soloSire || "—"}</td><td class="num">${c.soloContable || "—"}</td>
      <td class="num">${e.subdiario?.conciliados ? e.subdiario.conciliados : "—"}</td>
      <td><span class="tag" style="background:${p ? "#b45309" : "#047857"}">${p ? `Revisar ${p}` : "Cuadra"}</span></td></tr>`;
  }).join("");

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"/><style>
  * { box-sizing: border-box; } body { font-family: "Segoe UI", Arial, sans-serif; color: #1e293b; font-size: 10.5px; margin: 0; }
  .head { background: linear-gradient(120deg, #102b4d, #234d82); color: #fff; padding: 16px 18px; border-radius: 10px; border-bottom: 4px solid #dca200; }
  .head h1 { margin: 0; font-size: 19px; } .head p { margin: 4px 0 0; color: #cbd5e1; font-size: 10.5px; }
  .kpis { display: flex; gap: 10px; margin: 12px 0; } .kpi { flex: 1; border: 1px solid #dbe4f0; border-radius: 8px; padding: 8px 10px; background: #f7f9fc; }
  .kpi .l { color: #64748b; font-size: 8.5px; text-transform: uppercase; letter-spacing: .4px; } .kpi .v { font-size: 15px; font-weight: 700; color: #102b4d; margin-top: 2px; }
  h2 { font-size: 12px; margin: 18px 0 6px; padding: 6px 10px; color: #fff; background: linear-gradient(90deg, #102b4d, #234d82); border-left: 5px solid #dca200; border-radius: 4px; text-transform: uppercase; letter-spacing: .5px; }
  table { width: 100%; border-collapse: collapse; } th { text-align: left; font-size: 8.5px; text-transform: uppercase; color: #475569; border-bottom: 2px solid #cbd5e1; padding: 4px 5px; }
  td { padding: 5px; border-bottom: 1px solid #eef2f7; vertical-align: top; } .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; } .c { text-align: center; }
  .mut { color: #94a3b8; font-size: 8.5px; } .tag { color: #fff; border-radius: 3px; padding: 1px 6px; font-size: 8.5px; font-weight: 700; white-space: nowrap; }
  .nota { color: #64748b; font-size: 8.5px; margin-top: 6px; line-height: 1.5; } tr { page-break-inside: avoid; }
  .foot { margin-top: 20px; border-top: 2px solid #dca200; padding-top: 6px; color: #94a3b8; font-size: 8.5px; }
  </style></head><body>
  <div class="head">
    <h1>Conciliación SIRE vs contabilidad · ${esc(libro)}</h1>
    <p>Periodo ${esc(nombrePer)} · ${empresas.length} empresa(s) · Informe al ${fechaLarga(hoy)}</p>
  </div>
  <div class="kpis">
    <div class="kpi"><div class="l">Total SIRE</div><div class="v">${soles(tS)}</div></div>
    <div class="kpi"><div class="l">Total contabilidad</div><div class="v">${soles(tC)}</div></div>
    <div class="kpi"><div class="l">Diferencia</div><div class="v" style="color:${Math.abs(tS - tC) > 1 ? "#dc2626" : "#047857"}">${soles(tS - tC)}</div></div>
    <div class="kpi"><div class="l">Empresas que cuadran</div><div class="v">${cuadran} de ${empresas.length}</div></div>
  </div>
  ${cierre.length ? `<h2>Análisis de cierre</h2>
  <table><thead><tr><th>Empresa</th><th class="c">Dígito</th><th>Vence DJ mensual</th><th>Tiempo para regularizar</th><th class="num">Por regularizar</th><th class="num">Dif. total</th><th class="num">Dif. IGV</th><th>Estado</th></tr></thead>
  <tbody>${filasCierre}</tbody></table>
  <p class="nota">Vencimiento según el cronograma SUNAT de obligaciones mensuales por último dígito del RUC. Las diferencias deben regularizarse (registro contable o propuesta SIRE) antes de generar el RVIE/RCE y presentar la declaración mensual (PDT 621). Declarar fuera de plazo puede generar multa (art. 176, num. 1 del Código Tributario), con rebaja por gradualidad si se subsana antes de que SUNAT lo detecte.</p>` : ""}
  <h2>Resumen por empresa</h2>
  <table><thead><tr><th>Empresa</th><th class="num">SIRE</th><th class="num">Contabilidad</th><th class="num">Diferencia</th><th class="num">OK</th><th class="num">Montos</th><th class="num">Fecha</th><th class="num">Solo SIRE</th><th class="num">Solo cont.</th><th class="num">Subdiario</th><th>Estado</th></tr></thead>
  <tbody>${filasEmp}</tbody></table>
  <p class="nota">Conciliación factura por factura (tipo + serie + número) y por monto (base, IGV, total) y fecha, con tolerancia de S/ 1. "Subdiario" = comprobantes encontrados en el subdiario de misceláneos. El detalle comprobante por comprobante está en el Excel de conciliación.</p>
  <div class="foot">Documento generado automáticamente para uso de gerencia. Cifras en soles (S/).</div>
  </body></html>`;
}
