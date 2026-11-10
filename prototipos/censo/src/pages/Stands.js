// Stands e inquilinos: inventario por galería.
import { html, useState, useMemo } from "../components/html.js";
import { CabPagina, Kpi, BadgeStand, Badge, Vacio, Panel, Campo, Entrada, Selector, mensajeError } from "../components/ui.js";
import { useApp } from "../components/contexto.js";
import { GALERIAS } from "../config.js";
import { ESTADOS_STAND } from "../lib/types.js";
import { compararCodigos, nombreCompleto, nombreCorto, nombreGaleria, normalizar, esDeAsociacion, etiquetaNumero, fichaDeAsociacion, nombreEnAsociacion } from "../lib/padron.js";
import { editarStand, marcarStandsAsociacion, quitarDeAsociacion } from "../api/stands.js";
import { PanelTraspaso, HistorialPropietarios } from "../components/Traspaso.js";
import { PanelStandsAsociacion } from "../components/StandsAsociacion.js";

function PanelStand({ stand, onCerrar, onTraspaso }) {
  const { avisar, datos, derivados, usuario } = useApp();
  const eraAsoc = esDeAsociacion(stand);
  const [asoc, setAsoc] = useState(eraAsoc);
  const [nota, setNota] = useState(stand.asociacionNota || "");
  const dueno = derivados.porId.get(stand.propietarioId);
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
      await editarStand(stand.codigo, { ...s, ...(asoc && eraAsoc ? { asociacionNota: nota } : {}) });
      if (asoc && !eraAsoc) {
        const r = await marcarStandsAsociacion([{ codigo: stand.codigo, nota }], { asociados: datos.asociados, por: usuario?.id });
        if (r.errores.length) throw new Error(r.errores[0]);
      } else if (!asoc && eraAsoc) await quitarDeAsociacion(stand.codigo);
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
        <label className="check"><input type="checkbox" checked=${asoc} onChange=${(e) => setAsoc(e.target.checked)} /> Stand de la asociación (no tiene a un asociado como dueño)</label>
        ${asoc && html`<${Campo} id="st-asoc-nota" etiqueta="Cómo figura en el libro (opcional)"><${Entrada} id="st-asoc-nota" valor=${nota} onCambio=${setNota} placeholder="APCCIC-…" /><//>`}
        ${asoc && !eraAsoc && dueno && html`<div className="aviso aviso-alerta"><span>Figura a nombre de <strong>${nombreCompleto(dueno)}</strong> (${etiquetaNumero(dueno)}). Al guardar pasa al historial del stand (no se borra) y su ficha queda «por revisar».</span></div>`}
      </div>
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
  const { datos, derivados, puedeEscribir, usuario } = useApp();
  const [filtro, setFiltro] = useState({ texto: "", galeria: "", estado: "" });
  const [editando, setEditando] = useState(null);
  const [panelAsoc, setPanelAsoc] = useState(false);
  const deLaAsociacion = useMemo(() => datos.stands.filter(esDeAsociacion).length, [datos.stands]);
  const [traspaso, setTraspaso] = useState(null);
  const conteo = useMemo(() => {
    const c = { propietario: 0, alquilado: 0, cerrado: 0, litigio: 0 };
    for (const s of datos.stands) c[s.estado] = (c[s.estado] || 0) + 1;
    return c;
  }, [datos.stands]);
  const lista = useMemo(() => {
    const q = normalizar(filtro.texto);
    return datos.stands
      .filter((s) => (!filtro.galeria || s.galeria === filtro.galeria) && (!filtro.estado || (filtro.estado === "asociacion" ? esDeAsociacion(s) : s.estado === filtro.estado)))
      .filter((s) => !q || normalizar([s.codigo, s.giro, s.inquilino?.nombre, nombreCompleto(derivados.porId.get(s.propietarioId)), esDeAsociacion(s) ? `asociacion ${nombreEnAsociacion(s, fichaDeAsociacion(s, derivados.porId, derivados.indiceNombres))}` : ""].join(" ")).includes(q))
      .sort((a, b) => compararCodigos(a.codigo, b.codigo));
  }, [datos.stands, filtro, derivados.porId, derivados.indiceNombres]);
  const cambia = (k) => (e) => setFiltro((f) => ({ ...f, [k]: e.target.value }));

  return html`
    <div className="pagina">
      <${CabPagina} miga=${{ href: "#inicio", texto: "Inicio" }} titulo="Stands e inquilinos" sub=${`Inventario por galería${deLaAsociacion ? ` · ${deLaAsociacion} stands de la asociación` : ""}`}
        acciones=${usuario?.esAdminGeneral && puedeEscribir !== false && html`<button className="btn btn-ghost" onClick=${() => setPanelAsoc(true)}>Stands de la asociación…</button>`} />
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
            <option value="asociacion">Stands de la asociación</option>
          </select>
        </div>
        <div className="tabla-caja">
          <table className="tabla">
            <thead><tr><th>Stand</th><th>Galería</th><th className="der">Área</th><th>Giro comercial</th><th>Propietario</th><th>Inquilino actual</th><th>Estado</th></tr></thead>
            <tbody>
              ${lista.map((s) => {
                const dueno = derivados.porId.get(s.propietarioId);
                const anterior = s.historial?.[s.historial.length - 1];
                const persona = fichaDeAsociacion(s, derivados.porId, derivados.indiceNombres); // solo en stands de la asociación
                const apccic = esDeAsociacion(s) ? nombreEnAsociacion(s, persona) : "";
                return html`<tr key=${s.codigo} className=${puedeEscribir !== false ? "clic" : ""} onClick=${() => puedeEscribir !== false && setEditando(s)}>
                  <td className="fuerte num">${s.codigo}</td>
                  <td>${nombreGaleria(s.galeria)}</td>
                  <td className="der num">${s.area ? `${s.area} m²` : "—"}</td>
                  <td>${s.giro || "—"}</td>
                  <td>
                    ${dueno ? html`<a href=${`#ficha-${dueno.id}`} onClick=${(e) => e.stopPropagation()}>${nombreCorto(dueno)}</a>`
                      : esDeAsociacion(s) ? html`<${Badge} tono="asoc">Asociación<//>${apccic ? html`<span className="celda-sub">${persona ? html`<a href=${`#ficha-${persona.id}`} onClick=${(e) => e.stopPropagation()}>${apccic}</a>` : apccic}</span>` : ""}`
                      : html`<span className="muted">Sin propietario</span>`}
                    ${anterior && !(persona && anterior.asociadoId === persona.id) && html`<span className="celda-sub">Antes: ${anterior.nombre}</span>`}
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
      ${panelAsoc && html`<${PanelStandsAsociacion} onCerrar=${() => setPanelAsoc(false)} />`}
    </div>`;
}
