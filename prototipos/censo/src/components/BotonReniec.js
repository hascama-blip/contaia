// Botón "Buscar en RENIEC": consulta el DNI y entrega los datos para llenar la ficha.
import { html, useState } from "./html.js";
import { consultarDni, reniecActivo, fichaDesdeReniec } from "../lib/reniec.js";
import { mensajeError } from "./ui.js";
import { useApp } from "./contexto.js";

/**
 * @param {object} p
 * @param {string} p.dni
 * @param {(campos: object) => void} p.onDatos   recibe los campos ya listos para la ficha
 * @param {boolean} [p.disabled]
 */
export function BotonReniec({ dni, onDatos, disabled }) {
  const { avisar } = useApp();
  const [ocupado, setOcupado] = useState(false);
  if (!reniecActivo()) return null;
  async function buscar() {
    setOcupado(true);
    try {
      const { persona, simulado } = await consultarDni(dni);
      onDatos(fichaDesdeReniec(persona));
      avisar(simulado ? "Datos de PRUEBA (el servidor no tiene token de RENIEC)." : `RENIEC: ${persona.apellidoPaterno} ${persona.apellidoMaterno}, ${persona.nombres}.`, simulado ? "error" : "ok");
    } catch (e) {
      avisar(mensajeError(e), "error");
    } finally {
      setOcupado(false);
    }
  }
  return html`<button type="button" className="btn btn-ghost btn-sm" disabled=${disabled || ocupado || !/^\d{8}$/.test(String(dni || "").replace(/\D/g, ""))}
    onClick=${buscar} title="Trae nombres y apellidos desde RENIEC">${ocupado ? "Buscando…" : "Buscar en RENIEC"}</button>`;
}
