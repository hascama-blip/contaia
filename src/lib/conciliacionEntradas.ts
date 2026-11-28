// ============================================================
//  Conciliación bancaria — otras ENTRADAS además del Excel
// ============================================================
//  · Caja virtual desde los ZIP del utilitario "Caja virtual · reportes por sede" (ya analizados
//    por cajaOperaciones: comprobantes por operación + voucher del depósito del efectivo).
//  · Bancos en PDF (con capa de texto) y en Word (.docx).
// Todo termina en los mismos tipos del motor (Cobro, MovBanco, Hoja) de conciliacionCaja.ts.

import { descomprimirSeguro } from "./zip";
import { claveDoc, docVisible, parseBanco, tipoDeHoja, type Cobro, type DocCobro, type Hoja, type MovBanco } from "./conciliacionCaja";
import type { ResultadoOperaciones } from "./cajaOperaciones";

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const dmy = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split("-").reverse().join("/") : iso);
const S = (v: unknown, max = 200) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);
const N = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? r2(n) : 0; };
const ISO = (v: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? "")) ? String(v) : "");

// ---------------------------------------------------------------- caja virtual (ZIP por sede)
/** Limpia lo que manda el navegador (el análisis de los ZIP vuelve en el pedido de conciliación). */
export function sanearSedes(v: unknown): ResultadoOperaciones[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 40).filter((s) => s && Array.isArray(s.operaciones)).map((s) => ({
    sede: S(s.sede, 80), dias: N(s.dias), comprobantes: N(s.comprobantes), total: N(s.total),
    operaciones: (s.operaciones as any[]).slice(0, 20000).map((o) => ({
      sede: S(o?.sede, 80), fechaVenta: ISO(o?.fechaVenta), medio: S(o?.medio, 60), banco: S(o?.banco, 40), operacion: S(o?.operacion, 80),
      fechaOperacion: ISO(o?.fechaOperacion), horaOperacion: S(o?.horaOperacion, 10), montoVoucher: o?.montoVoucher == null ? null : N(o.montoVoucher),
      sumaComprobantes: N(o?.sumaComprobantes), diferencia: o?.diferencia == null ? null : N(o.diferencia),
      comprobantes: (Array.isArray(o?.comprobantes) ? o.comprobantes : []).slice(0, 2000).map((c: any) => ({ tipoDoc: S(c?.tipoDoc, 6), comprobante: S(c?.comprobante, 30), importe: N(c?.importe), cliente: S(c?.cliente, 90), placa: S(c?.placa, 10) })),
      estado: S(o?.estado, 30) as ResultadoOperaciones["operaciones"][number]["estado"], obs: S(o?.obs, 600), archivo: S(o?.archivo, 200),
      ...(o?.ticket && typeof o.ticket === "object" ? { ticket: { operacion: S(o.ticket.operacion, 30), fecha: ISO(o.ticket.fecha), hora: S(o.ticket.hora, 8), monto: o.ticket.monto == null ? null : N(o.ticket.monto), destino: S(o.ticket.destino, 30), origen: S(o.ticket.origen, 30), archivo: S(o.ticket.archivo, 200), por: o.ticket.por === "monto" ? "monto" as const : "referencia" as const } } : {}),
    })),
    sinOperacion: (Array.isArray(s.sinOperacion) ? s.sinOperacion : []).slice(0, 5000).map((c: any) => ({ tipoDoc: S(c?.tipoDoc, 6), comprobante: S(c?.comprobante, 30), importe: N(c?.importe), fecha: ISO(c?.fecha), motivo: S(c?.motivo, 120) })),
    otros: [], avisos: (Array.isArray(s.avisos) ? s.avisos : []).slice(0, 200).map((a: unknown) => S(a, 300)),
    tickets: { leidos: N(s.tickets?.leidos), vinculados: N(s.tickets?.vinculados), sueltos: (Array.isArray(s.tickets?.sueltos) ? s.tickets.sueltos : []).slice(0, 500).map((t: any) => ({ fecha: ISO(t?.fecha), archivo: S(t?.archivo, 200), operacion: S(t?.operacion, 30), monto: t?.monto == null ? null : N(t.monto), destino: S(t?.destino, 30) })) },
  }));
}

const tdDe = (tipoDoc: string) => (/^F/.test(tipoDoc) ? "01" : /^N/.test(tipoDoc) ? "07" : "03");
const PREF: Record<string, string> = { "01": "FT", "03": "BV", "07": "NC" };

/** Los cobros de la caja virtual a partir de la relación N° de operación ↔ comprobantes de cada sede.
 *  · Efectivo: UN cobro por día y sede = todos los comprobantes en efectivo; lleva el voucher del
 *    depósito (N° de operación, fecha y monto leídos del PDF del Drive).
 *  · Yape, depósito del cliente, Visa…: un cobro por N° de operación del reporte de caja.
 *  · Devolución por nota de crédito: aplica la NC (no pasa por el banco). */
export function cobrosDeCajaZip(sedes: ResultadoOperaciones[]): { cobros: Cobro[]; avisos: string[]; notasSinCobro: Record<string, string> } {
  const cobros: Cobro[] = [], avisos: string[] = [], notasSinCobro: Record<string, string> = {};
  const ids = new Set<string>();
  const idUnico = (base: string) => { let id = base, n = 2; while (ids.has(id)) id = `${base}/${n++}`; ids.add(id); return id; };
  const docsDe = (cs: { tipoDoc: string; comprobante: string; importe: number }[]): DocCobro[] => cs.map((c) => { const clave = claveDoc(c.comprobante); return { clave, doc: docVisible(clave), td: tdDe(c.tipoDoc), importe: r2(c.importe) }; });
  for (const s of sedes) {
    const corta = s.sede.replace(/\s+/g, " ").trim();
    let conVoucher = 0, sinVoucher = 0, conDif = 0, otros = 0, conTicket = 0;
    const nombresDe = (cs: { cliente?: string; placa?: string }[]) => ({ nombres: Array.from(new Set(cs.map((c) => c.cliente ?? "").filter(Boolean))), placas: Array.from(new Set(cs.map((c) => c.placa ?? "").filter((x) => x.length >= 5))) });
    for (const o of s.operaciones) {
      if (!o.fechaVenta || !o.comprobantes.length) continue;
      const docs = docsDe(o.comprobantes);
      const f = o.fechaVenta.slice(5).split("-").reverse().join("/");
      if (/^EFECTIVO/.test(o.medio)) {
        const hay = o.estado !== "Sin voucher" && o.montoVoucher != null;
        if (hay) conVoucher++; else sinVoucher++;
        if (o.estado === "Diferencia") conDif++;
        cobros.push({
          id: idUnico(`${corta} ${f} EFECTIVO`), fecha: o.fechaVenta, tipo: "efectivo", medio: "EFECTIVO", sede: corta,
          op: hay ? o.operacion.split(" + ").filter((x) => x && !/^CLAVE|sin leer/i.test(x)).join(" + ") : "",
          importe: r2(o.sumaComprobantes), glosa: `DEP. X VTAS ${dmy(o.fechaVenta)} EFECTIVO ${corta}`, docs, origen: "reporte",
          voucher: hay ? { operacion: o.operacion, fecha: o.fechaOperacion, monto: o.montoVoucher, banco: o.banco, diferencia: r2(o.diferencia ?? 0), obs: o.obs } : undefined,
          nota: hay ? "" : (o.obs || "Sin voucher de depósito en el Drive de ese día."),
        });
      } else {
        const medio = [o.medio, o.banco].filter(Boolean).join(" ");
        cobros.push({
          id: idUnico(`${corta} ${f} ${o.medio} ${o.operacion}`), fecha: o.fechaVenta, tipo: "transferencia", medio, sede: corta, op: o.operacion,
          importe: r2(o.sumaComprobantes), glosa: `CANCELA ${docs.map((d) => `${PREF[d.td] ?? ""} ${d.doc}`.trim()).slice(0, 4).join(", ")}${docs.length > 4 ? "…" : ""} - ${medio} ${corta}`,
          docs, origen: "reporte", nota: o.ticket ? "" : o.obs, ...nombresDe(o.comprobantes),
          ...(o.ticket ? { ticket: { operacion: o.ticket.operacion, fecha: o.ticket.fecha, hora: o.ticket.hora, monto: o.ticket.monto, destino: o.ticket.destino, origen: o.ticket.origen, por: o.ticket.por, obs: o.obs } } : {}),
        });
        otros++; if (o.ticket) conTicket++;
      }
    }
    // Lo que el reporte trae sin N° de operación.
    const conCobro = new Set(cobros.flatMap((c) => c.docs.map((d) => d.clave)));
    for (const x of s.sinOperacion) {
      const clave = claveDoc(x.comprobante);
      if (/NOTA\s+CREDITO|^DEV\b/i.test(x.motivo) || /^N/.test(x.tipoDoc)) {
        cobros.push({ id: idUnico(`${corta} NC ${x.comprobante}`), fecha: x.fecha, tipo: "nc", medio: "Nota de crédito", sede: corta, op: "", importe: Math.abs(r2(x.importe)), glosa: `DEVOLUCIÓN POR NOTA DE CRÉDITO ${x.comprobante} ${corta}`, docs: [], ncClave: clave, origen: "reporte" });
      } else if (Math.abs(x.importe) >= 0.01) {
        // Yape, depósito o tarjeta sin N° de operación en el reporte: se busca en el banco por fecha y monto.
        const medio = x.motivo.replace(/ sin N° de operación$/i, "") || "SIN MEDIO DE PAGO";
        cobros.push({ id: idUnico(`${corta} ${x.fecha.slice(5).split("-").reverse().join("/")} ${medio} ${x.comprobante}`), fecha: x.fecha, tipo: "transferencia", medio, sede: corta, op: "", importe: r2(x.importe), glosa: `CANCELA ${x.comprobante} - ${medio} ${corta}`, docs: docsDe([x]), origen: "reporte", nota: "La caja virtual no trae el N° de operación de este cobro." });
        conCobro.add(clave);
      } else if (!conCobro.has(clave)) notasSinCobro[clave] = `En la caja virtual (${corta}, ${dmy(x.fecha)}) figura con cobro 0.00 y sin medio de pago`;
    }
    avisos.push(`Caja virtual ${corta}: ${s.dias} día(s), ${s.comprobantes} comprobantes por S/ ${s.total.toLocaleString("es-PE", { minimumFractionDigits: 2 })}. Efectivo: ${conVoucher} día(s) con voucher de depósito leído${conDif ? ` (${conDif} con diferencia entre el depósito y el efectivo del día)` : ""}${sinVoucher ? ` y ${sinVoucher} día(s) SIN voucher en el Drive (se buscan en el banco por monto)` : ""}.${otros ? ` Yape, depósitos y tarjetas: ${otros} cobro(s), ${conTicket} con su ticket leído del Drive (el N° de operación del ticket termina en la referencia de la caja)${s.tickets?.sueltos.length ? `; ${s.tickets.sueltos.length} ticket(s) del Drive no calzan con ningún cobro` : ""}.` : ""}`);
    for (const a of s.avisos.slice(0, 5)) avisos.push(`Caja virtual ${corta}: ${a}`);
  }
  return { cobros, avisos, notasSinCobro };
}

// ---------------------------------------------------------------- bancos: lectura genérica por líneas
const RE_FECHA = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?(?=\s|$)/;
const RE_MONTO = /(?<![\d.,])-?\(?\d{1,3}(?:,\d{3})*\.\d{2}\)?-?(?![\d,])/g;
const monto = (t: string) => { const n = Number(t.replace(/[(),\s-]/g, "")); return (Number.isFinite(n) ? n : 0) * (/-|\(/.test(t) ? -1 : 1); };
/** Fecha de un extracto: con año → ISO; sin año ("02-10") → "0000-MM-DD" (el año se fija con el periodo). */
function fechaLinea(m: RegExpExecArray, anio = ""): string {
  const d = Number(m[1]), mes = Number(m[2]);
  if (d < 1 || d > 31 || mes < 1 || mes > 12) return "";
  const a = m[3] ? (m[3].length === 2 ? `20${m[3]}` : m[3]) : anio || "0000";
  return `${a}-${String(mes).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export interface LecturaBanco { movs: Omit<MovBanco, "id">[]; aviso: string }

/** Movimientos a partir de las LÍNEAS de un extracto (PDF o Word sin tabla): cada movimiento empieza
 *  con su fecha y termina con el importe y, si lo trae, el saldo. Con saldo, el signo (cargo/abono) y
 *  la lectura se COMPRUEBAN con la cadena de saldos (saldo anterior ± importe = saldo). */
export function movsDeLineas(lineas: string[], nombre: string): LecturaBanco {
  interface F { fecha: string; desc: string; montos: number[]; crudo: string[] }
  const filas: F[] = [];
  for (const l0 of lineas) {
    const l = l0.replace(/\s+/g, " ").trim();
    const m = RE_FECHA.exec(l);
    if (!m) continue;
    const fecha = fechaLinea(m); if (!fecha) continue;
    let resto = l.slice(m[0].length).trim();
    const m2 = RE_FECHA.exec(resto); if (m2 && fechaLinea(m2)) resto = resto.slice(m2[0].length).trim(); // fecha valor
    const crudo = resto.match(RE_MONTO) ?? [];
    if (!crudo.length) continue;
    const desc = resto.slice(0, resto.indexOf(crudo[0] as string)).trim();
    if (!/[A-Za-zÑñ]/.test(desc)) continue; // líneas de resumen (rango de fechas + saldos), no movimientos
    filas.push({ fecha, desc, montos: crudo.map(monto), crudo });
  }
  if (!filas.length) return { movs: [], aviso: "" };
  const opDe = (d: string) => (d.match(/\b\d{5,12}\b/g) ?? []).pop() ?? "";
  // ¿La última cifra de cada línea es el saldo? Se comprueba con la cadena.
  const conSaldo = filas.filter((f) => f.montos.length >= 2);
  let cadena = 0;
  for (let i = 1; i < filas.length; i++) {
    const a = filas[i - 1], b = filas[i]; if (a.montos.length < 2 || b.montos.length < 2) continue;
    const sA = a.montos[a.montos.length - 1], sB = b.montos[b.montos.length - 1], imp = Math.abs(b.montos[b.montos.length - 2]);
    if (Math.abs(Math.abs(sB - sA) - imp) < 0.011) cadena++;
  }
  const movs: Omit<MovBanco, "id">[] = [];
  if (conSaldo.length >= 3 && cadena >= Math.max(2, Math.floor((conSaldo.length - 1) * 0.8))) {
    let prev: number | null = null;
    for (const f of filas) {
      if (f.montos.length < 2) { prev = null; continue; }
      const saldo = f.montos[f.montos.length - 1], imp = Math.abs(f.montos[f.montos.length - 2]);
      // Signo: por el saldo; en la primera fila, por el signo impreso.
      const signo = prev != null && Math.abs(Math.abs(saldo - prev) - imp) < 0.011 ? Math.sign(saldo - prev) : (f.montos[f.montos.length - 2] < 0 ? -1 : 1);
      prev = saldo;
      if (!imp) continue;
      movs.push({ banco: nombre, fecha: f.fecha, desc: f.desc, op: opDe(f.desc), abono: signo >= 0 ? r2(imp) : 0, cargo: signo < 0 ? r2(imp) : 0 });
    }
    return { movs, aviso: `Extracto "${nombre}": ${movs.length} movimientos leídos y comprobados con el saldo (${cadena} de ${conSaldo.length - 1} filas cuadran con el saldo anterior).` };
  }
  // Sin saldo comprobable: un importe con signo por línea (negativo = cargo).
  for (const f of filas) {
    const v = f.montos[0]; if (!v) continue;
    movs.push({ banco: nombre, fecha: f.fecha, desc: f.desc, op: opDe(f.desc), abono: v > 0 ? r2(v) : 0, cargo: v < 0 ? r2(-v) : 0 });
  }
  return { movs, aviso: `Extracto "${nombre}": ${movs.length} movimientos leídos SIN poder comprobarlos con el saldo (formato no calibrado): revisa que los abonos y cargos sean los del banco; si no, sube el extracto en Excel.` };
}

// ---------------------------------------------------------------- bancos en PDF
/** Líneas de un PDF con capa de texto (se arman por la posición de cada palabra). */
export async function lineasDePdf(buf: Buffer): Promise<string[]> {
  const { getDocumentProxy } = await import("./pdfTexto");
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const out: string[] = [];
  for (let p = 1; p <= Math.min(pdf.numPages, 200); p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const items = (tc.items as any[]).filter((i) => typeof i.str === "string" && i.str.trim()).map((i) => ({ s: i.str as string, x: i.transform[4] as number, y: i.transform[5] as number, w: (i.width as number) || 0 }));
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    let fila: typeof items = [];
    const cerrar = () => {
      if (!fila.length) return;
      fila.sort((a, b) => a.x - b.x);
      let t = "", fin = -1e9;
      for (const i of fila) { t += (t && i.x - fin > 1.5 ? " " : "") + i.s; fin = i.x + i.w; }
      out.push(t.replace(/\s+/g, " ").trim()); fila = [];
    };
    for (const i of items) { if (fila.length && Math.abs(fila[0].y - i.y) > 2.5) cerrar(); fila.push(i); }
    cerrar();
  }
  return out;
}

/** Extracto bancario en PDF → movimientos. 1.º el formato BCP (calibrado con un estado de cuenta
 *  real); si no es, la lectura genérica por líneas comprobada con el saldo. */
export async function movsDePdf(buf: Buffer, archivo: string): Promise<LecturaBanco> {
  const base = archivo.replace(/\.pdf$/i, "").trim();
  let lineas: string[];
  try { lineas = await lineasDePdf(buf); } catch { throw new Error(`No se pudo leer "${archivo}". Debe ser el PDF original del banco.`); }
  const texto = lineas.join(" ");
  if (texto.replace(/\s/g, "").length < 50) throw new Error(`"${archivo}" no tiene capa de texto (parece escaneado). Sube el PDF original que entrega el banco, o el extracto en Excel.`);
  // BCP: movimientos "dd-mm … medio de atención (VEN/CAJ/POS/TLC/INT/BPT/BPI) … importe". Se lee con el
  // mismo texto con que se calibró ese formato (el del utilitario "Estado de cuenta → Excel").
  if (/\b(VEN|CAJ|POS|TLC|INT|BPT|BPI)\b/.test(texto) && /\b\d{2}-\d{2}\s/.test(texto)) {
    const { parseEstadoBcp, textoDePdf } = await import("./bancoPdfWord");
    const est = parseEstadoBcp(await textoDePdf(buf).catch(() => texto));
    if (est.movimientos.length >= 2) {
      const per = /(\d{2})\/(\d{2})\/(\d{4}) al (\d{2})\/(\d{2})\/(\d{4})/.exec(est.periodo);
      const nombre = est.cuenta ? `BCP ${est.cuenta}` : base;
      const movs = est.movimientos.map((m) => {
        const [d, mes] = m.fecha.split("-");
        // Año: el del periodo del estado de cuenta (si cruza de año, el mes dice cuál).
        const anio = per ? (per[3] !== per[6] && Number(mes) >= Number(per[2]) ? per[3] : per[6]) : "0000";
        return { banco: nombre, fecha: `${anio}-${mes}-${d}`, desc: m.descripcion, op: m.numOp, abono: m.monto > 0 ? r2(m.monto) : 0, cargo: m.monto < 0 ? r2(-m.monto) : 0 };
      });
      return { movs, aviso: `Extracto "${archivo}" (estado de cuenta BCP${est.periodo ? `, ${est.periodo}` : ""}): ${movs.length} movimientos leídos.` };
    }
  }
  const cab = cabeceraExtracto(lineas);
  const r = movsDeLineas(lineas, cab.cuenta ? `${base} · ${cab.cuenta}`.slice(0, 60) : base);
  if (!r.movs.length) throw new Error(`No se detectaron movimientos en "${archivo}". Sube el extracto en Excel o Word, o envíanos el PDF para calibrar su formato.`);
  return { movs: conAnio(r.movs, cab), aviso: r.aviso };
}

// ---------------------------------------------------------------- bancos en Word (.docx)
const xmlTexto = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, "&");
/** Texto de un trozo de document.xml (un párrafo o una celda). */
function textoXml(x: string): string {
  const partes: string[] = [];
  for (const p of x.split(/<\/w:p>/)) {
    const t = Array.from(p.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br\/>/g)).map((m) => (m[1] != null ? xmlTexto(m[1]) : " ")).join("");
    if (t.trim()) partes.push(t.trim());
  }
  return partes.join(" ");
}

/** Un Word (.docx) como "hojas": cada tabla es una hoja (filas × celdas); el texto suelto va aparte. */
export function leerDocx(buf: Buffer, archivo: string): { hojas: Hoja[]; lineas: string[] } {
  let xml = "";
  try {
    const z = descomprimirSeguro(buf);
    const doc = z["word/document.xml"];
    if (!doc) throw new Error("sin documento");
    xml = Buffer.from(doc).toString("utf8");
  } catch { throw new Error(`No se pudo leer "${archivo}". Debe ser un Word .docx (si es .doc, ábrelo y guárdalo como .docx).`); }
  const hojas: Hoja[] = [];
  const fuera = xml.replace(/<w:tbl>[\s\S]*?<\/w:tbl>/g, (tbl) => {
    const rows: unknown[][] = [];
    for (const tr of tbl.split(/<w:tr[ >]/).slice(1)) {
      const celdas = tr.split(/<w:tc>/).slice(1).map((tc) => textoXml(tc));
      if (celdas.some((c) => c)) rows.push(celdas);
    }
    if (rows.length) hojas.push({ archivo, hoja: `Tabla ${hojas.length + 1}`, rows });
    return "</w:p>";
  });
  const lineas = fuera.split(/<\/w:p>/).map((p) => textoXml(p + "</w:p>")).filter(Boolean);
  return { hojas, lineas };
}

/** Tablas de BANCO de un Word: una tabla partida en varias (una por página, sin repetir el título)
 *  se une a la anterior si tiene las mismas columnas. */
export function tablasBancoDeDocx(buf: Buffer, archivo: string): { hojas: Hoja[]; lineas: string[] } {
  const { hojas, lineas } = leerDocx(buf, archivo);
  const out: Hoja[] = [];
  for (const h of hojas) {
    const t = tipoDeHoja(h);
    const ant = out[out.length - 1];
    if (t.tipo === "banco") out.push(h);
    else if (ant && h.rows[0]?.length === ant.rows[ant.rows.length - 1]?.length) ant.rows.push(...h.rows);
  }
  return { hojas: out, lineas };
}

/** Datos de cabecera de un extracto (texto suelto del documento): cuenta y año del periodo. */
export function cabeceraExtracto(lineas: string[]): { cuenta: string; anio: string; mesIni: number; mesFin: number; anioIni: string } {
  const t = lineas.slice(0, 80).join(" ");
  const cuenta = (/\b(\d{3}-\d{7,8}-\d-\d{2})\b/.exec(t)?.[1] ?? /\b(\d{4}-\d{4}-\d{10})\b/.exec(t)?.[1] ?? /cuenta[^\d]{0,25}([\d][\d -]{7,24}\d)/i.exec(t)?.[1] ?? "").trim();
  const per = /(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\s*(?:al?|-|hasta)\s*(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/i.exec(t);
  if (per) return { cuenta, anio: per[6], anioIni: per[3], mesIni: Number(per[2]), mesFin: Number(per[5]) };
  const a = /\b(20\d{2})\b/.exec(t)?.[1] ?? "";
  return { cuenta, anio: a, anioIni: a, mesIni: 0, mesFin: 0 };
}

/** Pone el año a las fechas "0000-MM-DD" con el periodo de la cabecera del propio extracto. */
export function conAnio<T extends { fecha: string }>(movs: T[], cab: { anio: string; anioIni: string; mesIni: number }): T[] {
  if (!cab.anio) return movs;
  return movs.map((m) => (m.fecha.startsWith("0000-") ? { ...m, fecha: `${cab.anioIni !== cab.anio && cab.mesIni && Number(m.fecha.slice(5, 7)) >= cab.mesIni ? cab.anioIni : cab.anio}${m.fecha.slice(4)}` } : m));
}

/** Extracto bancario en Word (.docx) → movimientos. Lee las tablas (p. ej. FECHA · DESCRIPCIÓN · NUM OP ·
 *  HORA · CARGO / ABONO · SALDO CONTABLE · CONCILIACIÓN, el formato del utilitario "Estado de cuenta →
 *  Word/Excel"); si el Word no trae tablas, lee el texto línea por línea como en el PDF. */
export function movsDeWord(buf: Buffer, archivo: string): LecturaBanco {
  const base = archivo.replace(/\.docx$/i, "").trim();
  const { hojas, lineas } = tablasBancoDeDocx(buf, archivo);
  const cab = cabeceraExtracto(lineas);
  if (hojas.length) {
    const movs: Omit<MovBanco, "id">[] = [];
    hojas.forEach((h, i) => {
      const nombre = hojas.length > 1 ? `${base} (${i + 1})` : base;
      movs.push(...parseBanco(h, tipoDeHoja(h).fila, nombre, 0).map(({ id: _id, ...m }) => m));
    });
    if (!movs.length) throw new Error(`"${archivo}": se encontró la tabla del extracto pero ningún movimiento con fecha e importe.`);
    return { movs: conAnio(movs, cab), aviso: `Extracto "${archivo}" (Word): ${movs.length} movimientos leídos de ${hojas.length === 1 ? "la tabla" : `${hojas.length} tablas`}.` };
  }
  const r = movsDeLineas(lineas, base);
  if (!r.movs.length) throw new Error(`No se detectaron movimientos en "${archivo}". El Word debe traer la tabla del extracto (fecha, descripción, cargo/abono).`);
  return { movs: conAnio(r.movs, cab), aviso: r.aviso };
}
