// ============================================================
//  Cronograma SUNAT de obligaciones mensuales (vencimientos por último dígito)
// ============================================================
// SUNAT publica cada año el cronograma: el periodo YYYY-MM vence en el mes
// siguiente, en días hábiles escalonados por el ÚLTIMO DÍGITO del RUC
// (0 · 1 · 2-3 · 4-5 · 6-7 · 8-9 · buenos contribuyentes y UESP).
//
// `OFICIAL` guarda las fechas publicadas (llénalo por periodo cuando salga la
// resolución); si un periodo no está, se usa una aproximación con el patrón
// habitual (arranca alrededor del día 14 del mes siguiente, un día hábil por
// grupo), marcada como "referencial" para que el usuario lo verifique.

export type Grupo = "0" | "1" | "2-3" | "4-5" | "6-7" | "8-9" | "BUC";
export const GRUPOS: Grupo[] = ["0", "1", "2-3", "4-5", "6-7", "8-9", "BUC"];

/** Fechas oficiales por periodo (YYYY-MM) → grupo → YYYY-MM-DD. */
export const OFICIAL: Record<string, Partial<Record<Grupo, string>>> = {
  // Cronograma de obligaciones mensuales 2026 (SUNAT). El periodo diciembre
  // 2026 se declara en enero de 2027.
  "2026-01": { "0": "2026-02-16", "1": "2026-02-17", "2-3": "2026-02-18", "4-5": "2026-02-19", "6-7": "2026-02-20", "8-9": "2026-02-23", "BUC": "2026-02-24" },
  "2026-02": { "0": "2026-03-16", "1": "2026-03-17", "2-3": "2026-03-18", "4-5": "2026-03-19", "6-7": "2026-03-20", "8-9": "2026-03-23", "BUC": "2026-03-24" },
  "2026-03": { "0": "2026-04-17", "1": "2026-04-20", "2-3": "2026-04-21", "4-5": "2026-04-22", "6-7": "2026-04-23", "8-9": "2026-04-24", "BUC": "2026-04-27" },
  "2026-04": { "0": "2026-05-18", "1": "2026-05-19", "2-3": "2026-05-20", "4-5": "2026-05-21", "6-7": "2026-05-22", "8-9": "2026-05-25", "BUC": "2026-05-26" },
  "2026-05": { "0": "2026-06-15", "1": "2026-06-16", "2-3": "2026-06-17", "4-5": "2026-06-18", "6-7": "2026-06-19", "8-9": "2026-06-22", "BUC": "2026-06-23" },
  "2026-06": { "0": "2026-07-15", "1": "2026-07-16", "2-3": "2026-07-17", "4-5": "2026-07-20", "6-7": "2026-07-21", "8-9": "2026-07-22", "BUC": "2026-07-24" },
  "2026-07": { "0": "2026-08-18", "1": "2026-08-19", "2-3": "2026-08-20", "4-5": "2026-08-21", "6-7": "2026-08-24", "8-9": "2026-08-25", "BUC": "2026-08-26" },
  "2026-08": { "0": "2026-09-15", "1": "2026-09-16", "2-3": "2026-09-17", "4-5": "2026-09-18", "6-7": "2026-09-21", "8-9": "2026-09-22", "BUC": "2026-09-23" },
  "2026-09": { "0": "2026-10-16", "1": "2026-10-19", "2-3": "2026-10-20", "4-5": "2026-10-21", "6-7": "2026-10-22", "8-9": "2026-10-23", "BUC": "2026-10-26" },
  "2026-10": { "0": "2026-11-16", "1": "2026-11-17", "2-3": "2026-11-18", "4-5": "2026-11-19", "6-7": "2026-11-20", "8-9": "2026-11-23", "BUC": "2026-11-24" },
  "2026-11": { "0": "2026-12-17", "1": "2026-12-18", "2-3": "2026-12-21", "4-5": "2026-12-22", "6-7": "2026-12-23", "8-9": "2026-12-24", "BUC": "2026-12-28" },
  "2026-12": { "0": "2027-01-18", "1": "2027-01-19", "2-3": "2027-01-20", "4-5": "2027-01-21", "6-7": "2027-01-22", "8-9": "2027-01-25", "BUC": "2027-01-26" },
};

// Feriados nacionales fijos (los móviles de Semana Santa no se incluyen; la
// aproximación es referencial).
const FERIADOS_FIJOS = ["01-01", "05-01", "06-07", "06-29", "07-23", "07-28", "07-29", "08-06", "08-30", "10-08", "11-01", "12-08", "12-09", "12-25"];

function esHabil(d: Date): boolean {
  const dow = d.getDay();
  if (dow === 0 || dow === 6) return false;
  const mmdd = `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return !FERIADOS_FIJOS.includes(mmdd);
}
function siguienteHabil(d: Date): Date {
  const x = new Date(d);
  while (!esHabil(x)) x.setDate(x.getDate() + 1);
  return x;
}
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function grupoDeRuc(ruc: string): Grupo {
  const d = ruc.replace(/\D/g, "").slice(-1);
  if (d === "0") return "0";
  if (d === "1") return "1";
  if (d === "2" || d === "3") return "2-3";
  if (d === "4" || d === "5") return "4-5";
  if (d === "6" || d === "7") return "6-7";
  return "8-9";
}

/** Vencimiento del periodo YYYY-MM para un grupo. `oficial` indica si salió de la tabla publicada. */
export function vencimientoPeriodo(periodo: string, grupo: Grupo): { fecha: string; oficial: boolean } {
  const of = OFICIAL[periodo]?.[grupo];
  if (of) return { fecha: of, oficial: true };
  const [y, m] = periodo.split("-").map(Number);
  // Mes siguiente, arranque el día 14 (patrón habitual), un día hábil por grupo.
  let d = siguienteHabil(new Date(y, m, 14)); // new Date(y, m, …) = mes siguiente (m es 1-based)
  for (let i = 0; i < GRUPOS.indexOf(grupo); i++) {
    d = new Date(d); d.setDate(d.getDate() + 1); d = siguienteHabil(d);
  }
  return { fecha: iso(d), oficial: false };
}

/** Periodo (YYYY-MM) anterior al mes de la fecha dada. */
export function periodoAnterior(hoy = new Date()): string {
  const d = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export interface ProximoVencimiento {
  ruc: string;
  razonSocial: string;
  clienteId: string;
  periodo: string;
  grupo: Grupo;
  fecha: string;      // YYYY-MM-DD
  dias: number;       // días que faltan (0 = hoy; negativo = ya pasó)
  oficial: boolean;
}

/** Próximos vencimientos de declaración mensual de una lista de empresas,
 *  para el periodo anterior (si ya pasó, el siguiente), hasta `dentroDe` días. */
export function proximosVencimientos(
  clientes: { id: string; ruc: string; razonSocial: string }[],
  dentroDe = 15,
  hoy = new Date(),
): ProximoVencimiento[] {
  const h = new Date(hoy); h.setHours(0, 0, 0, 0);
  const out: ProximoVencimiento[] = [];
  for (const c of clientes) {
    if (!/^\d{11}$/.test(c.ruc)) continue;
    const grupo = grupoDeRuc(c.ruc);
    // Periodo anterior; si su vencimiento ya pasó hace más de 1 día, mira el siguiente periodo.
    let periodo = periodoAnterior(h);
    let v = vencimientoPeriodo(periodo, grupo);
    let dias = Math.round((new Date(`${v.fecha}T00:00:00`).getTime() - h.getTime()) / 86400000);
    if (dias < -1) {
      const [y, m] = periodo.split("-").map(Number);
      const d = new Date(y, m, 1); // siguiente periodo
      periodo = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      v = vencimientoPeriodo(periodo, grupo);
      dias = Math.round((new Date(`${v.fecha}T00:00:00`).getTime() - h.getTime()) / 86400000);
    }
    if (dias <= dentroDe) out.push({ ruc: c.ruc, razonSocial: c.razonSocial, clienteId: c.id, periodo, grupo, fecha: v.fecha, dias, oficial: v.oficial });
  }
  return out.sort((a, b) => a.dias - b.dias || a.razonSocial.localeCompare(b.razonSocial));
}

// ---- Análisis de cierre ------------------------------------------------------
// Al emitir un informe de un periodo (p. ej. octubre, generado a inicios de
// noviembre): cuándo vence la DJ mensual de esa empresa según el último dígito
// de su RUC y cuánto tiempo queda para regularizar las diferencias.

export type EstadoCierre = "en-plazo" | "urgente" | "vence-hoy" | "vencido";

export interface CierrePeriodo {
  periodo: string;          // YYYY-MM
  ultimoDigito: string;
  grupo: Grupo;
  vence: string;            // YYYY-MM-DD
  oficial: boolean;         // del cronograma publicado (si no, referencial)
  diasCalendario: number;   // negativos = días de atraso
  diasHabiles: number;      // hábiles que quedan, contando hoy si es hábil (0 si ya venció)
  estado: EstadoCierre;
  /** El periodo es el mes en curso (aún se registran operaciones; se declara el mes siguiente). */
  enCurso: boolean;
}

/** ¿El análisis de cierre aplica a este periodo? Solo al periodo POR DECLARAR (mes
 *  anterior a hoy, vence este mes) y al MES EN CURSO (vence el mes siguiente). Los
 *  meses pasados ya debieron declararse: no se les cuenta plazo. */
export function cierreAplica(periodo: string, hoy: string): boolean {
  const p = /^\d{6}$/.test(periodo) ? `${periodo.slice(0, 4)}-${periodo.slice(4)}` : periodo;
  const [y, m] = hoy.split("-").map(Number);
  const actual = `${y}-${String(m).padStart(2, "0")}`;
  const ant = new Date(y, m - 2, 1);
  const anterior = `${ant.getFullYear()}-${String(ant.getMonth() + 1).padStart(2, "0")}`;
  return p === actual || p === anterior;
}

function deIso(s: string): Date { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }

/** Días hábiles desde `desde` (incluido) hasta `hasta` (incluido). */
export function diasHabilesEntre(desde: string, hasta: string): number {
  let n = 0;
  for (let d = deIso(desde); d <= deIso(hasta); d.setDate(d.getDate() + 1)) if (esHabil(d)) n++;
  return n;
}

/** Cierre del periodo para una empresa (`periodo` YYYY-MM o YYYYMM; `hoy` YYYY-MM-DD, hora de Lima). */
export function analisisCierre(ruc: string, periodo: string, hoy: string, buenContribuyente = false): CierrePeriodo | null {
  const p = /^\d{6}$/.test(periodo) ? `${periodo.slice(0, 4)}-${periodo.slice(4)}` : periodo;
  if (!/^\d{4}-\d{2}$/.test(p) || !/^\d{11}$/.test(ruc)) return null;
  const grupo: Grupo = buenContribuyente ? "BUC" : grupoDeRuc(ruc);
  const v = vencimientoPeriodo(p, grupo);
  const diasCalendario = Math.round((deIso(v.fecha).getTime() - deIso(hoy).getTime()) / 86400000);
  const diasHabiles = diasCalendario >= 0 ? diasHabilesEntre(hoy, v.fecha) : 0;
  const [y, m] = p.split("-").map(Number);
  const finPeriodo = iso(new Date(y, m, 0)); // último día del periodo
  const estado: EstadoCierre =
    diasCalendario < 0 ? "vencido"
    : diasCalendario === 0 ? "vence-hoy"
    : diasHabiles <= 3 ? "urgente"
    : "en-plazo";
  return { periodo: p, ultimoDigito: ruc.slice(-1), grupo, vence: v.fecha, oficial: v.oficial, diasCalendario, diasHabiles, estado, enCurso: hoy <= finPeriodo };
}
