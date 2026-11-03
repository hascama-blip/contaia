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
  // Ejemplo: "2026-01": { "0": "2026-02-13", "1": "2026-02-16", "2-3": "2026-02-17", "4-5": "2026-02-18", "6-7": "2026-02-19", "8-9": "2026-02-20", "BUC": "2026-02-23" },
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
