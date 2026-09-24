// Stands e inquilinos: inventario por galería.
import { html, useState, useMemo } from "../components/html.js";
import { CabPagina, Kpi, BadgeStand, Vacio, Panel, Campo, Entrada, Selector, mensajeError } from "../components/ui.js";
import { useApp } from "../components/contexto.js";
import { GALERIAS } from "../config.js";
import { ESTADOS_STAND } from "../lib/types.js";
import { compararCodigos, nombreCompleto, nombreCorto, nombreGaleria, normalizar } from "../lib/padron.js";
import { editarStand } from "../api/stands.js";
import { PanelTraspaso, HistorialPropietarios } from "../components/Traspaso.js";

function PanelStand({ stand, onCerrar, onTraspaso }) {
  const { avisar } = useApp();
  const [s, setS] = useState({
    giro: stand.giro || "",
    area: stand.area ?? "",
    estado: stand.estado || "propietario",
    inquilino: { nombre: "", dni: "", celular: "", ...(stand.inquilino || {}) },
  });
  const [errores, setErrores] = useState({});
  const [ocupado, setOcupado] = useState(false);
  const cambia = (k) => (v) => setS((x) => ({ ...x, [k]: v }));
  const cambiaInq = (k) => (v) => setS((x) => ({ ...x, inquilino: { ...x.inquilino, [k]: v } }));

  async function guardar() {
    setOcupado(true);
    try {
      await editarStand(stand.codigo, s);
      avisar(`Stand ${stand.codigo} actualizado.`);
      onCerrar();
    } catch (e) {
      setErrores(e.errores || {});
      avisar(mensajeError(e), "error");
    } finally {
      setOcupado(false);
    }
  }
  const conInquilino = s.estado === "alquilado" || s.estado === "litigio";
  return html`
    <${Panel} titulo=${`Stand ${stand.codigo}`} onCerrar=${onCerrar}
      pie=${html`<button className="btn btn-ghost" onClick=${onCerrar}>Cancelar</button>
        <button className="btn btn-primary" disabled=${ocupado} onClick=${guardar}>${ocupado ? "Guardando…" : "Guardar"}</button>`}>
      <p className="muted">${nombreGaleria(stand.galeria)}</p>
      <div className="form-rejilla" style=${{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
        <${Campo} id="st-giro" etiqueta="Giro comercial"><${Entrada} id="st-giro" valor=${s.giro} onCambio=${cambia("giro")} /><//>
        <${Campo} id="st-area" etiqueta="Área (m²)" error=${errores.area}><${Entrada} id="st-area" valor=${s.area} onCambio=${cambia("area")} inputMode="decimal" error=${errores.area} /><//>
      </div>
      <${Campo} id="st-estado" etiqueta="Estado del stand">
        <${Selector} id="st-estado" valor=${s.estado} onCambio=${cambia("estado")} vacio=${null} opciones=${Object.entries(ESTADOS_STAND).map(([k, v]) => [k, v.label])} />
      <//>
      ${conInquilino && html`
        <${Campo} id="st-inq" etiqueta="Inquilino actual" error=${errores.inquilino}><${Entrada} id="st-inq" valor=${s.inquilino.nombre} onCambio=${cambiaInq("nombre")} placeholder="Apellidos, nombres" error=${errores.inquilino} /><//>
        <div className="form-rejilla" style=${{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
          <${Campo} id="st-inq-dni" etiqueta="DNI del inquilino"><${Entrada} id="st-inq-dni" valor=${s.inquilino.dni} onCambio=${cambiaInq("dni")} inputMode="numeric" maxLength="8" /><//>
          <${Campo} id="st-inq-cel" etiqueta="Celular"><${Entrada} id="st-inq-cel" valor=${s.inquilino.celular} onCambio=${cambiaInq("celular")} tipo="tel" /><//>
        </div>`}
      <div className="seccion-form">
        <div className="historial-cab">
          <h3>Propietarios del stand</h3>
          <button type="button" className="btn btn-ghost btn-sm" onClick=${onTraspaso}>Registrar venta o traspaso</button>
        </div>
        <${HistorialPropietarios} stand=${stand} compacto />
      </div>
    <//>`;
}

export function Stands() {
  const { datos, derivados, puedeEscribir } = useApp();
  const [filtro, setFiltro] = useState({ texto: "", galeria: "", estado: "" });
  const [editando, setEditando] = useState(null);
  const [traspaso, setTraspaso] = useState(null);
  const conteo = useMemo(() => {
    const c = { propietario: 0, alquilado: 0, cerrado: 0, litigio: 0 };
    for (const s of datos.stands) c[s.estado] = (c[s.estado] || 0) + 1;
    return c;
  }, [datos.stands]);
  const lista = useMemo(() => {
    const q = normalizar(filtro.texto);
    return datos.stands
      .filter((s) => (!filtro.galeria || s.galeria === filtro.galeria) && (!filtro.estado || s.estado === filtro.estado))
      .filter((s) => !q || normalizar([s.codigo, s.giro, s.inquilino?.nombre, nombreCompleto(derivados.porId.get(s.propietarioId))].join(" ")).includes(q))
      .sort((a, b) => compararCodigos(a.codigo, b.codigo));
  }, [datos.stands, filtro, derivados.porId]);
  const cambia = (k) => (e) => setFiltro((f) => ({ ...f, [k]: e.target.value }));

  return html`
    <div className="pagina">
      <${CabPagina} miga=${{ href: "#inicio", texto: "Inicio" }} titulo="Stands e inquilinos" sub="Inventario por galería" />
      <div className="rejilla r-4">
        <${Kpi} etiqueta="Total de stands" valor=${datos.stands.length} />
        <${Kpi} etiqueta="Ocupados por el propietario" valor=${conteo.propietario} />
        <${Kpi} etiqueta="Alquilados" valor=${conteo.alquilado} />
        <${Kpi} etiqueta="Cerrados o en litigio" valor=${conteo.cerrado + conteo.litigio} tono=${conteo.litigio ? "peligro" : ""} nota=${`${conteo.litigio} en litigio`} />
      </div>
      <section className="card">
        <div className="filtros">
          <label className="sr" htmlFor="st-buscar">Buscar</label>
          <input id="st-buscar" className="input buscar" type="search" placeholder="Buscar por stand, giro, propietario o inquilino" value=${filtro.texto} onChange=${cambia("texto")} />
          <label className="sr" htmlFor="st-galeria">Galería</label>
          <select id="st-galeria" className="input" value=${filtro.galeria} onChange=${cambia("galeria")}>
            <option value="">Todas las galerías</option>
            ${GALERIAS.map((g) => html`<option key=${g.id} value=${g.id}>${g.nombre}</option>`)}
          </select>
          <label className="sr" htmlFor="st-estado-f">Estado</label>
          <select id="st-estado-f" className="input" value=${filtro.estado} onChange=${cambia("estado")}>
            <option value="">Todo estado</option>
            ${Object.entries(ESTADOS_STAND).map(([k, v]) => html`<option key=${k} value=${k}>${v.label}</option>`)}
          </select>
        </div>
        <div className="tabla-caja">
          <table className="tabla">
            <thead><tr><th>Stand</th><th>Galería</th><th className="der">Área</th><th>Giro comercial</th><th>Propietario</th><th>Inquilino actual</th><th>Estado</th></tr></thead>
            <tbody>
              ${lista.map((s) => {
                const dueno = derivados.porId.get(s.propietarioId);
                const anterior = s.historial?.[s.historial.length - 1];
                return html`<tr key=${s.codigo} className=${puedeEscribir !== false ? "clic" : ""} onClick=${() => puedeEscribir !== false && setEditando(s)}>
                  <td className="fuerte num">${s.codigo}</td>
                  <td>${nombreGaleria(s.galeria)}</td>
                  <td className="der num">${s.area ? `${s.area} m²` : "—"}</td>
                  <td>${s.giro || "—"}</td>
                  <td>
                    ${dueno ? html`<a href=${`#ficha-${dueno.id}`} onClick=${(e) => e.stopPropagation()}>${nombreCorto(dueno)}</a>` : html`<span className="muted">Sin propietario</span>`}
                    ${anterior && html`<span className="celda-sub">Antes: ${anterior.nombre}</span>`}
                  </td>
                  <td>${s.inquilino?.nombre || "—"}</td>
                  <td><${BadgeStand} estado=${s.estado} /></td>
                </tr>`;
              })}
            </tbody>
          </table>
          ${!lista.length && html`<${Vacio}>Ningún stand coincide con el filtro.<//>`}
        </div>
        <div className="tabla-pie"><span>${lista.length} de ${datos.stands.length} stands</span>${puedeEscribir !== false && html`<span>Toca un stand para editar giro, inquilino o registrar su venta</span>`}</div>
      </section>
      ${editando && html`<${PanelStand} stand=${editando} onCerrar=${() => setEditando(null)}
        onTraspaso=${() => { setTraspaso(editando); setEditando(null); }} />`}
      ${traspaso && html`<${PanelTraspaso} stand=${traspaso} onCerrar=${() => setTraspaso(null)} />`}
    </div>`;
}
