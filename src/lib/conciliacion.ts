// ============================================================
//  Conciliación bancaria — extracto (PDF) vs libro banco (Excel) vs caja virtual (Excel)
// ============================================================
// Punto en común descubierto con archivos reales (BCP + Contasis + caja):
//   - Extracto BCP (PDF): cada movimiento trae un N° DE OPERACIÓN de 6 dígitos.
//   - Libro banco: columna "Nro. Doc." termina en esos mismos 6 dígitos.
//   - Caja virtual: columna "Nro. Referencia" = el mismo N° de operación (YAPE/transf).
// Match primario por N° de operación (95%+ con 0 diferencias de monto en la
// prueba real); respaldo por fecha (±2 días) + monto exacto + mismo sentido.

import ExcelJS from "exceljs";

export interface MovBanco {
  fecha: string;        // YYYY-MM-DD (fecha proceso)
  desc: string;
  numOp: string;        // 6 dígitos ("" si no tiene)
  monto: number;
  tipo: "abono" | "cargo";
}
export interface FilaLibro {
  fecha: string;
  compr: string;
  doc: string;
  numOp: string;
  glosa: string;
  ingreso: number;
  egreso: number;
  cuenta: string;
}
export interface FilaCaja {
  fecha: string;
  tipoPago: string;
  ref: string;          // 6 dígitos ("" si no tiene)
  contratante: string;
  comprobante: string;
  total: number;
}

export interface ResultadoConciliacion {
  periodo: { desde: string; hasta: string };
  resumen: {
    movsBanco: number; abonosBanco: number; cargosBanco: number;
    totalAbonos: number; totalCargos: number;
    filasLibro: number; totalIngresos: number; totalEgresos: number;
    filasCaja: number; cajaConRef: number;
    conciliadosOp: number; conciliadosFechaMonto: number;
    bancoSinLibro: number; libroSinBanco: number; cajaSinBanco: number;
    pctConciliado: number;
  };
  conciliados: { banco: MovBanco; libro: FilaLibro; metodo: string; caja?: FilaCaja }[];
  bancoSinLibro: (MovBanco & { caja?: FilaCaja })[];
  libroSinBanco: FilaLibro[];
  cajaSinBanco: FilaCaja[];
}

const num = (s: unknown) => Number(String(s ?? "").replace(/,/g, "")) || 0;
const fechaLocal = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// ---- 1) Extracto bancario (PDF con capa de texto, formato BCP) ---------------
export async function parseExtractoBcp(buf: Buffer): Promise<{ desde: string; hasta: string; movs: MovBanco[] }> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const res: any = await extractText(pdf, { mergePages: false });
  const pages: string[] = (Array.isArray(res?.text) ? res.text : [res?.text]).map((p: any) => String(p ?? ""));

  // Periodo de la cabecera: "01/01/2026 31/01/2026".
  const per = pages[0]?.match(/(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})/);
  const aISO = (s: string) => { const m = s.match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : ""; };
  const desde = per ? aISO(per[1]) : "";
  const hasta = per ? aISO(per[2]) : "";
  const anio = (hasta || desde).slice(0, 4) || String(new Date().getFullYear());

  const movs: MovBanco[] = [];
  for (const pg of pages) {
    for (const raw of pg.split("\n")) {
      const line = raw.trim();
      // Patrón principal: dd-mm [dd-mm valor] DESC … NUMOP(6) HH:MM COD TIPO(4) MONTO[-] [SALDO]
      const m = line.match(/^(\d{2})-(\d{2})\s+(.*?)\s+(\d{6})\s+(\d{2}:\d{2})\s+(\S+)\s+(\d{4})\s+([\d,]+\.\d{2})(-?)(?:\s+[\d,]+\.\d{2}-?)?$/);
      if (m) {
        const [, dd, mes, descTramo, numOp, , , , montoTxt, neg] = m;
        const desc = descTramo
          .replace(/^(\d{2}-\d{2})\s+/, "")                 // fecha valor pegada
          .replace(/\s+[A-Z]{3}\s+\d{3}-\d{3}$/, "")        // MED + LUGAR al final
          .trim();
        movs.push({ fecha: `${anio}-${mes}-${dd}`, desc, numOp, monto: num(montoTxt), tipo: neg === "-" ? "cargo" : "abono" });
        continue;
      }
      // Respaldo: comisiones/ITF/mantenimiento SIN hora ni N° op estándar, p.ej.
      // "19-01 IMPUESTO ITF INT - 0909 2.15-" / "31-01 COM.MANTENIM ¥ INT - 0101 35.00-"
      const f = line.match(/^(\d{2})-(\d{2})\s+(.*?)\s+(\d{4})\s+([\d,]+\.\d{2})(-?)(?:\s+[\d,]+\.\d{2}-?)?$/);
      if (f) {
        const [, dd, mes, descTramo, , montoTxt, neg] = f;
        const op6 = (descTramo.match(/\b(\d{6})\b/) || [])[1] || "";
        const desc = descTramo
          .replace(/\b\d{6}\b/, "")
          .replace(/\s+[A-Z]{3}\s+\d{3}-\d{3}.*$/, "")
          .replace(/\s+(INT|TLC|VEN|BPI|CAJ|POS|BPT)\s*[-¥]?\s*\S*$/, "")
          .replace(/[¥]/g, "")
          .replace(/\s+/g, " ")
          .trim();
        if (desc) movs.push({ fecha: `${anio}-${mes}-${dd}`, desc, numOp: op6, monto: num(montoTxt), tipo: neg === "-" ? "cargo" : "abono" });
      }
    }
  }
  return { desde, hasta, movs };
}

// ---- 2) Libro banco (Excel del sistema contable) -----------------------------
export async function parseLibroBanco(buf: Buffer): Promise<FilaLibro[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const filas: FilaLibro[] = [];
  for (const ws of wb.worksheets) {
    let idx: Record<string, number> | null = null;
    let cuentaActual = "";
    ws.eachRow({ includeEmpty: false }, (row) => {
      const vals: any[] = [];
      row.eachCell({ includeEmpty: true }, (c, cn) => (vals[cn] = c.value));
      const textos = vals.map((v) => String(v ?? "").trim());
      if (!idx && textos.some((t) => /^Glosa$/i.test(t)) && textos.some((t) => /^Ingreso$/i.test(t))) {
        idx = {};
        textos.forEach((t, cn) => {
          if (/^Fecha$/i.test(t)) idx!.fecha = cn;
          if (/^Compr/i.test(t)) idx!.compr = cn;
          if (/^Nro\.?\s*Doc/i.test(t)) idx!.doc = cn;
          if (/^Glosa$/i.test(t)) idx!.glosa = cn;
          if (/^Ingreso$/i.test(t)) idx!.ingreso = cn;
          if (/^Egreso$/i.test(t)) idx!.egreso = cn;
          if (/^Cuenta$/i.test(t)) idx!.cuenta = cn;
        });
        return;
      }
      if (!idx) return;
      const sec = textos.find((t) => /^\d{6,}\s+\S/.test(t));
      if (sec && !vals[idx.glosa]) { cuentaActual = sec; return; }
      const fv = vals[idx.fecha];
      let fecha = "";
      if (fv instanceof Date) fecha = fechaLocal(fv);
      else if (fv) { const d = new Date(String(fv)); if (!isNaN(d.getTime())) fecha = fechaLocal(d); }
      if (!fecha) return;
      const ingreso = num(vals[idx.ingreso]);
      const egreso = num(vals[idx.egreso]);
      if (!ingreso && !egreso) return;
      const doc = String(vals[idx.doc] ?? "").trim();
      const d6 = (doc.match(/(\d{6})\s*$/) || [])[1] || "";
      filas.push({
        fecha,
        compr: String(vals[idx.compr] ?? "").trim(),
        doc,
        numOp: d6 && d6 !== "000000" ? d6 : "",
        glosa: String(vals[idx.glosa] ?? "").trim(),
        ingreso,
        egreso,
        cuenta: String(vals[idx.cuenta] ?? "").trim() || cuentaActual,
      });
    });
    if (filas.length) break; // primera hoja con datos
  }
  return filas;
}

// ---- 3) Caja virtual (Excel "reporte de ingreso comprobante") ---------------
export async function parseCajaVirtual(buf: Buffer): Promise<FilaCaja[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const filas: FilaCaja[] = [];
  for (const ws of wb.worksheets) {
    let header = -1;
    const idx: Record<string, number> = {};
    ws.eachRow({ includeEmpty: false }, (row, rn) => {
      if (header > 0) return;
      const vals: string[] = [];
      row.eachCell({ includeEmpty: true }, (c, cn) => (vals[cn] = String(c.value ?? "").trim()));
      if (vals.some((v) => /Fecha Pago/i.test(v || "")) && vals.some((v) => /Referencia/i.test(v || ""))) {
        header = rn;
        vals.forEach((v, cn) => {
          if (/^Fecha Pago/i.test(v)) idx.fecha = cn;
          if (/Referencia/i.test(v)) idx.ref = cn;
          if (/^Tipo Pago/i.test(v)) idx.tipoPago = cn;
          if (/^Contratante/i.test(v)) idx.contratante = cn;
          if (/^Comprobante$/i.test(v)) idx.comprobante = cn;
          if (/^Total$/i.test(v)) idx.total = cn;
        });
      }
    });
    if (header < 0) continue;
    ws.eachRow({ includeEmpty: false }, (row, rn) => {
      if (rn <= header) return;
      const cel = (i?: number) => (i ? row.getCell(i).value : null);
      const total = num(cel(idx.total));
      if (!total) return;
      let f: any = cel(idx.fecha);
      let fecha = "";
      if (f instanceof Date) fecha = fechaLocal(f);
      else { const p = String(f ?? "").match(/(\d{2})\/(\d{2})\/(\d{4})/); fecha = p ? `${p[3]}-${p[2]}-${p[1]}` : ""; }
      const refRaw = String(cel(idx.ref) ?? "").replace(/\D/g, "");
      filas.push({
        fecha,
        tipoPago: String(cel(idx.tipoPago) ?? "").trim(),
        ref: refRaw ? refRaw.slice(-6).padStart(6, "0") : "",
        contratante: String(cel(idx.contratante) ?? "").trim(),
        comprobante: String(cel(idx.comprobante) ?? "").trim(),
        total,
      });
    });
    if (filas.length) break;
  }
  return filas;
}

// ---- 4) Conciliación ---------------------------------------------------------
const diasEntre = (a: string, b: string) =>
  Math.abs((new Date(a + "T00:00:00").getTime() - new Date(b + "T00:00:00").getTime()) / 86400000);

export function conciliar(
  periodo: { desde: string; hasta: string },
  movs: MovBanco[],
  libro: FilaLibro[],
  caja: FilaCaja[]
): ResultadoConciliacion {
  // Índices.
  const libroPorOp = new Map<string, FilaLibro[]>();
  for (const l of libro) if (l.numOp) {
    if (!libroPorOp.has(l.numOp)) libroPorOp.set(l.numOp, []);
    libroPorOp.get(l.numOp)!.push(l);
  }
  const cajaPorRef = new Map<string, FilaCaja[]>();
  for (const c of caja) if (c.ref) {
    if (!cajaPorRef.has(c.ref)) cajaPorRef.set(c.ref, []);
    cajaPorRef.get(c.ref)!.push(c);
  }

  const usadosLibro = new Set<FilaLibro>();
  const usadosCaja = new Set<FilaCaja>();
  const conciliados: ResultadoConciliacion["conciliados"] = [];
  const bancoSinLibro: ResultadoConciliacion["bancoSinLibro"] = [];
  let conciliadosOp = 0, conciliadosFechaMonto = 0;

  const montoLibro = (l: FilaLibro, tipo: MovBanco["tipo"]) => (tipo === "abono" ? l.ingreso : l.egreso);
  const cajaDe = (m: MovBanco): FilaCaja | undefined => {
    if (m.tipo !== "abono") return undefined;
    const cands = (cajaPorRef.get(m.numOp) || []).filter((c) => !usadosCaja.has(c));
    const c = cands.find((x) => Math.abs(x.total - m.monto) < 0.01) || cands[0];
    if (c) usadosCaja.add(c);
    return c;
  };

  // Pase 1: por N° de operación (prefiere el candidato con el monto exacto).
  const pendientes: MovBanco[] = [];
  for (const m of movs) {
    const cands = (libroPorOp.get(m.numOp) || []).filter((l) => !usadosLibro.has(l));
    const l = cands.find((x) => Math.abs(montoLibro(x, m.tipo) - m.monto) < 0.01) || cands[0];
    if (l) {
      usadosLibro.add(l);
      conciliadosOp++;
      conciliados.push({ banco: m, libro: l, metodo: "N° operación", caja: cajaDe(m) });
    } else pendientes.push(m);
  }
  // Pase 2: fecha (±2 días) + monto exacto + mismo sentido.
  for (const m of pendientes) {
    const l = libro.find(
      (x) => !usadosLibro.has(x) && Math.abs(montoLibro(x, m.tipo) - m.monto) < 0.01 && diasEntre(x.fecha, m.fecha) <= 2
    );
    if (l) {
      usadosLibro.add(l);
      conciliadosFechaMonto++;
      conciliados.push({ banco: m, libro: l, metodo: "fecha + monto", caja: cajaDe(m) });
    } else {
      bancoSinLibro.push({ ...m, caja: cajaDe(m) });
    }
  }

  const libroSinBanco = libro.filter((l) => !usadosLibro.has(l));
  // Caja con referencia bancaria que nunca apareció en el extracto.
  const cajaSinBanco = caja.filter((c) => c.ref && !usadosCaja.has(c));

  const abonos = movs.filter((m) => m.tipo === "abono");
  const cargos = movs.filter((m) => m.tipo === "cargo");
  return {
    periodo,
    resumen: {
      movsBanco: movs.length,
      abonosBanco: abonos.length,
      cargosBanco: cargos.length,
      totalAbonos: abonos.reduce((a, x) => a + x.monto, 0),
      totalCargos: cargos.reduce((a, x) => a + x.monto, 0),
      filasLibro: libro.length,
      totalIngresos: libro.reduce((a, x) => a + x.ingreso, 0),
      totalEgresos: libro.reduce((a, x) => a + x.egreso, 0),
      filasCaja: caja.length,
      cajaConRef: caja.filter((c) => c.ref).length,
      conciliadosOp,
      conciliadosFechaMonto,
      bancoSinLibro: bancoSinLibro.length,
      libroSinBanco: libroSinBanco.length,
      cajaSinBanco: cajaSinBanco.length,
      pctConciliado: movs.length ? Math.round(((conciliadosOp + conciliadosFechaMonto) / movs.length) * 1000) / 10 : 0,
    },
    conciliados,
    bancoSinLibro,
    libroSinBanco,
    cajaSinBanco,
  };
}

// ---- 5) Excel de salida ------------------------------------------------------
export async function excelConciliacion(r: ResultadoConciliacion): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const header = (ws: ExcelJS.Worksheet, cols: { h: string; w: number }[]) => {
    ws.columns = cols.map((c) => ({ width: c.w }));
    const row = ws.addRow(cols.map((c) => c.h));
    row.font = { bold: true, color: { argb: "FFFFFFFF" } };
    row.eachCell((c) => {
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF173A66" } };
      c.alignment = { vertical: "middle" };
    });
    ws.views = [{ state: "frozen", ySplit: 1 }];
  };
  const moneda = (ws: ExcelJS.Worksheet, letras: string[]) => {
    for (const L of letras) ws.getColumn(L).numFmt = "#,##0.00";
  };

  // Resumen
  {
    const ws = wb.addWorksheet("Resumen");
    ws.columns = [{ width: 46 }, { width: 20 }];
    const t = ws.addRow(["CONCILIACIÓN BANCARIA", ""]);
    t.font = { bold: true, size: 14 };
    ws.addRow([`Periodo: ${r.periodo.desde || "—"} al ${r.periodo.hasta || "—"}`, ""]);
    ws.addRow([]);
    const filas: [string, number | string][] = [
      ["Movimientos del extracto bancario", r.resumen.movsBanco],
      ["  Abonos (depósitos)", r.resumen.abonosBanco],
      ["  Total abonos S/", r.resumen.totalAbonos],
      ["  Cargos (retiros)", r.resumen.cargosBanco],
      ["  Total cargos S/", r.resumen.totalCargos],
      ["Registros del libro banco", r.resumen.filasLibro],
      ["  Total ingresos S/", r.resumen.totalIngresos],
      ["  Total egresos S/", r.resumen.totalEgresos],
      ["Filas de caja virtual", r.resumen.filasCaja],
      ["  Con referencia bancaria", r.resumen.cajaConRef],
      ["", ""],
      ["CONCILIADOS por N° de operación", r.resumen.conciliadosOp],
      ["CONCILIADOS por fecha + monto", r.resumen.conciliadosFechaMonto],
      ["% del extracto conciliado", `${r.resumen.pctConciliado}%`],
      ["", ""],
      ["⚠ En el banco SIN registro contable", r.resumen.bancoSinLibro],
      ["⚠ En el libro SIN respaldo bancario", r.resumen.libroSinBanco],
      ["⚠ En caja (con referencia) SIN aparecer en el banco", r.resumen.cajaSinBanco],
    ];
    for (const [k, v] of filas) {
      const row = ws.addRow([k, v]);
      if (typeof v === "number" && /S\//.test(k)) row.getCell(2).numFmt = "#,##0.00";
      if (/^CONCILIADOS|^⚠|^%/.test(k)) row.font = { bold: true };
    }
  }

  // Conciliados
  {
    const ws = wb.addWorksheet("Conciliados");
    header(ws, [
      { h: "Fecha banco", w: 12 }, { h: "Descripción banco", w: 30 }, { h: "N° operación", w: 12 },
      { h: "Tipo", w: 8 }, { h: "Monto banco", w: 12 },
      { h: "Fecha libro", w: 12 }, { h: "Compr. cont.", w: 12 }, { h: "Glosa", w: 34 },
      { h: "Ingreso", w: 11 }, { h: "Egreso", w: 11 }, { h: "Método", w: 14 },
      { h: "Comprobante caja", w: 15 }, { h: "Contratante (caja)", w: 30 },
    ]);
    for (const c of r.conciliados) {
      ws.addRow([
        c.banco.fecha, c.banco.desc, c.banco.numOp, c.banco.tipo, c.banco.monto,
        c.libro.fecha, c.libro.compr, c.libro.glosa, c.libro.ingreso || "", c.libro.egreso || "",
        c.metodo, c.caja?.comprobante ?? "", c.caja?.contratante ?? "",
      ]);
    }
    moneda(ws, ["E", "I", "J"]);
  }

  // Banco sin libro
  {
    const ws = wb.addWorksheet("Banco sin contabilizar");
    header(ws, [
      { h: "Fecha", w: 12 }, { h: "Descripción", w: 34 }, { h: "N° operación", w: 12 },
      { h: "Tipo", w: 8 }, { h: "Monto", w: 12 },
      { h: "Comprobante caja", w: 15 }, { h: "Contratante (caja)", w: 30 },
    ]);
    for (const m of r.bancoSinLibro) {
      const row = ws.addRow([m.fecha, m.desc, m.numOp, m.tipo, m.monto, m.caja?.comprobante ?? "", m.caja?.contratante ?? ""]);
      row.getCell(5).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFDE8E8" } };
    }
    moneda(ws, ["E"]);
  }

  // Libro sin banco
  {
    const ws = wb.addWorksheet("Libro sin banco");
    header(ws, [
      { h: "Fecha", w: 12 }, { h: "Compr. cont.", w: 12 }, { h: "Nro. Doc.", w: 16 },
      { h: "Glosa", w: 40 }, { h: "Ingreso", w: 11 }, { h: "Egreso", w: 11 }, { h: "Cuenta", w: 14 },
    ]);
    for (const l of r.libroSinBanco) ws.addRow([l.fecha, l.compr, l.doc, l.glosa, l.ingreso || "", l.egreso || "", l.cuenta]);
    moneda(ws, ["E", "F"]);
  }

  // Caja sin banco
  {
    const ws = wb.addWorksheet("Caja sin banco");
    header(ws, [
      { h: "Fecha pago", w: 12 }, { h: "Tipo pago", w: 12 }, { h: "Referencia", w: 12 },
      { h: "Contratante", w: 34 }, { h: "Comprobante", w: 15 }, { h: "Total", w: 12 },
    ]);
    for (const c of r.cajaSinBanco) ws.addRow([c.fecha, c.tipoPago, c.ref, c.contratante, c.comprobante, c.total]);
    moneda(ws, ["F"]);
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}
