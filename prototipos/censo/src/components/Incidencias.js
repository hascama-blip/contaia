// Panel para registrar una incidencia o llamada de atención.
import { html, useState, useMemo } from "./html.js";
import { LISTAS } from "../config.js";
import { GRAVEDADES } from "../lib/types.js";
import { hoy } from "../lib/formato.js";
import { nombreCompleto, ordenarPorNumero } from "../lib/padron.js";
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
    tipo: "",
    gravedad: "leve",
    medida: "",
    estado: "abierta",
    detalle: "",
  });
  const [errores, setErrores] = useState({});
  const [ocupado, setOcupado] = useState(false);
  const cambia = (k) => (v) => setI((x) => ({ ...x, [k]: v }));

  const opcionesAsociado = useMemo(
    () => ordenarPorNumero(datos.asociados).map((a) => {
      const suyos = (derivados.mapaStands.get(a.id) || []).map((s) => s.codigo).join(", ");
      return [a.id, `${nombreCompleto(a)}${suyos ? ` · ${suyos}` : ""}`];
    }),
    [datos.asociados, derivados.mapaStands],
  );
  const standsDelAsociado = derivados.mapaStands.get(i.asociadoId) || [];

  async function guardar() {
    setOcupado(true);
    try {
      const a = derivados.porId.get(i.asociadoId);
      await registrarIncidencia(
        { ...i, stand: i.stand || standsDelAsociado[0]?.codigo || "", involucrado: i.involucrado || (a ? nombreCompleto(a) : "") },
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
      <${Campo} id="i-asociado" etiqueta="Asociado" req error=${errores.asociadoId}>
        <${Selector} id="i-asociado" valor=${i.asociadoId} onCambio=${cambia("asociadoId")} opciones=${opcionesAsociado} error=${errores.asociadoId} />
      <//>
      <div className="form-rejilla" style=${{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
        <${Campo} id="i-stand" etiqueta="Stand">
          <${Selector} id="i-stand" valor=${i.stand} onCambio=${cambia("stand")} vacio="El primero del asociado"
            opciones=${standsDelAsociado.map((s) => s.codigo)} />
        <//>
        <${Campo} id="i-fecha" etiqueta="Fecha" req error=${errores.fecha}>
          <${Entrada} id="i-fecha" valor=${i.fecha} onCambio=${cambia("fecha")} tipo="date" />
        <//>
      </div>
      <${Campo} id="i-involucrado" etiqueta="Persona involucrada" ayuda="Déjalo vacío si es el mismo asociado; escribe el nombre si fue el inquilino.">
        <${Entrada} id="i-involucrado" valor=${i.involucrado} onCambio=${cambia("involucrado")} />
      <//>
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
    <//>`;
}
