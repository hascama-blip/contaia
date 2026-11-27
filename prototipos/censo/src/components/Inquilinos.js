// Inquilinos del centro comercial: quienes ocupan un stand sin ser su dueño. Salen de los stands
// (stand.inquilino). Los de los stands de la Asociación figuran con el prefijo "APCCIC-", como en el libro.
import { html, useState, useMemo } from "./html.js";
import { Badge, BadgeStand, Vacio } from "./ui.js";
import { useApp } from "./contexto.js";
import { GALERIAS } from "../config.js";
import { normalizar, nombreGaleria, nombreCorto, esDeAsociacion } from "../lib/padron.js";

/**
 * @param {{ inquilinos: {stand, nombre, dni, celular, ficha}[], onAbrir?: (stand) => void, onLista?: (lista) => void }} p
 *   onAbrir: abrir el stand para completar o corregir los datos del inquilino (solo quien puede editar).
 *   onLista: avisa qué filas quedaron tras el filtro (para exportar lo que se ve).
 */
export function TablaInquilinos({ inquilinos, onAbrir, onLista }) {
  const { derivados } = useApp();
  const [filtro, setFiltro] = useState({ texto: "", galeria: "", tipo: "" });
  const cambia = (k) => (e) => setFiltro((f) => ({ ...f, [k]: e.target.value }));
  const deAsociacion = useMemo(() => inquilinos.filter((i) => esDeAsociacion(i.stand)).length, [inquilinos]);
  const lista = useMemo(() => {
    const q = normalizar(filtro.texto);
    const r = inquilinos
      .filter((i) => (!filtro.galeria || i.stand.galeria === filtro.galeria)
        && (!filtro.tipo || (filtro.tipo === "asociacion") === esDeAsociacion(i.stand)))
      .filter((i) => !q || normalizar(`${i.nombre} ${i.dni} ${i.celular} ${i.stand.codigo} ${i.stand.giro || ""}`).includes(q));
    onLista?.(r);
    return r;
  }, [inquilinos, filtro, onLista]);
  const sinDni = lista.filter((i) => !i.dni).length;

  return html`
    <div className="filtros">
      <label className="sr" htmlFor="inq-buscar">Buscar</label>
      <input id="inq-buscar" className="input buscar" type="search" placeholder="Buscar por nombre, DNI, celular o stand" value=${filtro.texto} onChange=${cambia("texto")} />
      <label className="sr" htmlFor="inq-galeria">Galería</label>
      <select id="inq-galeria" className="input" value=${filtro.galeria} onChange=${cambia("galeria")}>
        <option value="">Todas las galerías</option>
        ${GALERIAS.map((g) => html`<option key=${g.id} value=${g.id}>${g.nombre}</option>`)}
      </select>
      <label className="sr" htmlFor="inq-tipo">De quién es el stand</label>
      <select id="inq-tipo" className="input" value=${filtro.tipo} onChange=${cambia("tipo")}>
        <option value="">Todos los inquilinos</option>
        <option value="asociacion">En stands de la asociación · ${deAsociacion}</option>
        <option value="asociado">En stands de asociados · ${inquilinos.length - deAsociacion}</option>
      </select>
    </div>
    <div className="tabla-caja">
      <table className="tabla">
        <thead><tr><th>Stand</th><th>Galería</th><th>Inquilino</th><th>DNI</th><th>Celular</th><th>Propietario del stand</th><th>Estado</th></tr></thead>
        <tbody>
          ${lista.map((i) => {
            const dueno = derivados.porId.get(i.stand.propietarioId);
            return html`<tr key=${i.stand.codigo} className=${onAbrir ? "clic" : ""} onClick=${() => onAbrir?.(i.stand)}>
              <td className="fuerte num">${i.stand.codigo}</td>
              <td>${nombreGaleria(i.stand.galeria)}</td>
              <td className="fuerte">${i.nombre}${i.ficha ? html`<span className="celda-sub"><a href=${`#ficha-${i.ficha.id}`} onClick=${(e) => e.stopPropagation()}>Ver su ficha de asociado</a></span>` : ""}</td>
              <td className="num">${i.dni || html`<span className="muted">Falta</span>`}</td>
              <td className="num">${i.celular || "—"}</td>
              <td>${dueno ? html`<a href=${`#ficha-${dueno.id}`} onClick=${(e) => e.stopPropagation()}>${nombreCorto(dueno)}</a>`
                : esDeAsociacion(i.stand) ? html`<${Badge} tono="asoc">Asociación<//>` : html`<span className="muted">Sin propietario</span>`}</td>
              <td><${BadgeStand} estado=${i.stand.estado} /></td>
            </tr>`;
          })}
        </tbody>
      </table>
      ${!lista.length && html`<${Vacio}>${inquilinos.length ? "Ningún inquilino coincide con la búsqueda." : "Aún no hay inquilinos registrados. Se anotan en Stands, al editar cada stand."}<//>`}
    </div>
    <div className="tabla-pie">
      <span>${lista.length} de ${inquilinos.length} inquilinos${sinDni ? ` · ${sinDni} sin DNI` : ""}</span>
      ${onAbrir && html`<span>Toca una fila para completar su DNI o celular</span>`}
    </div>`;
}
