import type { Proyeccion, AnalisisDetalle, GrupoDetalle } from "./proyeccion";
import { REGIMEN_LABEL } from "./planeamiento";

// Informe PDF de la PROYECCIÓN TRIBUTARIA del mes (A4 vertical): cuánto se pagará
// de IGV y renta según el SIRE + análisis del Detalle SIRE (ventas y compras).

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const soles = (n: number) => { const v = Number(n || 0); const t = `S/ ${Math.abs(v).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; return v < 0 ? `(${t})` : t; };
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre"];
const fechaCorta = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split("-"); return `${d}/${m}/${y}`; };
const fechaLarga = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); return `${d} de ${MESES[m - 1]} de ${y}`; };

function tablaGrupos(titulo: string, col: string, filas: GrupoDetalle[], conRuc: boolean): string {
  if (!filas.length) return "";
  return `<h3>${esc(titulo)}</h3>
  <table><thead><tr><th>${esc(col)}</th><th class="num">Comprob.</th><th class="num">Base</th><th class="num">IGV</th><th class="num">Total</th><th class="num">%</th></tr></thead><tbody>
  ${filas.map((g) => `<tr><td>${esc(g.nombre || "—")}${conRuc && g.ruc ? `<div class="mut">${esc(g.ruc)}</div>` : ""}</td><td class="num">${g.comprobantes}</td><td class="num">${soles(g.base)}</td><td class="num">${soles(g.igv)}</td><td class="num">${soles(g.total)}</td><td class="num">${g.pct.toFixed(1)}%</td></tr>`).join("")}
  </tbody></table>`;
}

function bloqueDetalle(titulo: string, a: AnalisisDetalle | null, contraparte: string): string {
  if (!a) return `<h2>${esc(titulo)}</h2><p class="nota">No se ha generado el Detalle SIRE de este libro para el periodo.</p>`;
  if (!a.comprobantes) return `<h2>${esc(titulo)}</h2><p class="nota">Sin comprobantes en el periodo.</p>`;
  return `<h2>${esc(titulo)}</h2>
  <p class="nota" style="margin:0 0 4px">${a.comprobantes} comprobante(s) · ${a.contrapartes} ${contraparte === "Cliente" ? "cliente(s)" : "proveedor(es)"} · base ${soles(a.base)} · IGV ${soles(a.igv)} · total ${soles(a.total)}${a.notasCredito.comprobantes ? ` · ${a.notasCredito.comprobantes} nota(s) de crédito por ${soles(a.notasCredito.total)}` : ""}${a.monedaExtranjera ? ` · ${a.monedaExtranjera} en moneda extranjera (convertidos a soles)` : ""}</p>
  ${tablaGrupos("Por tipo de comprobante", "Tipo", a.porTipo, false)}
  ${tablaGrupos(contraparte === "Cliente" ? "Principales clientes" : "Principales proveedores", contraparte, a.top, true)}`;
}

export function informeProyeccionHtml(p: Proyeccion, hoy: string): string {
  const r = p.resultado!, e = p.entradas;
  const per = `${MESES[Number(p.periodo.slice(4)) - 1]} ${p.periodo.slice(0, 4)}`;
  const sinIgv = e.regimen === "rus" || e.regimen === "ninguno";
  const c = p.cierre;
  const vence = !c ? "—" : fechaCorta(c.vence);
  const venceSub = !c ? "" : c.estado === "vencido" ? `Vencido hace ${-c.diasCalendario} día(s)` : c.estado === "vence-hoy" ? "Vence hoy" : `Faltan ${c.diasHabiles} día(s) hábil(es)${c.oficial ? "" : " (ref.)"}`;
  const fila = (l: string, v: number, cls = "") => `<tr class="${cls}"><td>${esc(l)}</td><td class="num">${soles(v)}</td></tr>`;
  const fuente = (l: string, f: { at: string; comprobantes?: number } | null) =>
    `<tr><td>${esc(l)}</td><td>${f ? `<span class="tag ok">Generado</span>` : `<span class="tag no">Falta</span>`}</td><td>${f ? `${f.comprobantes !== undefined ? `${f.comprobantes} comprob. · ` : ""}${f.at ? fechaCorta(f.at) : ""}` : "—"}</td></tr>`;

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"/><style>
  * { box-sizing: border-box; } body { font-family: "Segoe UI", Arial, sans-serif; color: #1e293b; font-size: 10px; margin: 0; }
  .head { background: linear-gradient(120deg, #102b4d, #234d82); color: #fff; padding: 14px 16px; border-radius: 10px; border-bottom: 4px solid #dca200; }
  .head h1 { margin: 0; font-size: 18px; } .head p { margin: 4px 0 0; color: #cbd5e1; font-size: 10px; }
  .kpis { display: flex; gap: 8px; margin: 10px 0; } .kpi { flex: 1; border: 1px solid #dbe4f0; border-radius: 8px; padding: 7px 9px; background: #f7f9fc; }
  .kpi .l { color: #64748b; font-size: 8px; text-transform: uppercase; letter-spacing: .4px; } .kpi .v { font-size: 15px; font-weight: 700; color: #102b4d; margin-top: 2px; } .kpi .s { color: #64748b; font-size: 8px; margin-top: 1px; }
  h2 { font-size: 11px; margin: 14px 0 6px; padding: 5px 9px; color: #fff; background: linear-gradient(90deg, #102b4d, #234d82); border-left: 5px solid #dca200; border-radius: 4px; text-transform: uppercase; letter-spacing: .5px; page-break-after: avoid; }
  h3 { font-size: 9.5px; margin: 8px 0 3px; color: #102b4d; text-transform: uppercase; letter-spacing: .4px; page-break-after: avoid; }
  table { width: 100%; border-collapse: collapse; } th { text-align: left; font-size: 8px; text-transform: uppercase; color: #475569; border-bottom: 2px solid #cbd5e1; padding: 3px 5px; }
  td { padding: 4px 5px; border-bottom: 1px solid #eef2f7; vertical-align: top; } .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .dos { display: flex; gap: 12px; } .dos > div { flex: 1; min-width: 0; }
  tr.f td { font-weight: 700; } tr.t td { font-weight: 700; background: #eef3fa; color: #102b4d; } tr.v td { color: #047857; } tr { page-break-inside: avoid; }
  .mut { color: #94a3b8; font-size: 8px; } .tag { color: #fff; border-radius: 3px; padding: 1px 6px; font-size: 8px; font-weight: 700; } .ok { background: #047857; } .no { background: #b45309; }
  .manual { border: 1px solid #fde68a; background: #fffbeb; border-radius: 8px; padding: 8px 10px; margin-top: 8px; }
  .nota { color: #64748b; font-size: 8.5px; margin-top: 6px; line-height: 1.5; } ul { margin: 4px 0 0; padding-left: 16px; } li { margin-bottom: 3px; line-height: 1.45; }
  .foot { margin-top: 16px; border-top: 2px solid #dca200; padding-top: 6px; color: #94a3b8; font-size: 8px; }
  </style></head><body>
  <div class="head">
    <h1>Proyección tributaria · ${esc(per)}</h1>
    <p>${esc(p.empresa.razonSocial)} · RUC ${esc(p.empresa.ruc)} · ${esc(REGIMEN_LABEL[e.regimen])} · Informe al ${fechaLarga(hoy)}</p>
  </div>
  <div class="kpis">
    <div class="kpi"><div class="l">IGV a pagar</div><div class="v" style="color:${r.igvAPagar > 0 ? "#dc2626" : "#047857"}">${soles(r.igvAPagar)}</div><div class="s">${r.saldoFavorSiguiente > 0 ? `Saldo a favor: ${soles(r.saldoFavorSiguiente)}` : sinIgv ? "No aplica" : "Débito − crédito − saldos"}</div></div>
    <div class="kpi"><div class="l">${e.regimen === "rus" ? "Cuota Nuevo RUS" : "Renta (pago a cuenta)"}</div><div class="v">${soles(r.rentaAPagar)}</div><div class="s">${esc(r.baseTasa || "No aplica")}</div></div>
    <div class="kpi"><div class="l">Total a pagar</div><div class="v">${soles(r.totalAPagar)}</div><div class="s">${esc(per)}</div></div>
    <div class="kpi"><div class="l">Vence la DJ mensual</div><div class="v">${vence}</div><div class="s">${esc(venceSub)}</div></div>
  </div>

  <div class="manual"><strong>Crédito a favor de la DJ mensual anterior (dato manual):</strong>
    ${sinIgv ? "no aplica para este régimen." : e.saldoFavorIgv > 0 ? `<strong>SÍ</strong> — saldo a favor de IGV de ${soles(e.saldoFavorIgv)} (casilla 145 del PDT 621).` : "<strong>NO</strong> tiene saldo a favor de IGV del mes anterior."}
    ${!sinIgv && (e.percepciones > 0 || e.retenciones > 0) ? ` Percepciones: ${soles(e.percepciones)} · Retenciones: ${soles(e.retenciones)}.` : ""}
    ${e.saldoFavorRenta > 0 ? ` Saldo a favor de renta: ${soles(e.saldoFavorRenta)}.` : ""}
  </div>

  <h2>Cálculo de la proyección</h2>
  <div class="dos">
    <div><h3>IGV — cuenta propia</h3><table><tbody>
      ${fila("Ventas gravadas (base)", r.ventasBase)}
      ${fila("IGV de ventas (débito fiscal)", r.debitoFiscal)}
      ${fila("Compras gravadas (base)", r.comprasBase)}
      ${fila("IGV de compras (crédito fiscal)", -r.creditoFiscal)}
      ${fila("Tributo resultante", r.tributoResultante, "f")}
      ${fila("(−) Saldo a favor mes anterior", -r.saldoFavorAnterior)}
      ${fila("Impuesto resultante", r.impuestoResultante, "f")}
      ${fila("(−) Percepciones aplicadas", -r.percepcionesAplicadas)}
      ${fila("(−) Retenciones aplicadas", -r.retencionesAplicadas)}
      ${fila("IGV a pagar", r.igvAPagar, "t")}
      ${r.saldoFavorSiguiente > 0 ? fila("Saldo a favor para el mes siguiente", r.saldoFavorSiguiente, "v") : ""}
      ${r.saldoPercepcionesSiguiente > 0 ? fila("Saldo de percepciones/retenciones por aplicar", r.saldoPercepcionesSiguiente, "v") : ""}
    </tbody></table></div>
    <div><h3>Renta — ${esc(REGIMEN_LABEL[e.regimen])}</h3><table><tbody>
      ${fila("Ingresos netos del mes", r.ingresosNetos)}
      ${e.regimen === "mype" ? fila(`Ingresos acumulados del año (tope 300 UIT = ${soles(r.topeRmt)})`, r.ingresosAcumulados) : ""}
      <tr><td>Tasa aplicada</td><td class="num" style="white-space:normal">${esc(r.baseTasa || "—")}</td></tr>
      ${fila(e.regimen === "rus" ? "Cuota mensual" : "Pago a cuenta", r.pagoACuenta, "f")}
      ${fila("(−) Saldo a favor de renta", -r.saldoFavorRentaAplicado)}
      ${fila("Renta a pagar", r.rentaAPagar, "t")}
    </tbody></table>
    <h3 style="margin-top:12px">Fuentes de la información</h3><table><tbody>
      ${fuente("SIRE del mes (Reporte analítico)", p.fuentes.resumen)}
      ${fuente("Detalle SIRE — ventas (RVIE)", p.fuentes.detalleVentas)}
      ${fuente("Detalle SIRE — compras (RCE)", p.fuentes.detalleCompras)}
    </tbody></table>
    <p class="nota">Cálculo hecho con: <strong>${p.base === "detalle" ? "Detalle SIRE (comprobante por comprobante, en soles)" : "SIRE del mes (resumen)"}</strong>.</p></div>
  </div>

  ${r.recomendaciones.length ? `<h2>Planeamiento y recomendaciones</h2><ul>${r.recomendaciones.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : ""}

  ${p.cuadre.length ? `<h2>Cuadre: SIRE del mes vs Detalle SIRE</h2>
  <table><thead><tr><th>Libro</th><th>Concepto</th><th class="num">SIRE del mes</th><th class="num">Detalle SIRE</th><th class="num">Diferencia</th></tr></thead><tbody>
  ${p.cuadre.map((x) => { const n = x.concepto === "Comprobantes"; const mal = n ? x.diferencia !== 0 : Math.abs(x.diferencia) > 1; return `<tr><td>${x.libro === "ventas" ? "Ventas" : "Compras"}</td><td>${esc(x.concepto)}</td><td class="num">${n ? x.resumen : soles(x.resumen)}</td><td class="num">${n ? x.detalle : soles(x.detalle)}</td><td class="num" style="color:${mal ? "#dc2626" : "#94a3b8"}">${n ? x.diferencia : soles(x.diferencia)}</td></tr>`; }).join("")}
  </tbody></table>
  <p class="nota">${p.cuadra ? "El resumen y el detalle coinciden." : "Hay diferencias entre el resumen y el detalle (comprobantes en moneda extranjera, notas de crédito o extracciones hechas en fechas distintas): conviene volver a generar ambos antes de declarar."}</p>` : ""}

  ${bloqueDetalle("Ventas del mes — Detalle SIRE (RVIE)", p.ventas, "Cliente")}
  ${bloqueDetalle("Compras del mes — Detalle SIRE (RCE)", p.compras, "Proveedor")}

  <p class="nota">Estimación para planificar el pago del mes. No incluye prorrata del crédito fiscal, ajustes, comprobantes fuera del SIRE, IGV de importaciones no anotado ni otros tributos (ESSALUD, ONP, 4ta/5ta). Verificar con la propuesta del SIRE antes de presentar la declaración (PDT 621).</p>
  <div class="foot">Documento generado automáticamente para uso de gerencia. Cifras en soles (S/).</div>
  </body></html>`;
}
