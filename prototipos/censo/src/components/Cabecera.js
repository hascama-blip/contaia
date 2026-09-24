// Cabecera fija (como HeaderNav.tsx de Radar): marca, menú, "+ Nueva ficha" y usuario.
import { html, useState } from "./html.js";
import { INSTITUCION } from "../config.js";
import { iniciales } from "../lib/formato.js";

export const MENU = [
  { ruta: "inicio", texto: "Inicio" },
  { ruta: "padron", texto: "Padrón" },
  { ruta: "stands", texto: "Stands" },
  { ruta: "pagos", texto: "Pagos" },
  { ruta: "incidencias", texto: "Incidencias" },
  { ruta: "reportes", texto: "Reportes" },
  { ruta: "campo", texto: "Campo" },
];

export function Cabecera({ seccion, usuario, hayEjemplos, puedeEscribir }) {
  const [abierto, setAbierto] = useState(false);
  const nombre = usuario?.nombre || "Secretaría";
  const enlaces = (movil) =>
    MENU.map((m) => html`
      <a key=${m.ruta} href=${`#${m.ruta}`} aria-current=${seccion === m.ruta ? "page" : undefined}
        onClick=${() => movil && setAbierto(false)}>${m.texto}</a>`);

  return html`
    <header className="cabecera">
      <div className="cabecera-in">
        <a className="marca" href="#inicio">
          <img src=${INSTITUCION.logo} alt="" width="36" height="36" />
          <span>
            <span className="marca-nombre">${INSTITUCION.nombre}</span>
            <span className="marca-sub">Censo y gestión de propietarios</span>
          </span>
        </a>
        <nav className="nav" aria-label="Secciones">
          ${enlaces(false)}
          ${puedeEscribir !== false && html`<a href="#nueva" className="btn btn-primary" style=${{ marginLeft: 8, color: "var(--primario-texto)" }}>+ Nueva ficha</a>`}
        </nav>
        <div className="usuario" title=${nombre}>
          <span className="avatar" aria-hidden="true">${iniciales(nombre)}</span>
          <span className="usuario-nombre">${nombre}</span>
        </div>
        <button className="hamburguesa" aria-label="Menú" aria-expanded=${abierto} onClick=${() => setAbierto((v) => !v)}>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            ${abierto ? html`<path d="M6 6l12 12M18 6L6 18" />` : html`<path d="M4 7h16M4 12h16M4 17h16" />`}
          </svg>
        </button>
      </div>
      <nav className="menu-movil" data-abierto=${abierto ? "true" : "false"} aria-label="Secciones">
        ${enlaces(true)}
        ${puedeEscribir !== false && html`<a href="#nueva" className="btn btn-primary" style=${{ marginTop: 6, color: "var(--primario-texto)" }} onClick=${() => setAbierto(false)}>+ Nueva ficha</a>`}
      </nav>
    </header>
    ${hayEjemplos && html`<div className="franja-ejemplo">Estás viendo datos de ejemplo. Cuando vayas a cargar el padrón real, vacíalos desde <a href="#reportes">Reportes</a>.</div>`}`;
}
