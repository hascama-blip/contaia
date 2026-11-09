// ============================================================
//  EMPRESAS DE SIMULACIÓN (solo supremo): datos ficticios para demos y videos
// ============================================================
// Cuatro empresas INVENTADAS con información en todos los módulos (ficha SUNAT,
// SIRE resumen + detalle + estado, buzón, declaraciones mensuales, DJ anual,
// deudas, ITF y diagnóstico). Los datos son deterministas (misma empresa y
// periodo → mismos montos) para que una demo se pueda repetir igual.
//
// Los RUC tienen el DÍGITO VERIFICADOR INVÁLIDO a propósito: no pueden coincidir
// con ningún contribuyente real. Los clientes llevan id "demo-…" y `demo: true`;
// las rutas que consultan SUNAT devuelven datos simulados para ellos (ver
// demoRutas.ts) y nunca contactan a SUNAT.

import type { Cliente, SireResumen, SireBloque, BuzonMensaje, DeclaracionMensual, DeclaracionAnual, Deuda, SunatInfo } from "./types";

export const DEMO_PREFIJO = "demo-";
export const esClienteDemo = (c: { id: string } | null | undefined) => Boolean(c && c.id.startsWith(DEMO_PREFIJO));

// ---- Azar determinista ---------------------------------------------------------
function rng(semilla: string) {
  let h = 1779033703 ^ semilla.length;
  for (let i = 0; i < semilla.length; i++) { h = Math.imul(h ^ semilla.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}
const r2 = (n: number) => Math.round(n * 100) / 100;

/** RUC con el dígito verificador INVÁLIDO (nunca es un RUC real). */
function rucFicticio(base10: string): string {
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const s = base10.split("").reduce((a, d, i) => a + Number(d) * pesos[i], 0);
  let dv = 11 - (s % 11); if (dv === 10) dv = 0; if (dv === 11) dv = 1;
  return base10 + String((dv + 5) % 10); // desplazado: dígito incorrecto
}

// ---- Perfiles ------------------------------------------------------------------
interface Perfil {
  clave: string;
  razonSocial: string;
  ruc: string;
  tipoRuc: "20" | "10";
  negocio?: "con" | "sin";
  riesgo: "bajo" | "alto" | "medio";
  ventasMes: number;      // base gravada promedio de ventas por mes
  ratioCompras: number;   // compras / ventas
  tipoContribuyente: string;
  regimen: string;
  direccion: string;
  representante?: { nombre: string; numeroDoc: string; cargo: string };
  email: string;
  telefono: string;
}

export const PERFILES: Perfil[] = [
  {
    clave: "lumen", razonSocial: "INVERSIONES LUMEN ANDINO S.A.C.", ruc: rucFicticio("2060981234"), tipoRuc: "20", riesgo: "bajo",
    ventasMes: 185000, ratioCompras: 0.62, tipoContribuyente: "SOCIEDAD ANONIMA CERRADA", regimen: "RÉGIMEN GENERAL",
    direccion: "AV. LOS CEDROS NRO. 1450 INT. 302 - SAN ISIDRO - LIMA - LIMA",
    representante: { nombre: "VALDEZ ORMEÑO, CLAUDIA PATRICIA", numeroDoc: "40000018", cargo: "GERENTE GENERAL" },
    email: "contabilidad@lumenandino.demo", telefono: "01 700 1200",
  },
  {
    clave: "vallenorte", razonSocial: "CONSTRUCTORA VALLE NORTE DEL PACIFICO S.A.C.", ruc: rucFicticio("2060755512"), tipoRuc: "20", riesgo: "alto",
    ventasMes: 420000, ratioCompras: 0.81, tipoContribuyente: "SOCIEDAD ANONIMA CERRADA", regimen: "RÉGIMEN GENERAL",
    direccion: "CAL. LAS GARDENIAS NRO. 220 URB. EL PALOMAR - TRUJILLO - LA LIBERTAD",
    representante: { nombre: "SALAZAR QUIROZ, HERNAN ALONSO", numeroDoc: "10000023", cargo: "GERENTE GENERAL" },
    email: "gerencia@vallenorte.demo", telefono: "044 61 3300",
  },
  {
    clave: "quispe", razonSocial: "HUAMANI CCORI ROSALINDA YESENIA", ruc: rucFicticio("1047731590"), tipoRuc: "10", negocio: "con", riesgo: "medio",
    ventasMes: 28500, ratioCompras: 0.55, tipoContribuyente: "PERSONA NATURAL CON NEGOCIO", regimen: "RÉGIMEN MYPE TRIBUTARIO",
    direccion: "JR. AYACUCHO NRO. 615 - HUANCAYO - JUNIN",
    email: "rosalinda.huamani@correo.demo", telefono: "964 120 455",
  },
  {
    clave: "torres", razonSocial: "VILLACORTA PAREDES JULIO CESAR", ruc: rucFicticio("1072204418"), tipoRuc: "10", negocio: "sin", riesgo: "bajo",
    ventasMes: 0, ratioCompras: 0, tipoContribuyente: "PERSONA NATURAL SIN NEGOCIO", regimen: "RENTAS DE CUARTA Y QUINTA CATEGORÍA",
    direccion: "PJ. LOS ALAMOS NRO. 48 - CAYMA - AREQUIPA - AREQUIPA",
    email: "julio.villacorta@correo.demo", telefono: "959 300 812",
  },
];

// ---- Periodos --------------------------------------------------------------------
/** Periodos YYYYMM del año en curso hasta el mes anterior a `hoy` (YYYY-MM-DD). */
export function periodosDemo(hoy: string): string[] {
  const y = Number(hoy.slice(0, 4)), m = Number(hoy.slice(5, 7));
  const out: string[] = [];
  const hasta = m - 1 || 12, anio = m - 1 ? y : y - 1;
  for (let i = 1; i <= hasta; i++) out.push(`${anio}${String(i).padStart(2, "0")}`);
  return out;
}

// ---- SIRE: detalle (comprobantes) y resumen -------------------------------------
const CLIENTES_FICT = [
  ["20614402917", "DISTRIBUIDORA SAN GABRIEL DEMO S.A.C."], ["20611873045", "AGROINDUSTRIAS PAMPA VERDE DEMO S.A."],
  ["20609452218", "SERVICIOS INTEGRALES KORI DEMO E.I.R.L."], ["20612288730", "COMERCIAL TRES RIOS DEMO S.A.C."],
  ["10457781203", "MENDOZA ARCE LUIS ALBERTO"], ["20615509981", "LOGISTICA PUERTO ALTO DEMO S.A.C."],
];
const PROVEEDORES_FICT = [
  ["20601120045", "FERRETERIA EL CONSTRUCTOR DEMO S.A.C."], ["20603399127", "TRANSPORTES CHASKI DEMO S.R.L."],
  ["20610044581", "SUMINISTROS OFICINA NORTE DEMO S.A.C."], ["20605512006", "ENERGIA Y SERVICIOS DEMO S.A."],
  ["20608876610", "TECNOLOGIA ANDINA DEMO S.A.C."], ["10412233456", "ROJAS LEON MARIA ELENA"],
];

export const H_RVIE = ["RUC", "Apellidos y Nombres o Razón Social", "Periodo", "CAR SUNAT", "Fecha de emisión", "Fecha Vcto/Pago", "Tipo CP/Doc.", "Serie del CDP", "Nro CP o Doc. Nro Inicial (Rango)", "Nro Final (Rango)", "Tipo Doc Identidad", "Nro Doc Identidad", "Apellidos Nombres/ Razón Social", "Valor Facturado Exportación", "BI Gravada", "Dscto BI", "IGV / IPM", "Dscto IGV / IPM", "Mto Exonerado", "Mto Inafecto", "ISC", "BI Grav IVAP", "IVAP", "ICBPER", "Otros Tributos", "Total CP", "Moneda", "Tipo Cambio"];
export const H_RCE = ["RUC", "Apellidos y Nombres o Razón social", "Periodo", "CAR SUNAT", "Fecha de emisión", "Fecha Vcto/Pago", "Tipo CP/Doc.", "Serie del CDP", "Año", "Nro CP o Doc. Nro Inicial (Rango)", "Nro Final (Rango)", "Tipo Doc Identidad", "Nro Doc Identidad", "Apellidos Nombres/ Razón Social", "BI Gravado DG", "IGV / IPM DG", "BI Gravado DGNG", "IGV / IPM DGNG", "BI Gravado DNG", "IGV / IPM DNG", "Valor Adq. NG", "ISC", "ICBPER", "Otros Trib/ Cargos", "Total CP", "Moneda", "Tipo de Cambio"];

interface Comp { tipo: string; serie: string; numero: number; dia: number; doc: string; nombre: string; base: number; igv: number; total: number }

/** Comprobantes del periodo (ventas o compras) de una empresa. */
function comprobantes(p: Perfil, periodo: string, tipo: "ventas" | "compras"): Comp[] {
  if (p.negocio === "sin" || p.ventasMes <= 0) return [];
  const rnd = rng(`${p.ruc}|${periodo}|${tipo}`);
  const objetivo = (tipo === "ventas" ? p.ventasMes : p.ventasMes * p.ratioCompras) * (0.82 + rnd() * 0.36);
  const n = Math.max(6, Math.round((p.tipoRuc === "20" ? 22 : 12) * (0.8 + rnd() * 0.5)));
  const pesos = Array.from({ length: n }, () => 0.3 + rnd());
  const suma = pesos.reduce((a, b) => a + b, 0);
  const mes = Number(periodo.slice(4));
  const baseNum = (tipo === "ventas" ? 1200 : 300) + mes * (tipo === "ventas" ? 37 : 11);
  const out: Comp[] = [];
  for (let i = 0; i < n; i++) {
    const base = r2((objetivo * pesos[i]) / suma);
    const igv = r2(base * 0.18);
    const esNC = tipo === "ventas" && i === n - 1 && rnd() < 0.5;
    const contra = (tipo === "ventas" ? CLIENTES_FICT : PROVEEDORES_FICT)[Math.floor(rnd() * 6)];
    const boleta = tipo === "ventas" && p.tipoRuc === "10" && rnd() < 0.6;
    out.push({
      tipo: esNC ? "07" : boleta ? "03" : "01",
      serie: esNC ? "FC01" : boleta ? "B001" : tipo === "ventas" ? "F001" : ["F002", "E001", "FA01", "F005"][Math.floor(rnd() * 4)],
      numero: esNC ? 40 + mes : baseNum + i * (tipo === "ventas" ? 1 : 7),
      dia: Math.min(28, 1 + Math.floor((i / n) * 27 + rnd() * 2)),
      doc: boleta ? String(40000000 + Math.floor(rnd() * 9999999)) : contra[0],
      nombre: boleta ? "CLIENTE VARIOS" : contra[1],
      base: esNC ? -r2(base * 0.15) : base,
      igv: esNC ? -r2(igv * 0.15) : igv,
      total: esNC ? -r2((base + igv) * 0.15) : r2(base + igv),
    });
  }
  return out;
}

function bloque(cs: Comp[]): SireBloque {
  return {
    comprobantes: cs.length,
    baseImponible: r2(cs.reduce((a, c) => a + c.base, 0)),
    igv: r2(cs.reduce((a, c) => a + c.igv, 0)),
    inafectoExonerado: 0,
    importeTotal: r2(cs.reduce((a, c) => a + c.total, 0)),
  };
}

/** ¿El periodo está presentado? (la empresa de riesgo alto tiene omisiones). */
function presentado(p: Perfil, periodo: string, periodos: string[], tipo: "ventas" | "compras"): boolean {
  if (p.riesgo !== "alto") return true;
  const i = periodos.indexOf(periodo), n = periodos.length;
  if (i === n - 1) return false;                         // el último (por declarar) aún no
  if (i === n - 3) return tipo === "compras";            // omitió ventas hace 3 meses
  if (i === n - 6) return false;                         // omitió ambos hace 6 meses
  return true;
}

export function sireResumenDemo(p: Perfil, periodo: string, periodos: string[]): SireResumen {
  const noOblig = p.negocio === "sin";
  return {
    periodo,
    ventas: bloque(comprobantes(p, periodo, "ventas")),
    compras: bloque(comprobantes(p, periodo, "compras")),
    presentadoVentas: noOblig ? false : presentado(p, periodo, periodos, "ventas"),
    presentadoCompras: noOblig ? false : presentado(p, periodo, periodos, "compras"),
    ...(noOblig ? { noObligado: true } : {}),
    fuente: "simulado",
    consultadoAt: new Date().toISOString(),
  };
}

/** Detalle SIRE (columnas + filas, formato del TXT de SUNAT) de un periodo. */
export function sireDetalleDemo(p: Perfil, periodo: string, tipo: "ventas" | "compras") {
  const cs = comprobantes(p, periodo, tipo);
  const fecha = (d: number) => `${String(d).padStart(2, "0")}/${periodo.slice(4)}/${periodo.slice(0, 4)}`;
  const f = (n: number) => n.toFixed(2);
  const filas = cs.map((c) => tipo === "ventas"
    ? [p.ruc, p.razonSocial, periodo, "", fecha(c.dia), "", c.tipo, c.serie, String(c.numero).padStart(8, "0"), "", c.doc.length === 11 ? "6" : "1", c.doc, c.nombre, "0.00",
       c.tipo === "07" ? "0.00" : f(c.base), c.tipo === "07" ? f(c.base) : "0.00", c.tipo === "07" ? "0.00" : f(c.igv), c.tipo === "07" ? f(c.igv) : "0.00",
       "0.00", "0.00", "0.00", "0.00", "0.00", "0.00", "0.00", f(c.total), "PEN", ""]
    : [p.ruc, p.razonSocial, periodo, "", fecha(c.dia), "", c.tipo, c.serie, periodo.slice(0, 4), String(c.numero).padStart(8, "0"), "", "6", c.doc, c.nombre,
       f(c.base), f(c.igv), "0.00", "0.00", "0.00", "0.00", "0.00", "0.00", "0.00", "0.00", f(c.total), "PEN", ""]);
  return { columnas: tipo === "ventas" ? H_RVIE : H_RCE, filas, comprobantes: filas.length };
}

// ---- Buzón -----------------------------------------------------------------------
function buzonDemo(p: Perfil, hoy: string): BuzonMensaje[] {
  const y = hoy.slice(0, 4), m = hoy.slice(5, 7);
  const dia = (d: number) => `${String(Math.max(1, Math.min(Number(hoy.slice(8, 10)), d))).padStart(2, "0")}/${m}/${y}`;
  const base: [string, BuzonMensaje["nivel"], number][] = [
    ["Constancia de Presentación - Formulario Virtual 621 IGV-Renta Mensual", "otro", 3],
    ["Comunicación: cronograma de obligaciones mensuales del ejercicio", "otro", 5],
    ["Constancia de Pago - Boleta de Pago Virtual 1662", "otro", 6],
  ];
  if (p.riesgo === "alto") base.push(
    ["Carta de Presentación - Inicio de Procedimiento de Fiscalización Parcial IGV", "peligroso", 4],
    ["Requerimiento N° 0122260045871 - Fiscalización", "peligroso", 7],
    ["Orden de Pago N° 023-001-0458712 - IGV", "urgente", 2],
    ["Resolución de Ejecución Coactiva N° 023-006-0311904", "urgente", 8],
  );
  if (p.riesgo === "medio") base.push(["Esquela - Inconsistencia en la declaración del IGV", "urgente", 4]);
  return base.map(([asunto, nivel, d], i) => ({
    id: `demo-${p.clave}-${i}`,
    fecha: dia(d),
    asunto,
    tipo: nivel === "peligroso" ? "Fiscalización" : nivel === "urgente" ? "Cobranza" : "Informativo",
    nivel,
    urgente: nivel !== "otro",
    leido: nivel === "otro",
    origen: "notificaciones",
    adjuntos: nivel === "otro" ? 0 : 1,
  }));
}

// ---- Declaraciones mensuales, DJ anual, deudas ------------------------------------
function declaracionesDemo(p: Perfil, periodos: string[], sire: SireResumen[]): DeclaracionMensual[] {
  if (p.negocio === "sin") return [];
  const ult = periodos.slice(-6, -1); // las últimas declaradas (el último periodo aún no vence)
  return ult.map((per, i) => {
    const s = sire.find((x) => x.periodo === per)!;
    const noPresento = p.riesgo === "alto" && i === 2;
    // La de riesgo declara menos ventas que lo registrado en el SIRE en un mes.
    const factor = p.riesgo === "alto" && i === 1 ? 0.91 : p.riesgo === "medio" && i === 3 ? 0.97 : 1;
    const vb = r2(s.ventas.baseImponible * factor), vi = r2(s.ventas.igv * factor);
    const cb = r2(s.compras.baseImponible), ci = r2(s.compras.igv);
    return {
      id: `demo-dj-${p.clave}-${per}`,
      periodo: per, ruc: p.ruc, formulario: "621",
      ventasBase: noPresento ? 0 : vb, ventasIgv: noPresento ? 0 : vi,
      ventasDetalle: [{ codigo: "100", etiqueta: "Ventas netas gravadas", base: vb, igv: vi }],
      comprasBase: noPresento ? 0 : cb, comprasIgv: noPresento ? 0 : ci,
      comprasDetalle: [{ codigo: "107", etiqueta: "Gravadas → ventas gravadas (nacional)", base: cb, igv: ci }],
      casillas: [{ codigo: "100", monto: vb }, { codigo: "101", monto: vi }, { codigo: "107", monto: cb }, { codigo: "108", monto: ci }, { codigo: "131", monto: vi }],
      fuente: "manual",
      cargadoAt: new Date().toISOString(),
      ...(noPresento ? { noPresento: true } : {}),
    };
  });
}

function djAnualDemo(p: Perfil, anioActual: number): DeclaracionAnual[] {
  if (p.tipoRuc !== "20") return [];
  return [anioActual - 2, anioActual - 1].map((ej, k) => {
    const crec = k === 0 ? 1 : p.riesgo === "alto" ? 1.18 : 1.07;
    const ventas = Math.round(p.ventasMes * 12 * crec * (k === 0 ? 0.93 : 1));
    const costo = Math.round(ventas * (p.riesgo === "alto" ? 0.74 : 0.58));
    const gVentas = Math.round(ventas * 0.08), gAdm = Math.round(ventas * 0.11), gFin = Math.round(ventas * (p.riesgo === "alto" ? 0.035 : 0.012));
    const bruto = ventas - costo, oper = bruto - gVentas - gAdm, antes = oper - gFin;
    const ir = Math.max(0, Math.round(antes * 0.295)), neto = antes - ir;
    const efectivo = Math.round(ventas * 0.09), cxc = Math.round(ventas * 0.17), merc = Math.round(ventas * 0.12), ppe = Math.round(ventas * 0.35), dep = -Math.round(ppe * 0.28);
    const activo = efectivo + cxc + merc + ppe + dep;
    const trib = Math.round(ventas * 0.02), cxp = Math.round(ventas * 0.13), oblig = Math.round(ventas * (p.riesgo === "alto" ? 0.22 : 0.06));
    const pasivo = trib + cxp + oblig;
    const capital = Math.round(activo * 0.25), utilidad = neto;
    const acumulados = activo - pasivo - capital - utilidad;
    const patrimonio = capital + acumulados + utilidad;
    const v: Record<string, number> = {
      "359": efectivo, "361": cxc, "368": merc, "382": ppe, "383": dep, "390": activo,
      "402": trib, "404": cxp, "409": oblig, "412": pasivo,
      "414": capital, [acumulados >= 0 ? "421" : "422"]: Math.abs(acumulados), "423": utilidad, "425": patrimonio, "426": pasivo + patrimonio,
      "461": ventas, "463": ventas, "464": costo, "466": bruto, "468": gVentas, "469": gAdm, "470": oper, "472": gFin,
      "484": antes, "487": antes, "490": neto, "493": ir,
    };
    return { id: `demo-710-${p.clave}-${ej}`, ejercicio: String(ej), ruc: p.ruc, razonSocial: p.razonSocial, formulario: "710", valores: v, fuente: "manual", cargadoAt: new Date().toISOString() };
  });
}

function deudasDemo(p: Perfil, anio: number): Deuda[] {
  const ahora = new Date().toISOString();
  if (p.riesgo === "alto") return [
    { id: `demo-deu-${p.clave}-1`, tipo: "Orden de Pago", seccion: "Valores", codigoTributo: "1011", numero: "023-001-0458712", descripcion: "IGV - Cuenta propia", monto: 38450, periodo: `08/${anio}`, entidad: "SUNAT", fuente: "manual", creadoAt: ahora },
    { id: `demo-deu-${p.clave}-2`, tipo: "Resolución de Multa", seccion: "Valores", codigoTributo: "6041", numero: "023-002-0127755", descripcion: "Multa art. 176 num. 1 - No presentar la declaración en plazo", monto: 2675, periodo: `05/${anio}`, entidad: "SUNAT", fuente: "manual", creadoAt: ahora },
    { id: `demo-deu-${p.clave}-3`, tipo: "Autoliquidada", seccion: "Autoliquidadas", codigoTributo: "3031", numero: "", descripcion: "Renta 3ra categoría - pago a cuenta", monto: 12960, periodo: `09/${anio}`, entidad: "SUNAT", fuente: "manual", creadoAt: ahora },
  ];
  if (p.riesgo === "medio") return [
    { id: `demo-deu-${p.clave}-1`, tipo: "Autoliquidada", seccion: "Autoliquidadas", codigoTributo: "1011", numero: "", descripcion: "IGV - Cuenta propia (saldo pendiente)", monto: 1840, periodo: `09/${anio}`, entidad: "SUNAT", fuente: "manual", creadoAt: ahora },
  ];
  return [];
}

function deudasF36Demo(p: Perfil, anio: number): Cliente["deudasF36"] {
  if (p.riesgo === "bajo") return null;
  const ahora = new Date().toISOString();
  const valores = p.riesgo === "alto"
    ? [["023-001-0458712", "Orden de Pago", `08/${anio}`, "1011 IGV", `15/10/${anio}`, "34,980.00", "3,470.00", "38,450.00"],
       ["023-002-0127755", "Resolución de Multa", `05/${anio}`, "6041 Multa art. 176-1", `20/07/${anio}`, "2,675.00", "0.00", "2,675.00"]]
    : [];
  const autoliq = p.riesgo === "alto"
    ? [[`09/${anio}`, "3031 Renta 3ra - pago a cuenta", "0621", "1203457788", "12,450.00", "510.00", "12,960.00"]]
    : [[`09/${anio}`, "1011 IGV", "0621", "1203411092", "1,790.00", "50.00", "1,840.00"]];
  return {
    tablas: [
      { pestana: "Valores", headers: ["Nro. Valor", "Tipo", "Periodo", "Tributo", "Fecha emisión", "Insoluto", "Interés", "Total"], filas: valores },
      { pestana: "Deudas Autoliquidadas/Reliquidadas", headers: ["Periodo", "Tributo", "Formulario", "Nro. Orden", "Insoluto", "Interés", "Total"], filas: autoliq },
    ].filter((t) => t.filas.length),
    at: ahora, generadoAt: ahora, estado: "extraido", estadoTexto: "Deudas extraídas", numPedido: "DEMO-000123", fechaPedido: ahora, verificadoAt: ahora,
    nota: "Datos de simulación.",
  };
}

function itfDemo(p: Perfil, anio: number): Cliente["itf"] {
  if (p.tipoRuc !== "10") return null;
  const rnd = rng(`${p.ruc}|itf`);
  const filas = Array.from({ length: 12 }, (_, i) => ({ periodo: `${String(i + 1).padStart(2, "0")}/${anio - 1}`, concepto: "ITF retenido por la entidad financiera", monto: r2(4 + rnd() * (p.negocio === "con" ? 38 : 9)) }));
  return { ejercicio: String(anio - 1), filas, total: r2(filas.reduce((a, f) => a + f.monto, 0)), consultadoEn: new Date().toISOString() };
}

function sunatDemo(p: Perfil): SunatInfo {
  return {
    ruc: p.ruc, razonSocial: p.razonSocial, estado: "ACTIVO", condicion: "HABIDO",
    tipoContribuyente: p.tipoContribuyente, direccion: p.direccion,
    fechaInscripcion: p.tipoRuc === "20" ? "14/03/2017" : "02/08/2019",
    fechaInicioActividades: p.tipoRuc === "20" ? "01/04/2017" : "15/08/2019",
    tributos: p.negocio === "sin" ? ["RENTA 4TA CATEGORÍA", "RENTA 5TA CATEGORÍA"] : [p.regimen, "IGV - OPERACIÓN INTERNA - CTA. PROPIA"],
    comprobanteElectronico: p.negocio !== "sin",
    representantes: p.representante ? [{ tipoDoc: "DNI", numeroDoc: p.representante.numeroDoc, nombre: p.representante.nombre, cargo: p.representante.cargo }] : [],
    fuente: "simulado",
    consultadoAt: new Date().toISOString(),
  };
}

/** Id de la empresa demo: "demo-<clave>" (supremo) o "demo-<clave>-<sufijo>" (otras
 *  cuentas con permiso), para que cada cuenta tenga las suyas sin pisarse. */
export function idDemo(clave: string, sufijo = ""): string {
  return `${DEMO_PREFIJO}${clave}${sufijo ? `-${sufijo}` : ""}`;
}

/** Las 4 empresas de simulación, completas, para el estudio `ownerId`. */
export function empresasDemo(ownerId: string, hoy: string, sufijo = ""): Cliente[] {
  const periodos = periodosDemo(hoy);
  const anio = Number(hoy.slice(0, 4));
  const ahora = new Date().toISOString();
  return PERFILES.map((p) => {
    const sire = periodos.map((per) => sireResumenDemo(p, per, periodos));
    const ultimos = periodos.slice(-2);
    const sireDetalle: NonNullable<Cliente["sireDetalle"]> = {};
    if (p.negocio !== "sin") for (const per of ultimos) for (const t of ["ventas", "compras"] as const) sireDetalle[`${t}-${per}`] = { ...sireDetalleDemo(p, per, t), at: ahora };
    const mensajes = buzonDemo(p, hoy);
    return {
      id: idDemo(p.clave, sufijo),
      demo: true,
      ownerId,
      razonSocial: p.razonSocial,
      ruc: p.ruc,
      ...(p.negocio ? { negocio: p.negocio } : {}),
      itf: itfDemo(p, anio),
      email: p.email,
      telefono: p.telefono,
      createdAt: ahora,
      sunat: sunatDemo(p),
      documentos: [],
      diagnostico: null,
      sire,
      buzon: { peligrosos: mensajes.filter((m) => m.nivel === "peligroso"), urgentes: mensajes.filter((m) => m.nivel === "urgente"), mensajes, totalMensajes: mensajes.length, consultadoAt: ahora },
      sireEstado: { estados: sire.map((s) => ({ periodo: s.periodo, presentadoVentas: s.noObligado ? null : s.presentadoVentas, presentadoCompras: s.noObligado ? null : s.presentadoCompras })), noObligado: p.negocio === "sin", at: ahora },
      sireDetalle,
      declaraciones: declaracionesDemo(p, periodos, sire),
      declaracionesAnuales: djAnualDemo(p, anio),
      deudas: deudasDemo(p, anio),
      deudasF36: deudasF36Demo(p, anio),
      credSire: { solUser: "DEMO2026", clientId: "demo-app-sire", clientSecret: "demo-secret", guardadoAt: ahora },
    } as Cliente;
  });
}

/** ¿Es el RUC de una empresa de simulación? */
export const esRucDemo = (ruc: string) => PERFILES.some((p) => p.ruc === String(ruc || "").replace(/\D/g, ""));

/** Perfil de una empresa de simulación (por id de cliente). */
export function perfilDe(clienteId: string): Perfil | null {
  return PERFILES.find((p) => clienteId === `${DEMO_PREFIJO}${p.clave}` || clienteId.startsWith(`${DEMO_PREFIJO}${p.clave}-`)) ?? null;
}
