// Piezas de interfaz reutilizables (como components/ui.tsx en Radar).
import { html, useEffect } from "./html.js";
import { ESTADOS_CENSO, ESTADOS_STAND, GRAVEDADES, ESTADOS_INCIDENCIA, ESTADOS_ASOCIADO } from "../lib/types.js";

export function Badge({ tono = "neutro", punto = false, children }) {
  return html`<span className=${`badge b-${tono}`}>${punto && html`<span className="punto" aria-hidden="true"></span>`}${children}</span>`;
}

const deCatalogo = (catalogo) => ({ estado }) => {
  const e = catalogo[estado] || { label: estado || "—", tono: "neutro" };
  return html`<${Badge} tono=${e.tono}>${e.corto || e.label}<//>`;
};
export const BadgeCenso = deCatalogo(ESTADOS_CENSO);
export const BadgeStand = deCatalogo(ESTADOS_STAND);
export const BadgeGravedad = deCatalogo(GRAVEDADES);
export const BadgeIncidencia = deCatalogo(ESTADOS_INCIDENCIA);
export const BadgeAsociado = deCatalogo(ESTADOS_ASOCIADO);

export function BadgeAtraso({ meses }) {
  if (!meses) return html`<${Badge} tono="ok">Al día<//>`;
  return html`<${Badge} tono=${meses >= 3 ? "peligro" : "alerta"}>${meses === 1 ? "1 mes" : `${meses} meses`}<//>`;
}

export function Kpi({ etiqueta, valor, nota, tono }) {
  return html`
    <div className="card kpi">
      <span className="kpi-et">${etiqueta}</span>
      <span className=${`kpi-val ${tono || ""}`}>${valor}</span>
      ${nota && html`<span className="kpi-nota">${nota}</span>`}
    </div>`;
}

export function Tarjeta({ titulo, sub, accion, children, sinCuerpo = false, className = "" }) {
  return html`
    <section className=${`card ${className}`}>
      ${(titulo || accion) && html`
        <div className="card-cab">
          <div>
            ${titulo && html`<h2 className="card-titulo">${titulo}</h2>`}
            ${sub && html`<p className="card-sub">${sub}</p>`}
          </div>
          ${accion}
        </div>`}
      ${sinCuerpo ? children : html`<div className="card-cuerpo">${children}</div>`}
    </section>`;
}

export function CabPagina({ miga, titulo, sub, acciones }) {
  return html`
    <div className="pag-cab">
      <div>
        ${miga && html`<a className="miga" href=${miga.href}>← ${miga.texto}</a>`}
        <h1 className="pag-titulo">${titulo}</h1>
        ${sub && html`<p className="pag-sub">${sub}</p>`}
      </div>
      ${acciones && html`<div className="acciones">${acciones}</div>`}
    </div>`;
}

/** Etiqueta + control + ayuda/error. */
export function Campo({ id, etiqueta, req, error, ayuda, className = "", children }) {
  return html`
    <div className=${`campo ${className}`}>
      <label className="label" htmlFor=${id}>${etiqueta}${req && html` <span className="req" aria-hidden="true">*</span>`}</label>
      ${children}
      ${error ? html`<span className="error-campo" id=${`${id}-error`}>${error}</span>` : ayuda && html`<span className="ayuda">${ayuda}</span>`}
    </div>`;
}

export function Entrada({ id, valor, onCambio, error, tipo = "text", lista, ...resto }) {
  return html`<input
    id=${id} className="input" type=${tipo} value=${valor ?? ""} list=${lista}
    aria-invalid=${error ? "true" : undefined} aria-describedby=${error ? `${id}-error` : undefined}
    onChange=${(e) => onCambio(e.target.value)} ...${resto} />`;
}

export function Selector({ id, valor, onCambio, opciones, vacio = "Seleccione…", error, ...resto }) {
  return html`
    <select id=${id} className="input" value=${valor ?? ""} aria-invalid=${error ? "true" : undefined}
      onChange=${(e) => onCambio(e.target.value)} ...${resto}>
      ${vacio !== null && html`<option value="">${vacio}</option>`}
      ${opciones.map((o) => {
        const [v, t] = Array.isArray(o) ? o : [o, o];
        return html`<option key=${v} value=${v}>${t}</option>`;
      })}
    </select>`;
}

export function Texto({ id, valor, onCambio, ...resto }) {
  return html`<textarea id=${id} className="input" value=${valor ?? ""} onChange=${(e) => onCambio(e.target.value)} ...${resto}></textarea>`;
}

export function Barra({ pct, tono }) {
  return html`<div className="barra" role="progressbar" aria-valuenow=${pct} aria-valuemin="0" aria-valuemax="100"><span className=${tono || ""} style=${{ width: `${Math.min(100, pct)}%` }}></span></div>`;
}

export function Vacio({ children }) {
  return html`<div className="vacio">${children}</div>`;
}

/** Panel lateral (registrar pago, incidencia, editar stand). Esc lo cierra. */
export function Panel({ titulo, onCerrar, pie, children }) {
  useEffect(() => {
    const esc = (e) => e.key === "Escape" && onCerrar();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onCerrar]);
  return html`
    <div className="panel-fondo" onClick=${(e) => e.target === e.currentTarget && onCerrar()}>
      <aside className="panel" role="dialog" aria-modal="true" aria-label=${titulo}>
        <div className="panel-cab">
          <h2 className="card-titulo">${titulo}</h2>
          <button className="cerrar" onClick=${onCerrar} aria-label="Cerrar">×</button>
        </div>
        <div className="panel-cuerpo">${children}</div>
        ${pie && html`<div className="panel-pie">${pie}</div>`}
      </aside>
    </div>`;
}

/** Mensaje para errores de la base o de validación. */
export function mensajeError(e) {
  if (e?.errores) return Object.values(e.errores)[0] || "Revisa los campos marcados.";
  switch (e?.code) {
    case "quota_exceeded": return "La base llegó a su límite de documentos. Vacía los datos de ejemplo o avísanos.";
    case "resource_exhausted": case "rate_limited": return "Demasiados cambios seguidos. Espera unos segundos y vuelve a intentar.";
    case "invalid_argument": return "Tu acceso a esta página es de solo lectura; pide acceso de edición al dueño.";
    case "sin_base": return "No hay conexión con la base de datos en esta vista.";
    case "declined": return "Descarga cancelada.";
    default: return e?.message || "No se pudo completar. Vuelve a intentar.";
  }
}
