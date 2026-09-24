// Panel para registrar una incidencia o llamada de atención.
import { html, useState, useMemo } from "./html.js";
import { Buscador, opcionesAsociados } from "./Buscador.js";
import { LISTAS } from "../config.js";
import { GRAVEDADES } from "../lib/types.js";
import { hoy } from "../lib/formato.js";
import { nombreCompleto } from "../lib/padron.js";
import { Campo, Entrada, Selector, Texto, Panel, mensajeError } from "./ui.js";
import { registrarIncidencia } from "../api/incidencias.js";
import { useApp } from "./contexto.js";

export function PanelIncidencia({ inicial, onCerrar }) {
  const { datos, derivados, usuario, avisar } = useApp();
  const [i, setI] = useState({
    fecha: hoy().iso,
    asociadoId: inicial?.asociadoId || "",
    stand: inicial?.stand || "",
    involucrado: "",
    responsable: "propietario",
    tipo: "",
    gravedad: "leve",
    medida: "",
    estado: "abierta",
    detalle: "",
  });
  const [errores, setErrores] = useState({});
  const [ocupado, setOcupado] = useState(false);
  const cambia = (k) => (v) => setI((x) => ({ ...x, [k]: v }));

  const opcionesAsociado = useMemo(() => opcionesAsociados(datos.asociados, derivados.mapaStands), [datos.asociados, derivados.mapaStands]);
  const standsDelAsociado = derivados.mapaStands.get(i.asociadoId) || [];
  const standElegido = standsDelAsociado.find((s) => s.codigo === i.stand) || standsDelAsociado[0];
  const inquilino = standElegido?.inquilino?.nombre ? standElegido.inquilino : null;
  const asociado = derivados.porId.get(i.asociadoId);

  // Propietario o inquilino: al elegir inquilino se escribe su nombre si está registrado.
  const elegirResponsable = (r) => setI((x) => ({
    ...x,
    responsable: r,
    involucrado: r === "inquilino" ? (inquilino ? `${inquilino.nombre} (inquilino)` : "") : "",
  }));

  async function guardar() {
    setOcupado(true);
    try {
      const a = derivados.porId.get(i.asociadoId);
      await registrarIncidencia(
        { ...i, stand: i.stand || standsDelAsociado[0]?.codigo || "", involucrado: i.involucrado || (i.responsable === "propietario" && a ? nombreCompleto(a) : "") },
        { por: usuario?.id },
      );
      avisar("Incidencia registrada.");
      onCerrar();
    } catch (e) {
      setErrores(e.errores || {});
      avisar(mensajeError(e), "error");
    } finally {
      setOcupado(false);
    }
  }

  return html`
    <${Panel} titulo="Registrar incidencia" onCerrar=${onCerrar}
      pie=${html`
        <button className="btn btn-ghost" onClick=${onCerrar}>Cancelar</button>
        <button className="btn btn-primary" disabled=${ocupado} onClick=${guardar}>${ocupado ? "Guardando…" : "Registrar"}</button>`}>
      <${Campo} id="i-asociado" etiqueta="Asociado" req error=${errores.asociadoId} ayuda="Escribe el DNI, el nombre, el N° de asociado o el stand.">
        <${Buscador} id="i-asociado" opciones=${opcionesAsociado} valor=${i.asociadoId} error=${errores.asociadoId}
          placeholder="Buscar por DNI, nombre o stand" onElegir=${(v) => setI((x) => ({ ...x, asociadoId: v, stand: "", responsable: "propietario", involucrado: "" }))} />
      <//>
      <div className="form-rejilla" style=${{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
        <${Campo} id="i-stand" etiqueta="Stand">
          <${Selector} id="i-stand" valor=${i.stand} onCambio=${(v) => setI((x) => ({ ...x, stand: v, responsable: "propietario", involucrado: "" }))} vacio="El primero del asociado"
            opciones=${standsDelAsociado.map((s) => s.codigo)} />
        <//>
        <${Campo} id="i-fecha" etiqueta="Fecha" req error=${errores.fecha}>
          <${Entrada} id="i-fecha" valor=${i.fecha} onCambio=${cambia("fecha")} tipo="date" />
        <//>
      </div>
      ${standElegido && html`
        <div className=${`aviso ${inquilino ? "aviso-alerta" : "aviso-info"}`}>
          <span>${inquilino
            ? html`Stand <strong>${standElegido.codigo}</strong> alquilado a <strong>${inquilino.nombre}</strong>${inquilino.dni ? ` (DNI ${inquilino.dni})` : ""}.`
            : html`Stand <strong>${standElegido.codigo}</strong> ocupado por su propietario; no tiene inquilino registrado.`}</span>
        </div>`}
      <div className="campo">
        <span className="label">¿Quién cometió la incidencia? <span className="req" aria-hidden="true">*</span></span>
        <div className="segmentos en-linea" role="group" aria-label="Quién cometió la incidencia">
          <button type="button" aria-pressed=${i.responsable === "propietario"} onClick=${() => elegirResponsable("propietario")}>Propietario</button>
          <button type="button" aria-pressed=${i.responsable === "inquilino"} onClick=${() => elegirResponsable("inquilino")}>Inquilino</button>
        </div>
      </div>
      ${i.responsable === "propietario"
        ? html`<p className="ayuda" style=${{ marginTop: -6 }}>Se registra a nombre de ${asociado ? nombreCompleto(asociado) : "el asociado elegido"}.</p>`
        : html`<${Campo} id="i-involucrado" etiqueta="Nombre del inquilino" req error=${errores.involucrado}
            ayuda=${inquilino ? "Tomado del registro del stand; corrígelo si fue otra persona." : "El stand no tiene inquilino registrado: escribe su nombre."}>
            <${Entrada} id="i-involucrado" valor=${i.involucrado} onCambio=${cambia("involucrado")} error=${errores.involucrado} />
          <//>`}
      <div className="form-rejilla" style=${{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
        <${Campo} id="i-tipo" etiqueta="Tipo" req error=${errores.tipo}>
          <${Selector} id="i-tipo" valor=${i.tipo} onCambio=${cambia("tipo")} opciones=${LISTAS.tiposIncidencia} error=${errores.tipo} />
        <//>
        <${Campo} id="i-gravedad" etiqueta="Gravedad" req>
          <${Selector} id="i-gravedad" valor=${i.gravedad} onCambio=${cambia("gravedad")} vacio=${null}
            opciones=${Object.entries(GRAVEDADES).map(([k, v]) => [k, v.label])} />
        <//>
      </div>
      <${Campo} id="i-medida" etiqueta="Medida adoptada" req error=${errores.medida}>
        <${Selector} id="i-medida" valor=${i.medida} onCambio=${cambia("medida")} opciones=${LISTAS.medidas} error=${errores.medida} />
      <//>
      <${Campo} id="i-detalle" etiqueta="Detalle de los hechos">
        <${Texto} id="i-detalle" valor=${i.detalle} onCambio=${cambia("detalle")} rows="4" />
      <//>
      <p className="ayuda">Quedará registrado por <strong>${usuario?.nombre || "tu usuario"}</strong>, con fecha y hora.</p>
    <//>`;
}
