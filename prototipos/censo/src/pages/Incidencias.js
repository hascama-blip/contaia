// Llamadas de atención e incidencias: registro formal de hechos.
import { html, useState, useMemo, useEffect } from "../components/html.js";
import { Badge } from "../components/ui.js";
import { nombresDe } from "../lib/usuario.js";
import { CabPagina, Tarjeta, BadgeGravedad, Vacio, mensajeError } from "../components/ui.js";
import { PanelIncidencia } from "../components/Incidencias.js";
import { useApp } from "../components/contexto.js";
import { ESTADOS_INCIDENCIA } from "../lib/types.js";
import { LIMITE_INCIDENCIAS } from "../config.js";
import { alertasReincidencia, conteoPorTipo, ordenarRecientes, responsableDe } from "../lib/incidencias.js";
import { nombreCompleto, normalizar } from "../lib/padron.js";
import { fecha, fechaHora } from "../lib/formato.js";
import { cambiarEstadoIncidencia } from "../api/incidencias.js";

export function Incidencias() {
  const { datos, derivados, puedeEscribir, avisar, usuario } = useApp();
  // Autor de cada incidencia: se guarda el id y el nombre se resuelve al mostrar.
  const [autores, setAutores] = useState({});
  const idsAutores = [...new Set(datos.incidencias.map((i) => i.por).filter(Boolean))].sort().join(",");
  useEffect(() => {
    if (idsAutores) nombresDe(idsAutores.split(",")).then(setAutores).catch(() => {});
  }, [idsAutores]);
  const autor = (i) => {
    if (!i.por) return i.ejemplo ? "Dato de ejemplo" : "Sin registro";
    return autores[i.por] || (i.por === usuario?.id && usuario?.nombre) || "Usuario del portal";
  };
  const { h, porId } = derivados;
  const [panel, setPanel] = useState(false);
  const [filtro, setFiltro] = useState("");
  const [texto, setTexto] = useState("");
  const lista = useMemo(() => {
    const partes = normalizar(texto).split(/\s+/).filter(Boolean);
    return ordenarRecientes(datos.incidencias)
      .filter((i) => !filtro || (filtro === "abiertas" ? i.estado !== "cerrada" : i.estado === filtro))
      .filter((i) => {
        if (!partes.length) return true;
        const a = porId.get(i.asociadoId);
        const pajar = normalizar(`${i.involucrado} ${i.stand} ${String(i.stand).replace("-", "")} ${i.tipo} ${a ? `${a.dni} ${a.numero} ${nombreCompleto(a)}` : ""}`);
        return partes.every((p) => pajar.includes(p));
      });
  }, [datos.incidencias, filtro, texto, porId]);
  const alertas = useMemo(() => alertasReincidencia(datos.incidencias, h.iso), [datos.incidencias, h]);
  const porTipo = useMemo(() => conteoPorTipo(datos.incidencias, h.anio), [datos.incidencias, h]);
  const editable = puedeEscribir !== false;

  async function estado(id, valor) {
    try {
      await cambiarEstadoIncidencia(id, valor);
      avisar(`Incidencia: ${ESTADOS_INCIDENCIA[valor].label.toLowerCase()}.`);
    } catch (e) {
      avisar(mensajeError(e), "error");
    }
  }

  return html`
    <div className="pagina">
      <${CabPagina} miga=${{ href: "#inicio", texto: "Inicio" }} titulo="Llamadas de atención e incidencias" sub="Registro formal de hechos"
        acciones=${editable && html`<button className="btn btn-primary" onClick=${() => setPanel(true)}>Registrar incidencia</button>`} />

      <div className="rejilla r-8-4" style=${{ alignItems: "start" }}>
        <section className="card">
          <div className="filtros">
            <label className="sr" htmlFor="inc-buscar">Buscar</label>
            <input id="inc-buscar" className="input buscar" type="search" placeholder="Buscar por DNI, nombre o stand" value=${texto} onChange=${(e) => setTexto(e.target.value)} />
            <label className="sr" htmlFor="inc-filtro">Estado</label>
            <select id="inc-filtro" className="input" value=${filtro} onChange=${(e) => setFiltro(e.target.value)}>
              <option value="">Todas</option>
              <option value="abiertas">Abiertas y en seguimiento</option>
              <option value="cerrada">Cerradas</option>
            </select>
            <span className="muted" style=${{ fontSize: "var(--t-xs)" }}>${lista.length} registros</span>
          </div>
          <div className="tabla-caja">
            <table className="tabla">
              <thead><tr><th>Fecha</th><th>Involucrado / stand</th><th>Tipo</th><th>Gravedad</th><th>Medida adoptada</th><th>Registrado por</th><th>Estado</th></tr></thead>
              <tbody>
                ${lista.map((i) => html`<tr key=${i.id}>
                  <td className="num">${fecha(i.fecha)}</td>
                  <td><a href=${`#ficha-${i.asociadoId}`}>${i.involucrado || nombreCompleto(porId.get(i.asociadoId))}</a><br /><span style=${{ display: "inline-flex", gap: 6, alignItems: "center", marginTop: 3 }}>
                    <${Badge} tono=${responsableDe(i) === "inquilino" ? "alerta" : "neutro"}>${responsableDe(i) === "inquilino" ? "Inquilino" : "Propietario"}<//>
                    <span className="muted num" style=${{ fontSize: "var(--t-xs)" }}>${i.stand}</span></span></td>
                  <td>${i.tipo}${i.detalle && html`<br /><span className="muted" style=${{ fontSize: "var(--t-xs)" }}>${i.detalle}</span>`}</td>
                  <td><${BadgeGravedad} estado=${i.gravedad} /></td>
                  <td>${i.medida}</td>
                  <td>${autor(i)}${i.creadoAt && html`<br /><span className="muted num" style=${{ fontSize: "var(--t-xs)" }}>${fechaHora(i.creadoAt)}</span>`}</td>
                  <td>${editable
                    ? html`<label className="sr" htmlFor=${`inc-e-${i.id}`}>Estado</label>
                      <select id=${`inc-e-${i.id}`} className="input" style=${{ minHeight: 32, padding: "4px 8px", fontSize: "var(--t-xs)" }} value=${i.estado} onChange=${(e) => estado(i.id, e.target.value)}>
                        ${Object.entries(ESTADOS_INCIDENCIA).map(([k, v]) => html`<option key=${k} value=${k}>${v.label}</option>`)}
                      </select>`
                    : ESTADOS_INCIDENCIA[i.estado]?.label}</td>
                </tr>`)}
              </tbody>
            </table>
            ${!lista.length && html`<${Vacio}>${texto ? `Ninguna incidencia coincide con "${texto}".` : "No hay incidencias con ese filtro."}<//>`}
          </div>
        </section>

        <div style=${{ display: "flex", flexDirection: "column", gap: 16 }}>
          ${alertas.map((al) => html`<div key=${al.asociadoId} className="aviso aviso-peligro" role="alert">
            <span><strong>Alerta automática.</strong> <a href=${`#ficha-${al.asociadoId}`} style=${{ color: "inherit", fontWeight: 700 }}>${nombreCompleto(porId.get(al.asociadoId))}</a> acumula ${al.cantidad} llamadas de atención en los últimos doce meses. Corresponde evaluar sanción según estatutos.</span>
          </div>`)}
          ${!alertas.length && html`<div className="aviso aviso-ok">Nadie llega a ${LIMITE_INCIDENCIAS} llamadas de atención en los últimos doce meses.</div>`}
          <${Tarjeta} titulo=${`Incidencias por tipo · ${h.anio}`}>
            ${!porTipo.length && html`<${Vacio}>Sin incidencias este año.<//>`}
            <ul className="lista">
              ${porTipo.map(([tipo, n]) => html`<li key=${tipo}><span>${tipo}</span><span className="num">${n}</span></li>`)}
            </ul>
          <//>
        </div>
      </div>
      ${panel && html`<${PanelIncidencia} onCerrar=${() => setPanel(false)} />`}
    </div>`;
}
