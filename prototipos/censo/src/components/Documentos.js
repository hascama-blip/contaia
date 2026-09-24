// Documentos del asociado (al pie de la ficha): subir varios a la vez, el nombre
// sale del archivo, orden alfabético, abrir, descargar, renombrar y quitar.
import { html, useState, useRef } from "./html.js";
import { Tarjeta, Vacio, mensajeError } from "./ui.js";
import { useApp } from "./contexto.js";
import { ordenarDocumentos, etiquetaTipo, esImagen, tamanoLegible, extension } from "../lib/documentos.js";
import { urlArchivo, archivoComoBlob } from "../lib/archivos.js";
import { descargar } from "../lib/exportar.js";
import { fecha } from "../lib/formato.js";
import { normalizar } from "../lib/padron.js";
import { subirDocumentos, renombrarDocumento, quitarDocumento } from "../api/documentos.js";

export function Documentos({ asociado }) {
  const { usuario, caps, avisar, puedeEscribir } = useApp();
  const entrada = useRef(null);
  const [arrastrando, setArrastrando] = useState(false);
  const [avance, setAvance] = useState(null); // [hechos, total, nombre]
  const [errores, setErrores] = useState([]);
  const [editando, setEditando] = useState(null); // { id, nombre, error }
  const [quitando, setQuitando] = useState(null); // id
  const [filtro, setFiltro] = useState("");
  const docs = asociado.documentos || [];
  const puedeSubir = caps.archivos && puedeEscribir !== false;
  const lista = ordenarDocumentos(docs).filter((d) => !filtro || normalizar(`${d.nombre} ${d.archivo}`).includes(normalizar(filtro)));

  async function subir(archivos) {
    if (!archivos?.length || avance) return;
    setErrores([]);
    try {
      const r = await subirDocumentos(asociado.id, archivos, docs, {
        por: usuario?.id,
        onAvance: (hechos, total, nombre) => setAvance([hechos, total, nombre]),
      });
      setErrores(r.errores);
      if (r.subidos) avisar(r.subidos === 1 ? "Documento guardado en la ficha." : `${r.subidos} documentos guardados en la ficha.`);
    } catch (e) {
      avisar(mensajeError(e), "error");
    } finally {
      setAvance(null);
      if (entrada.current) entrada.current.value = "";
    }
  }

  async function guardarNombre() {
    try {
      await renombrarDocumento(asociado.id, docs, editando.id, editando.nombre);
      setEditando(null);
      avisar("Nombre actualizado.");
    } catch (e) {
      setEditando((x) => ({ ...x, error: e.errores?.nombre || mensajeError(e) }));
    }
  }

  async function quitar(id) {
    try {
      await quitarDocumento(asociado.id, docs, id);
      avisar("Documento quitado de la ficha.");
    } catch (e) {
      avisar(mensajeError(e), "error");
    } finally {
      setQuitando(null);
    }
  }

  async function bajar(d) {
    try {
      const blob = await archivoComoBlob(d.id);
      const ext = extension(d.archivo).toLowerCase() || "pdf";
      await descargar(`${d.nombre}.${ext}`, blob);
    } catch (e) {
      if (e?.code !== "declined") avisar(mensajeError(e), "error");
    }
  }

  const soltar = (e) => {
    e.preventDefault();
    setArrastrando(false);
    if (puedeSubir) subir(e.dataTransfer.files);
  };

  return html`
    <${Tarjeta} titulo="Documentos del asociado"
      sub=${`${docs.length} ${docs.length === 1 ? "documento" : "documentos"} · el nombre se toma del archivo y se puede cambiar`}
      accion=${puedeSubir && html`<button className="btn btn-primary" disabled=${Boolean(avance)} onClick=${() => entrada.current?.click()}>
        ${avance ? `Subiendo ${avance[0]} de ${avance[1]}…` : "Subir documentos"}</button>`}>
      <input ref=${entrada} id=${`docs-${asociado.id}`} className="sr" type="file" multiple
        accept=".pdf,.jpg,.jpeg,.png,.webp,.gif,.txt,.csv,application/pdf,image/*"
        onChange=${(e) => subir(e.target.files)} />

      ${puedeSubir && html`
        <div className=${`zona-soltar${arrastrando ? " activa" : ""}`}
          onDragOver=${(e) => { e.preventDefault(); setArrastrando(true); }}
          onDragLeave=${() => setArrastrando(false)} onDrop=${soltar}
          onClick=${() => entrada.current?.click()} role="button" tabIndex="0"
          onKeyDown=${(e) => (e.key === "Enter" || e.key === " ") && entrada.current?.click()}>
          <strong>Arrastra aquí los archivos</strong> o haz clic para elegirlos.
          <span className="ayuda">PDF, fotos (JPG, PNG) o texto, hasta 20 MB cada uno. Ej.: "Contrato_compraventa_A-02.pdf" se guarda como "Contrato compraventa A-02".</span>
        </div>`}

      ${errores.length > 0 && html`<div className="aviso aviso-peligro" role="alert" style=${{ marginTop: 12 }}>
        <span>No se subieron:<br />${errores.map((t) => html`<span key=${t}>• ${t}<br /></span>`)}</span></div>`}

      ${docs.length > 6 && html`
        <div style=${{ marginTop: 14 }}>
          <label className="sr" htmlFor=${`docs-f-${asociado.id}`}>Buscar documento</label>
          <input id=${`docs-f-${asociado.id}`} className="input" type="search" placeholder="Buscar documento por nombre" value=${filtro} onChange=${(e) => setFiltro(e.target.value)} />
        </div>`}

      ${!docs.length && html`<${Vacio}>Aún no hay documentos. Sube contratos, constancias, recibos o la foto del DNI.<//>`}
      <ul className="docs">
        ${lista.map((d) => html`
          <li key=${d.id} className="doc">
            <a className="doc-mini" href=${urlArchivo(d.id)} target="_blank" rel="noopener" aria-label=${`Abrir ${d.nombre}`}>
              ${esImagen(d) ? html`<img src=${urlArchivo(d.id)} alt="" loading="lazy" />` : html`<span>${etiquetaTipo(d)}</span>`}
            </a>
            <div className="doc-info">
              ${editando?.id === d.id
                ? html`<div style=${{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <label className="sr" htmlFor=${`ren-${d.id}`}>Nombre del documento</label>
                    <input id=${`ren-${d.id}`} className="input" style=${{ flex: "1 1 220px", minHeight: 34, padding: "5px 9px" }} value=${editando.nombre} autoFocus
                      onChange=${(e) => setEditando((x) => ({ ...x, nombre: e.target.value, error: "" }))}
                      onKeyDown=${(e) => { if (e.key === "Enter") guardarNombre(); if (e.key === "Escape") setEditando(null); }} />
                    <button className="btn btn-primary btn-sm" onClick=${guardarNombre}>Guardar</button>
                    <button className="btn btn-ghost btn-sm" onClick=${() => setEditando(null)}>Cancelar</button>
                  </div>
                  ${editando.error && html`<span className="error-campo">${editando.error}</span>`}`
                : html`<span className="doc-nombre">${d.nombre}</span>`}
              <span className="doc-meta">${etiquetaTipo(d)} · ${tamanoLegible(d.tamano)} · subido el ${fecha(d.subidoAt)}${d.archivo && d.archivo !== d.nombre ? ` · ${d.archivo}` : ""}</span>
            </div>
            ${quitando === d.id
              ? html`<div className="doc-acciones">
                  <span className="ayuda">¿Quitar y borrar el archivo?</span>
                  <button className="btn btn-peligro btn-sm" onClick=${() => quitar(d.id)}>Sí, quitar</button>
                  <button className="btn btn-ghost btn-sm" onClick=${() => setQuitando(null)}>No</button>
                </div>`
              : html`<div className="doc-acciones">
                  <a className="btn btn-ghost btn-sm" href=${urlArchivo(d.id)} target="_blank" rel="noopener">Abrir</a>
                  ${caps.descargas && html`<button className="btn btn-ghost btn-sm" onClick=${() => bajar(d)}>Descargar</button>`}
                  ${puedeSubir && editando?.id !== d.id && html`
                    <button className="btn btn-ghost btn-sm" onClick=${() => setEditando({ id: d.id, nombre: d.nombre, error: "" })}>Renombrar</button>
                    <button className="btn btn-ghost btn-sm" onClick=${() => setQuitando(d.id)}>Quitar</button>`}
                </div>`}
          </li>`)}
      </ul>
      ${filtro && !lista.length && html`<${Vacio}>Ningún documento coincide con "${filtro}".<//>`}
    <//>`;
}
