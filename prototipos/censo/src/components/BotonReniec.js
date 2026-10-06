// Botón "Buscar en RENIEC": consulta el DNI y entrega los datos para llenar la ficha.
import { html, useState } from "./html.js";
import { consultarDni, reniecActivo, fichaDesdeReniec, fotoComoArchivo } from "../lib/reniec.js";
import { mensajeError } from "./ui.js";
import { useApp } from "./contexto.js";

/**
 * @param {object} p
 * @param {string} p.dni
 * @param {(campos: object) => void} p.onDatos   recibe los campos ya listos para la ficha
 * @param {(foto: File) => Promise<void>} [p.onFoto]  recibe la foto del DNI (planes que la incluyen)
 * @param {boolean} [p.disabled]
 */
export function BotonReniec({ dni, onDatos, onFoto, disabled, accion, etiqueta = "Buscar en RENIEC", titulo = "Trae nombres y apellidos desde RENIEC" }) {
  const { avisar } = useApp();
  const [ocupado, setOcupado] = useState(false);
  if (!reniecActivo()) return null;
  async function buscar() {
    setOcupado(true);
    try {
      if (accion) { await accion(); return; } // la página decide qué hacer (p. ej. actualizar la ficha guardada)
      const { persona, simulado } = await consultarDni(dni);
      onDatos(fichaDesdeReniec(persona));
      const foto = onFoto ? fotoComoArchivo(persona) : null;
      if (foto) await onFoto(foto);
      avisar(simulado ? "Datos de PRUEBA (el servidor no tiene token de RENIEC)."
        : `RENIEC: ${persona.apellidoPaterno} ${persona.apellidoMaterno}, ${persona.nombres}.${foto ? " Foto del DNI guardada." : persona.fotoGenerica ? " RENIEC no tiene foto de esta persona." : ""}`, simulado ? "error" : "ok");
    } catch (e) {
      avisar(mensajeError(e), "error");
    } finally {
      setOcupado(false);
    }
  }
  return html`<button type="button" className="btn btn-ghost btn-sm" disabled=${disabled || ocupado || !/^\d{8}$/.test(String(dni || "").replace(/\D/g, ""))}
    onClick=${buscar} title=${titulo}>${ocupado ? "Consultando…" : etiqueta}</button>`;
}
