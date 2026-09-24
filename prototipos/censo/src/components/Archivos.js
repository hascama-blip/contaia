// Foto carné, huella, foto del DNI y firma en pantalla.
// Reciben el id guardado y una función que sube el archivo (la decide la página).
import { html, useState, useRef, useEffect } from "./html.js";
import { urlArchivo } from "../lib/archivos.js";
import { mensajeError } from "./ui.js";

function useSubida(onArchivo) {
  const [estado, setEstado] = useState({ ocupado: false, error: "", vistaPrevia: null });
  async function subir(archivo) {
    if (!archivo) return;
    setEstado({ ocupado: true, error: "", vistaPrevia: URL.createObjectURL(archivo) });
    try {
      await onArchivo(archivo);
      setEstado((s) => ({ ...s, ocupado: false }));
    } catch (e) {
      setEstado({ ocupado: false, error: mensajeError(e), vistaPrevia: null });
    }
  }
  return [estado, subir];
}

/** Foto tipo carné: en el celular, el botón abre la cámara. */
export function FotoCampo({ id, valorId, onArchivo, habilitado = true }) {
  const [estado, subir] = useSubida(onArchivo);
  const src = estado.vistaPrevia || urlArchivo(valorId);
  return html`
    <div className="campo">
      <span className="label">Fotografía tipo carné</span>
      <div className="foto-caja">${src ? html`<img src=${src} alt="Foto del asociado" />` : "Sin foto"}</div>
      ${habilitado && html`
        <label className="btn btn-ghost" htmlFor=${id} style=${{ cursor: "pointer" }}>
          ${estado.ocupado ? "Subiendo…" : src ? "Cambiar foto" : "Tomar o subir foto"}
        </label>
        <input id=${id} className="sr" type="file" accept="image/*" capture="user"
          onChange=${(e) => subir(e.target.files?.[0])} />`}
      ${estado.error ? html`<span className="error-campo">${estado.error}</span>` : html`<span className="ayuda">De frente, fondo claro y buena luz.</span>`}
    </div>`;
}

/** Huella o foto del DNI (imagen o PDF). */
export function ArchivoCampo({ id, etiqueta, valorId, onArchivo, habilitado = true, textoBoton = "Subir" }) {
  const [estado, subir] = useSubida(onArchivo);
  const src = estado.vistaPrevia || urlArchivo(valorId);
  return html`
    <div className="campo">
      <span className="label">${etiqueta}</span>
      <div className="archivo-caja">${src ? html`<img src=${src} alt=${etiqueta} />` : "Sin archivo"}</div>
      ${habilitado && html`
        <label className="btn btn-ghost" htmlFor=${id} style=${{ cursor: "pointer" }}>${estado.ocupado ? "Subiendo…" : textoBoton}</label>
        <input id=${id} className="sr" type="file" accept="image/*"
          onChange=${(e) => subir(e.target.files?.[0])} />`}
      ${estado.error && html`<span className="error-campo">${estado.error}</span>`}
    </div>`;
}

/** Firma con el dedo o el mouse sobre la pantalla. */
export function FirmaCampo({ valorId, onArchivo, habilitado = true }) {
  const lienzo = useRef(null);
  const trazando = useRef(false);
  const [firmando, setFirmando] = useState(false);
  const [hayTrazo, setHayTrazo] = useState(false);
  const [estado, subir] = useSubida(onArchivo);

  useEffect(() => {
    if (!firmando) return;
    const c = lienzo.current;
    const escala = window.devicePixelRatio || 1;
    c.width = c.clientWidth * escala;
    c.height = c.clientHeight * escala;
    const ctx = c.getContext("2d");
    ctx.scale(escala, escala);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.clientWidth, c.clientHeight);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#053f17";
  }, [firmando]);

  const punto = (e) => {
    const r = lienzo.current.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const bajar = (e) => {
    e.preventDefault();
    lienzo.current.setPointerCapture(e.pointerId);
    trazando.current = true;
    const ctx = lienzo.current.getContext("2d");
    ctx.beginPath();
    ctx.moveTo(...punto(e));
  };
  const mover = (e) => {
    if (!trazando.current) return;
    const ctx = lienzo.current.getContext("2d");
    ctx.lineTo(...punto(e));
    ctx.stroke();
    setHayTrazo(true);
  };
  const subirTrazo = () => (trazando.current = false);

  async function guardar() {
    const blob = await new Promise((ok) => lienzo.current.toBlob(ok, "image/png"));
    await subir(new File([blob], "firma.png", { type: "image/png" }));
    setFirmando(false);
    setHayTrazo(false);
  }

  const src = estado.vistaPrevia || urlArchivo(valorId);
  return html`
    <div className="campo">
      <span className="label">Firma del asociado</span>
      ${firmando
        ? html`
          <canvas ref=${lienzo} className="firma-lienzo" aria-label="Área para firmar"
            onPointerDown=${bajar} onPointerMove=${mover} onPointerUp=${subirTrazo} onPointerLeave=${subirTrazo}></canvas>
          <div className="acciones">
            <button type="button" className="btn btn-primary" disabled=${!hayTrazo || estado.ocupado} onClick=${guardar}>${estado.ocupado ? "Guardando…" : "Guardar firma"}</button>
            <button type="button" className="btn btn-ghost" onClick=${() => { setFirmando(false); setHayTrazo(false); }}>Cancelar</button>
          </div>`
        : html`
          <div className="archivo-caja">${src ? html`<img src=${src} alt="Firma del asociado" />` : "Sin firma"}</div>
          ${habilitado && html`<button type="button" className="btn btn-ghost" onClick=${() => setFirmando(true)}>${src ? "Volver a firmar" : "Firmar en la pantalla"}</button>`}`}
      ${estado.error && html`<span className="error-campo">${estado.error}</span>`}
    </div>`;
}
