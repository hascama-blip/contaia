// Padrón de asociados: búsqueda, filtros y exportación.
import { html, useState, useMemo } from "../components/html.js";
import { CabPagina, BadgeCenso, BadgeAtraso, Vacio, mensajeError } from "../components/ui.js";
import { useApp } from "../components/contexto.js";
import { GALERIAS } from "../config.js";
import { ESTADOS_CENSO } from "../lib/types.js";
import { filtrarPadron, nombreCompleto, nombreGaleria, ordenarPorNumero } from "../lib/padron.js";
import { aCSV, descargar, COLUMNAS_PADRON } from "../lib/exportar.js";
import { hoy } from "../lib/formato.js";

export function Padron() {
  const { datos, derivados, caps, ir, avisar, puedeEscribir } = useApp();
  const [filtro, setFiltro] = useState({ texto: "", galeria: "", censo: "" });
  const lista = useMemo(
    () => ordenarPorNumero(filtrarPadron(datos.asociados, derivados.mapaStands, filtro)),
    [datos.asociados, derivados.mapaStands, filtro],
  );
  const cambia = (k) => (e) => setFiltro((f) => ({ ...f, [k]: e.target.value }));

  async function exportar() {
    try {
      const csv = aCSV(COLUMNAS_PADRON(derivados.mapaStands, derivados.atraso), lista);
      await descargar(`padron-asociados-${hoy().iso}.csv`, csv);
      avisar("Padrón exportado.");
    } catch (e) {
      if (e?.code !== "declined") avisar(mensajeError(e), "error");
    }
  }

  return html`
    <div className="pagina">
      <${CabPagina} miga=${{ href: "#inicio", texto: "Inicio" }} titulo="Padrón de asociados"
        sub=${`${datos.asociados.length} asociados registrados`}
        acciones=${html`
          ${caps.descargas && html`<button className="btn btn-ghost" onClick=${exportar}>Exportar a Excel (CSV)</button>`}
          ${puedeEscribir !== false && html`<a className="btn btn-primary" href="#nueva">+ Nueva ficha</a>`}`} />

      <section className="card">
        <div className="filtros">
          <label className="sr" htmlFor="pad-buscar">Buscar</label>
          <input id="pad-buscar" className="input buscar" type="search" placeholder="Buscar por DNI, nombre, N° de asociado o stand"
            value=${filtro.texto} onChange=${cambia("texto")} />
          <label className="sr" htmlFor="pad-galeria">Galería</label>
          <select id="pad-galeria" className="input" value=${filtro.galeria} onChange=${cambia("galeria")}>
            <option value="">Todas las galerías</option>
            ${GALERIAS.map((g) => html`<option key=${g.id} value=${g.id}>${g.nombre}</option>`)}
          </select>
          <label className="sr" htmlFor="pad-censo">Estado del censo</label>
          <select id="pad-censo" className="input" value=${filtro.censo} onChange=${cambia("censo")}>
            <option value="">Todo estado de censo</option>
            ${Object.entries(ESTADOS_CENSO).map(([k, v]) => html`<option key=${k} value=${k}>${v.label}</option>`)}
          </select>
        </div>
        <div className="tabla-caja">
          <table className="tabla">
            <thead><tr><th>N°</th><th>Asociado</th><th>DNI</th><th>Stands</th><th>Galería</th><th>Censo</th><th>Pagos</th></tr></thead>
            <tbody>
              ${lista.map((a) => {
                const suyos = derivados.mapaStands.get(a.id) || [];
                const galerias = [...new Set(suyos.map((s) => nombreGaleria(s.galeria)))].join(", ");
                return html`
                  <tr key=${a.id} className="clic" onClick=${() => ir(`ficha-${a.id}`)}>
                    <td className="num muted">${a.numero}</td>
                    <td className="fuerte"><a href=${`#ficha-${a.id}`} onClick=${(e) => e.stopPropagation()} style=${{ color: "inherit" }}>${nombreCompleto(a)}</a></td>
                    <td className="num">${a.dni}</td>
                    <td className="num">${suyos.map((s) => s.codigo).join(", ") || "—"}</td>
                    <td>${galerias || "—"}</td>
                    <td><${BadgeCenso} estado=${a.censo?.estado || "pendiente"} /></td>
                    <td><${BadgeAtraso} meses=${derivados.atraso(a).meses} /></td>
                  </tr>`;
              })}
            </tbody>
          </table>
          ${!lista.length && html`<${Vacio}>Ningún asociado coincide con la búsqueda.<//>`}
        </div>
        <div className="tabla-pie"><span>Mostrando ${lista.length} de ${datos.asociados.length} asociados</span><span>Toca una fila para abrir la ficha</span></div>
      </section>
    </div>`;
}
