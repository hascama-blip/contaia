// Módulos de paga (2, 3, 4). El módulo 1 (Reporte analítico) es libre.
// El usuario supremo los desbloquea por estudio desde su panel.

export interface ModuloDef {
  key: string;
  nombre: string;
  href: string;
}

export const MODULOS_PAGOS: ModuloDef[] = [
  { key: "m2", nombre: "Comparativo SIRE vs sistema contable", href: "/herramientas/cruce-sire" },
  { key: "m3", nombre: "Masivo SIRE → Contabilidad (Contasis)", href: "/herramientas/procesar-compras" },
  { key: "m4", nombre: "Consultas tributarias", href: "/herramientas/consultas" },
];

export const MODULO_KEYS = MODULOS_PAGOS.map((m) => m.key);

export function moduloPorHref(href: string): ModuloDef | undefined {
  return MODULOS_PAGOS.find((m) => href.startsWith(m.href));
}
