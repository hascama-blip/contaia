// Venta o traspaso de un stand y línea de tiempo de sus propietarios.
// El propietario anterior nunca se borra: queda en el historial del stand.
import { html, useState, useMemo } from "./html.js";
import { Buscador, opcionesAsociados } from "./Buscador.js";
import { Badge, Campo, Entrada, Selector, Texto, Panel, mensajeError } from "./ui.js";
import { useApp } from "./contexto.js";
import { MOTIVOS_TRASPASO } from "../config.js";
import { hoy, fecha } from "../lib/formato.js";
import { nombreCompleto, nombreGaleria } from "../lib/padron.js";
import { cadenaPropietarios, ordinal } from "../lib/propietarios.js";
import { transferirStand } from "../api/stands.js";

/** Línea de tiempo: 1.er propietario → … → propietario actual. */
export function HistorialPropietarios({ stand, compacto = false }) {
  const { derivados } = useApp();
  const cadena = cadenaPropietarios(stand, derivados.porId);
  if (!cadena.length) return html`<p className="muted">Este stand aún no tiene propietario registrado.</p>`;
  return html`
    <ol className=${`linea-tiempo${compacto ? " compacta" : ""}`} aria-label=${`Propietarios del stand ${stand.codigo}`}>
      ${cadena.map((t) => html`
        <li key=${`${t.orden}-${t.asociadoId}`} className=${t.actual ? "actual" : ""}>
          <span className="lt-orden">${ordinal(t.orden)}</span>
          <div className="lt-cuerpo">
            <p className="lt-titulo">
              ${t.asociado ? html`<a href=${`#ficha-${t.asociado.id}`}>${t.nombre}</a>` : t.nombre}
              <${Badge} tono=${t.actual ? "ok" : "neutro"}>${t.actual ? "Propietario actual" : "Anterior"}<//>
            </p>
            <p className="lt-dato">
              ${t.dni ? `DNI ${t.dni} · ` : ""}${t.desde ? `desde ${fecha(t.desde)}` : "desde fecha no registrada"}${t.hasta ? ` hasta ${fecha(t.hasta)}` : ""}
            </p>
            ${!t.actual && t.motivo && html`<p className="lt-dato">Salió por: <strong>${t.motivo}</strong>${t.documento ? ` · ${t.documento}` : ""}</p>`}
            ${!t.actual && t.observacion && html`<p className="lt-dato">${t.observacion}</p>`}
          </div>
        </li>`)}
    </ol>`;
}

const NUEVA = { numero: "", nombres: "", apellidoPaterno: "", apellidoMaterno: "", dni: "", celular: "" };

export function PanelTraspaso({ stand, onCerrar, onListo }) {
  const { datos, derivados, usuario, avisar, ir } = useApp();
  const [t, setT] = useState({
    modo: "existente", nuevoId: "", nueva: { ...NUEVA },
    fecha: hoy().iso, motivo: "Compraventa", documento: "", observacion: "", quitarInquilino: false,
  });
  const [errores, setErrores] = useState({});
  const [ocupado, setOcupado] = useState(false);
  const cambia = (k) => (v) => setT((x) => ({ ...x, [k]: v }));
  const cambiaNueva = (k) => (v) => setT((x) => ({ ...x, nueva: { ...x.nueva, [k]: v } }));

  const dueno = derivados.porId.get(stand.propietarioId);
  const opciones = useMemo(
    () => opcionesAsociados(datos.asociados.filter((a) => a.id !== stand.propietarioId), derivados.mapaStands),
    [datos.asociados, derivados.mapaStands, stand.propietarioId],
  );
  const comprador = t.modo === "existente" ? derivados.porId.get(t.nuevoId) : null;
  const nombreNuevo = comprador ? nombreCompleto(comprador) : [t.nueva.apellidoPaterno, t.nueva.apellidoMaterno].filter(Boolean).join(" ") + (t.nueva.nombres ? `, ${t.nueva.nombres}` : "");
  const numeroSugerido = useMemo(() => {
    const n = datos.asociados.map((a) => parseInt(a.numero, 10)).filter((x) => x > 0);
    return String((n.length ? Math.max(...n) : 0) + 1).padStart(3, "0");
  }, [datos.asociados]);

  async function guardar() {
    setOcupado(true);
    try {
      const id = await transferirStand(stand.codigo, t, { asociados: datos.asociados, stands: datos.stands, mapaStands: derivados.mapaStands, por: usuario?.id });
      avisar(`Stand ${stand.codigo}: ahora figura a nombre de ${nombreNuevo.trim() || "el nuevo propietario"}. El anterior quedó en el historial.`);
      onCerrar();
      if (onListo) onListo(id);
      else if (t.modo === "nueva") ir(`ficha-${id}`);
    } catch (e) {
      setErrores(e.errores || {});
      avisar(mensajeError(e), "error");
    } finally {
      setOcupado(false);
    }
  }

  return html`
    <${Panel} titulo=${`Venta o traspaso del stand ${stand.codigo}`} onCerrar=${onCerrar}
      pie=${html`
        <button className="btn btn-ghost" onClick=${onCerrar}>Cancelar</button>
        <button className="btn btn-primary" disabled=${ocupado} onClick=${guardar}>${ocupado ? "Guardando…" : "Registrar traspaso"}</button>`}>
      <p className="muted">${nombreGaleria(stand.galeria)}${stand.giro ? ` · ${stand.giro}` : ""}</p>
      <div className="aviso aviso-info">
        <span>${dueno
          ? html`Propietario actual: <strong>${nombreCompleto(dueno)}</strong> (DNI ${dueno.dni}). No se borra: pasará al historial como propietario anterior.`
          : html`Este stand no tiene propietario registrado; el nuevo será el primero del historial.`}</span>
      </div>

      <div className="campo">
        <span className="label">¿El nuevo propietario ya está en el padrón? <span className="req" aria-hidden="true">*</span></span>
        <div className="segmentos en-linea" role="group" aria-label="Nuevo propietario">
          <button type="button" aria-pressed=${t.modo === "existente"} onClick=${() => cambia("modo")("existente")}>Sí, buscarlo</button>
          <button type="button" aria-pressed=${t.modo === "nueva"} onClick=${() => setT((x) => ({ ...x, modo: "nueva", nueva: { ...x.nueva, numero: x.nueva.numero || numeroSugerido } }))}>No, es nuevo</button>
        </div>
      </div>

      ${t.modo === "existente"
        ? html`<${Campo} id="t-nuevo" etiqueta="Nuevo propietario" req error=${errores.nuevoId} ayuda="Escribe el DNI, el nombre o el N° de asociado.">
            <${Buscador} id="t-nuevo" opciones=${opciones} valor=${t.nuevoId} onElegir=${cambia("nuevoId")} error=${errores.nuevoId} placeholder="Buscar por DNI o nombre" />
          <//>`
        : html`
          <p className="ayuda" style=${{ marginTop: -6 }}>Con estos datos entra al padrón; el resto de su ficha se completa después.</p>
          <${Campo} id="t-dni" etiqueta="DNI" req error=${errores.dni}><${Entrada} id="t-dni" valor=${t.nueva.dni} onCambio=${cambiaNueva("dni")} inputMode="numeric" maxLength="8" error=${errores.dni} /><//>
          <${Campo} id="t-nombres" etiqueta="Nombres" req error=${errores.nombres}><${Entrada} id="t-nombres" valor=${t.nueva.nombres} onCambio=${cambiaNueva("nombres")} error=${errores.nombres} /><//>
          <${Campo} id="t-ap" etiqueta="Apellido paterno" req error=${errores.apellidoPaterno}><${Entrada} id="t-ap" valor=${t.nueva.apellidoPaterno} onCambio=${cambiaNueva("apellidoPaterno")} error=${errores.apellidoPaterno} /><//>
          <${Campo} id="t-am" etiqueta="Apellido materno"><${Entrada} id="t-am" valor=${t.nueva.apellidoMaterno} onCambio=${cambiaNueva("apellidoMaterno")} /><//>
          <${Campo} id="t-cel" etiqueta="Celular" error=${errores.celular}><${Entrada} id="t-cel" valor=${t.nueva.celular} onCambio=${cambiaNueva("celular")} tipo="tel" error=${errores.celular} /><//>
          <${Campo} id="t-num" etiqueta="N° de asociado" req error=${errores.numero} ayuda="Sugerido: el siguiente libre del libro de padrón.">
            <${Entrada} id="t-num" valor=${t.nueva.numero} onCambio=${cambiaNueva("numero")} error=${errores.numero} />
          <//>`}

      <div className="form-rejilla">
        <${Campo} id="t-fecha" etiqueta="Fecha de la venta o traspaso" req error=${errores.fecha}>
          <${Entrada} id="t-fecha" valor=${t.fecha} onCambio=${cambia("fecha")} tipo="date" error=${errores.fecha} />
        <//>
        <${Campo} id="t-motivo" etiqueta="Motivo" req error=${errores.motivo}>
          <${Selector} id="t-motivo" valor=${t.motivo} onCambio=${cambia("motivo")} opciones=${MOTIVOS_TRASPASO} error=${errores.motivo} />
        <//>
      </div>
      <${Campo} id="t-doc" etiqueta="Documento que lo respalda" ayuda="Ej.: minuta de compraventa, escritura pública N° 1234, partida registral. Súbelo luego en Documentos de la ficha.">
        <${Entrada} id="t-doc" valor=${t.documento} onCambio=${cambia("documento")} />
      <//>
      <${Campo} id="t-obs" etiqueta="Observación">
        <${Texto} id="t-obs" valor=${t.observacion} onCambio=${cambia("observacion")} rows="3" />
      <//>
      ${stand.inquilino?.nombre && html`
        <label className="check">
          <input type="checkbox" checked=${t.quitarInquilino} onChange=${(e) => cambia("quitarInquilino")(e.target.checked)} />
          <span>El inquilino ${stand.inquilino.nombre} deja el stand con la venta</span>
        </label>`}
      <p className="ayuda">Las deudas del stand siguen en el stand. Quedará registrado por <strong>${usuario?.nombre || "tu usuario"}</strong>.</p>
    <//>`;
}
