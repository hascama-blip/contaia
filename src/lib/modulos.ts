// Control de acceso por PLAN. El supremo asigna un plan a cada estudio y de ahí
// se derivan los módulos desbloqueados. Los "utilitarios" son SOLO del supremo.

export type PlanId = "basico" | "regular" | "premium" | "equipo";

// Orden de menor a mayor: un plan incluye todo lo de los planes anteriores.
export const PLAN_ORDEN: PlanId[] = ["basico", "regular", "premium", "equipo"];

export const PLAN_LABEL: Record<PlanId, string> = {
  basico: "Básico (gratis)",
  regular: "Regular",
  premium: "Premium",
  equipo: "Plan de Equipo",
};

/** ¿El `plan` del usuario incluye (>=) el plan mínimo requerido? */
export function planIncluye(plan: PlanId | undefined, min: PlanId): boolean {
  const p = plan ?? "basico";
  return PLAN_ORDEN.indexOf(p) >= PLAN_ORDEN.indexOf(min);
}

export interface ModuloDef {
  key: string;
  nombre: string;
  href: string;
  /** Plan mínimo que lo desbloquea (por defecto "basico" = libre para todos). */
  planMin?: PlanId;
  /** Utilitario: solo el supremo lo ve/usa. */
  soloSupremo?: boolean;
}

export const MODULOS: ModuloDef[] = [
  // Principales (según planes)
  { key: "reporte", nombre: "Reporte analítico de auditoría", href: "/clientes", planMin: "basico" },
  { key: "consultas", nombre: "Consultas tributarias", href: "/herramientas/consultas", planMin: "regular" },
  { key: "detalle-sire", nombre: "Detalle SIRE", href: "/herramientas/detalle-sire", planMin: "premium" },
  { key: "rtt", nombre: "Reporte Tributario para Terceros (RTT)", href: "/herramientas/rtt", planMin: "premium" },
  // Utilitarios — solo supremo
  { key: "conciliacion", nombre: "Conciliación bancaria", href: "/herramientas/conciliacion", soloSupremo: true },
  { key: "ventas-caja", nombre: "Ventas vs Caja Virtual", href: "/herramientas/ventas-caja", soloSupremo: true },
  { key: "banco-word", nombre: "Estado de cuenta (PDF) → Word", href: "/herramientas/banco-word", soloSupremo: true },
  { key: "analisis-rtp", nombre: "Análisis para RTP", href: "/herramientas/analisis-compras", soloSupremo: true },
  { key: "comprobantes-xml", nombre: "Comprobante XML SUNAT", href: "/herramientas/comprobantes-xml", soloSupremo: true },
  // Legacy (no están en el menú; se conservan como solo-supremo)
  { key: "cruce-sire", nombre: "Comparativo SIRE vs sistema contable", href: "/herramientas/cruce-sire", soloSupremo: true },
  { key: "procesar-compras", nombre: "Masivo SIRE → Contabilidad (Contasis)", href: "/herramientas/procesar-compras", soloSupremo: true },
];

export const TODOS_MODULO_KEYS = MODULOS.map((m) => m.key);

// Utilitarios: por defecto solo el supremo, pero el supremo puede habilitarlos
// por cuenta (se guardan en Usuario.modulos).
export const UTILITARIO_KEYS = MODULOS.filter((m) => m.soloSupremo).map((m) => m.key);
export const UTILITARIOS_DEF = MODULOS.filter((m) => m.soloSupremo);

export function moduloPorHref(href: string): ModuloDef | undefined {
  return MODULOS.find((m) => href.startsWith(m.href));
}

/** Keys de módulos accesibles para un plan (sin los solo-supremo). */
export function modulosDePlan(plan: PlanId | undefined): string[] {
  return MODULOS
    .filter((m) => !m.soloSupremo && planIncluye(plan, m.planMin ?? "basico"))
    .map((m) => m.key);
}
