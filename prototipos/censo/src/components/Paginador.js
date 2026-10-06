// Paginación de listas largas: « 1 2 3 … » y "Mostrando 1–25 de 252".
import { html, useState, useEffect } from "./html.js";

export const POR_PAGINA = 25;

/** Devuelve [pagina, setPagina, porcion, total] y vuelve a la página 1 cuando cambia la lista filtrada. */
export function usePaginacion(lista, porPagina = POR_PAGINA) {
  const [pagina, setPagina] = useState(1);
  const total = Math.max(1, Math.ceil(lista.length / porPagina));
  useEffect(() => { setPagina(1); }, [lista.length, lista[0]?.id]);
  const p = Math.min(pagina, total);
  return { pagina: p, setPagina, total, porcion: lista.slice((p - 1) * porPagina, p * porPagina), desde: lista.length ? (p - 1) * porPagina + 1 : 0, hasta: Math.min(p * porPagina, lista.length) };
}

function numeros(pagina, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const s = new Set([1, total, pagina - 1, pagina, pagina + 1].filter((n) => n >= 1 && n <= total));
  const out = []; let prev = 0;
  for (const n of [...s].sort((a, b) => a - b)) { if (n - prev > 1) out.push("…"); out.push(n); prev = n; }
  return out;
}

export function Paginador({ pagina, total, onPagina }) {
  if (total <= 1) return null;
  return html`
    <nav className="paginador" aria-label="Páginas">
      <button className="btn btn-ghost btn-sm" disabled=${pagina <= 1} onClick=${() => onPagina(pagina - 1)} aria-label="Anterior">‹</button>
      ${numeros(pagina, total).map((n, i) => n === "…"
        ? html`<span key=${"e" + i} className="muted">…</span>`
        : html`<button key=${n} className=${"btn btn-sm " + (n === pagina ? "btn-primary" : "btn-ghost")} aria-current=${n === pagina ? "page" : undefined} onClick=${() => onPagina(n)}>${n}</button>`)}
      <button className="btn btn-ghost btn-sm" disabled=${pagina >= total} onClick=${() => onPagina(pagina + 1)} aria-label="Siguiente">›</button>
    </nav>`;
}
