// Formatos de presentación (como fmtSoles / fmtFecha de components/ui.tsx en Radar).
import { MESES } from "../config.js";

export const pad = (n) => String(n).padStart(2, "0");

export function soles(n, dec = 0) {
  return "S/ " + Number(n || 0).toLocaleString("es-PE", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

/** "2026-09-06" → "06/09/2026" */
export function fecha(iso) {
  if (!iso) return "—";
  const [a, m, d] = String(iso).slice(0, 10).split("-");
  return d && m && a ? `${d}/${m}/${a}` : "—";
}

/** "2026-09-06" → "06 set" */
export function fechaCorta(iso) {
  if (!iso) return "—";
  const [, m, d] = String(iso).slice(0, 10).split("-");
  return `${d} ${MESES[Number(m) - 1]?.toLowerCase() ?? ""}`;
}

export function hoy() {
  const h = new Date();
  const anio = h.getFullYear();
  const mes = h.getMonth() + 1;
  const dia = h.getDate();
  return { anio, mes, dia, iso: `${anio}-${pad(mes)}-${pad(dia)}` };
}

export function ahoraISO() {
  return new Date().toISOString();
}

export function iniciales(nombre) {
  return (nombre || "").split(/\s+/).filter(Boolean).map((p) => p[0]).slice(0, 2).join("").toUpperCase() || "?";
}

export function haceCuanto(ms) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 10) return "hace un momento";
  if (s < 60) return `hace ${s} segundos`;
  const m = Math.round(s / 60);
  return m === 1 ? "hace 1 minuto" : `hace ${m} minutos`;
}

export function porcentaje(parte, total) {
  return total ? Math.round((parte / total) * 100) : 0;
}

/** ISO con hora → "24/09/2026 11:05" en la hora local de quien mira. */
export function fechaHora(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "—";
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
