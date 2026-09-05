// ============================================================
//  Tipo de cambio SUNAT por fecha (para llenar la columna TC de Contasis)
// ============================================================
// Usa decolecta (el mismo proveedor/token del RUC) por defecto; configurable por
// entorno. Best-effort: si no hay token o falla la consulta, devuelve null y la
// columna TC queda en blanco (no rompe la exportación). Cachea por fecha.
//
// Env:
//   TC_SUNAT_URL   → endpoint. Si trae "{fecha}" se reemplaza; si no, se agrega
//                    "?date=YYYY-MM-DD". Default: decolecta.
//   TC_SUNAT_CAMPO → "venta" (default) | "compra". Para compras/honorarios se usa
//                    normalmente la VENTA del día de la operación.
//   DECOLECTA_TOKEN→ token Bearer (el mismo del RUC).

const cache = new Map<string, number | null>();

/** Convierte "dd/mm/aaaa" (o "dd/mm/aa") a "aaaa-mm-dd". "" si no se puede. */
export function aISO(fechaDMY: string): string {
  const m = /(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(String(fechaDMY || ""));
  if (!m) return "";
  let [, d, mo, y] = m;
  if (y.length === 2) y = "20" + y;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

/** Tipo de cambio SUNAT para una fecha ISO (aaaa-mm-dd). null si no se obtiene. */
export async function tipoCambioSunat(fechaISO: string): Promise<number | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaISO)) return null;
  if (cache.has(fechaISO)) return cache.get(fechaISO)!;

  const base = process.env.TC_SUNAT_URL || "https://api.decolecta.com/v1/tipo-cambio/sunat";
  const campo = (process.env.TC_SUNAT_CAMPO || "venta").toLowerCase();
  const token = process.env.DECOLECTA_TOKEN || "";
  const url = base.includes("{fecha}") ? base.replace("{fecha}", fechaISO) : `${base}?date=${fechaISO}`;

  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      // @ts-ignore  (Node fetch admite signal/timeout según runtime)
      signal: (AbortSignal as any).timeout ? (AbortSignal as any).timeout(15000) : undefined,
    });
    if (!res.ok) { cache.set(fechaISO, null); return null; }
    const j: any = await res.json().catch(() => null);
    if (!j) { cache.set(fechaISO, null); return null; }
    // Acepta varias formas de respuesta (decolecta / apis.net.pe / otros).
    const venta = j.venta ?? j.sell_price ?? j.precio_venta ?? j.tipo_cambio_venta ?? j.selling ?? null;
    const compra = j.compra ?? j.buy_price ?? j.precio_compra ?? j.tipo_cambio_compra ?? j.buying ?? null;
    const bruto = campo === "compra" ? (compra ?? venta) : (venta ?? compra);
    const v = Number(bruto);
    const tc = Number.isFinite(v) && v > 0 ? Math.round(v * 1000) / 1000 : null; // 3 decimales
    cache.set(fechaISO, tc);
    return tc;
  } catch {
    cache.set(fechaISO, null);
    return null;
  }
}

/** Resta un día a una fecha ISO (aaaa-mm-dd). */
function menosUnDia(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

/** TC de una fecha; si ese día no hay (fin de semana/feriado), usa el ÚLTIMO
 *  publicado antes de esa fecha (retrocede día a día hasta `maxDias`). */
export async function tipoCambioConRetroceso(fechaISO: string, maxDias = 8): Promise<number | null> {
  let f = fechaISO;
  for (let i = 0; i <= maxDias; i++) {
    const tc = await tipoCambioSunat(f);
    if (tc != null) return tc;
    f = menosUnDia(f);
  }
  return null;
}

/** Obtiene el TC para un conjunto de fechas ISO (en paralelo, best-effort).
 *  Si un día no tiene TC, usa el último publicado antes de ese día. Devuelve un
 *  mapa fechaISO(original) → TC (o null). */
export async function tiposCambioSunat(fechasISO: string[]): Promise<Record<string, number | null>> {
  const unicas = Array.from(new Set(fechasISO.filter(Boolean)));
  const out: Record<string, number | null> = {};
  await Promise.all(unicas.map(async (f) => { out[f] = await tipoCambioConRetroceso(f); }));
  return out;
}
