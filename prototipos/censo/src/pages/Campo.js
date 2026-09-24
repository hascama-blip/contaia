// Censo en campo: plano interactivo del C.C. y lista en orden de inventario.
import { html, useState, useMemo } from "../components/html.js";
import { CabPagina, BadgeCenso, Panel, Campo as CampoForm, Entrada, Selector, Vacio, mensajeError } from "../components/ui.js";
import { FotoCampo } from "../components/Archivos.js";
import { Plano } from "../components/Plano.js";
import { useApp } from "../components/contexto.js";
import { GALERIAS, LISTAS } from "../config.js";
import { compararCodigos, nombreCompleto, normalizar, estadoCenso, estaCensado } from "../lib/padron.js";
import { MODOS } from "../lib/plano.js";
import { fecha, hoy } from "../lib/formato.js";
import { soloDigitos } from "../lib/validar.js";
import { cambiarEstadoCenso, programarVisita, adjuntarArchivo, actualizarDatosCampo } from "../api/asociados.js";

function PanelVisita({ asociado, stand, onCerrar }) {
  const { usuario, caps, avisar, puedeEscribir } = useApp();
  const [celular, setCelular] = useState(asociado.celular || "");
  const [civil, setCivil] = useState(asociado.estadoCivil || "");
  const [ausente, setAusente] = useState(false);
  const [visita, setVisita] = useState("");
  const [nota, setNota] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const editable = puedeEscribir !== false;

  async function confirmar() {
    setOcupado(true);
    try {
      if (soloDigitos(celular) !== asociado.celular || civil !== asociado.estadoCivil) {
        await actualizarDatosCampo(asociado.id, { celular, estadoCivil: civil });
      }
      if (!estaCensado(asociado)) await cambiarEstadoCenso(asociado.id, "actualizado", { por: usuario?.id });
      avisar(`Stand ${stand.codigo}: ficha actualizada.`);
      onCerrar();
    } catch (e) {
      avisar(mensajeError(e), "error");
    } finally {
      setOcupado(false);
    }
  }

  async function guardarAusencia() {
    setOcupado(true);
    try {
      await programarVisita(asociado.id, visita, nota || "Propietario ausente.", asociado.observaciones);
      avisar(visita ? `Visita programada para el ${fecha(visita)}.` : "Ausencia registrada.");
      onCerrar();
    } catch (e) {
      avisar(mensajeError(e), "error");
    } finally {
      setOcupado(false);
    }
  }

  return html`
    <${Panel} titulo=${`Stand ${stand.codigo}`} onCerrar=${onCerrar}
      pie=${editable && (ausente
        ? html`<button className="btn btn-ghost" onClick=${() => setAusente(false)}>Volver</button>
            <button className="btn btn-primary" disabled=${ocupado} onClick=${guardarAusencia}>Guardar visita</button>`
        : html`<button className="btn btn-ghost" onClick=${() => setAusente(true)}>Propietario ausente</button>
            <button className="btn btn-primary" disabled=${ocupado} onClick=${confirmar}>${estaCensado(asociado) ? "Guardar" : "Marcar actualizado"}</button>`)}>
      <div>
        <p style=${{ fontWeight: 700 }}>${nombreCompleto(asociado)}</p>
        <p className="card-sub">N° ${asociado.numero} · DNI ${asociado.dni} · <${BadgeCenso} estado=${estadoCenso(asociado)} /></p>
      </div>
      ${ausente
        ? html`
          <${CampoForm} id="cv-visita" etiqueta="Segunda visita"><${Entrada} id="cv-visita" tipo="date" valor=${visita} onCambio=${setVisita} min=${hoy().iso} /><//>
          <${CampoForm} id="cv-nota" etiqueta="Observación" ayuda="Ej. Stand cerrado; se dejó citación con el vecino."><${Entrada} id="cv-nota" valor=${nota} onCambio=${setNota} /><//>`
        : html`
          <div style=${{ maxWidth: 220 }}>
            <${FotoCampo} id="cv-foto" valorId=${asociado.archivos?.foto} habilitado=${caps.archivos && editable}
              onArchivo=${(f) => adjuntarArchivo(asociado.id, "foto", f).then(() => avisar("Foto guardada."))} />
          </div>
          <${CampoForm} id="cv-cel" etiqueta="Celular"><${Entrada} id="cv-cel" tipo="tel" inputMode="numeric" valor=${celular} onCambio=${setCelular} disabled=${!editable} /><//>
          <${CampoForm} id="cv-civil" etiqueta="Estado civil"><${Selector} id="cv-civil" valor=${civil} onCambio=${setCivil} opciones=${LISTAS.estadoCivil} disabled=${!editable} /><//>
          <a className="btn btn-ghost" href=${`#ficha-${asociado.id}`}>Abrir ficha completa</a>`}
    <//>`;
}

export function Campo() {
  const { datos, derivados } = useApp();
  const [texto, setTexto] = useState("");
  const [soloPendientes, setSoloPendientes] = useState(false);
  const [modo, setModo] = useState("censo");
  const [abierto, setAbierto] = useState(null);

  // Todas las filas stand + asociado, en orden de inventario.
  const filas = useMemo(() => [...datos.stands]
    .sort((a, b) => compararCodigos(a.codigo, b.codigo))
    .map((s) => ({ stand: s, asociado: derivados.porId.get(s.propietarioId) }))
    .filter(({ asociado }) => asociado), [datos.stands, derivados.porId]);

  const visibles = useMemo(() => {
    const q = normalizar(texto);
    return filas
      .filter(({ asociado }) => !soloPendientes || !estaCensado(asociado))
      .filter(({ stand, asociado }) => !q || normalizar(`${stand.codigo} ${asociado.dni} ${asociado.numero} ${nombreCompleto(asociado)}`).includes(q));
  }, [filas, texto, soloPendientes]);

  const filtrando = Boolean(texto.trim()) || soloPendientes;
  const resaltar = filtrando ? new Set(visibles.map((f) => f.stand.codigo)) : null;
  const enfocar = texto.trim() && visibles.length === 1 ? visibles[0].stand.codigo : null;
  const grupos = GALERIAS.map((g) => ({ ...g, filas: visibles.filter((f) => f.stand.galeria === g.id) })).filter((g) => g.filas.length);

  const actual = abierto && {
    stand: datos.stands.find((s) => s.codigo === abierto),
    asociado: derivados.porId.get(datos.stands.find((s) => s.codigo === abierto)?.propietarioId),
  };

  return html`
    <div className="pagina">
      <${CabPagina} miga=${{ href: "#inicio", texto: "Inicio" }} titulo="Censo en campo"
        sub="Plano del C.C. (un solo piso). Pasa el cursor o toca un stand para ver su resumen; desde la burbuja abres la ficha." />

      <section className="card card-pad" style=${{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div className="barra-herr">
          <label className="sr" htmlFor="cp-buscar">Buscar</label>
          <input id="cp-buscar" className="input buscar" type="search" placeholder="Buscar por stand, DNI o nombre" value=${texto} onChange=${(e) => setTexto(e.target.value)} />
          <div className="segmentos en-linea" role="group" aria-label="Colorear el plano por">
            ${Object.entries(MODOS).map(([k, t]) => html`<button key=${k} aria-pressed=${modo === k} onClick=${() => setModo(k)}>${t}</button>`)}
          </div>
          <label className="check" style=${{ alignItems: "center" }}>
            <input type="checkbox" id="cp-pend" checked=${soloPendientes} onChange=${(e) => setSoloPendientes(e.target.checked)} />
            <span>Solo pendientes</span>
          </label>
        </div>
        <${Plano} modo=${modo} resaltar=${resaltar} enfocar=${enfocar} onVerificar=${setAbierto} />
        <p className="ayuda">Plano de ejemplo para la demostración. Con el plano real del C.C. se reemplaza la distribución y los colores siguen funcionando igual.</p>
      </section>

      <section className="card">
        <div className="card-cab" style=${{ paddingBottom: 12 }}>
          <div><h2 className="card-titulo">Recorrido en orden de inventario</h2>
            <p className="card-sub">${visibles.length} stands${filtrando ? " con el filtro actual" : ""}. Toca uno para verificar con el propietario presente.</p></div>
        </div>
        <div className="campo-lista">
          ${grupos.map((g) => html`
            <div key=${g.id}>
              <div className="grupo-titulo"><span>${g.nombre}</span><span className="num">${g.filas.length}</span></div>
              ${g.filas.map(({ stand, asociado }) => html`
                <button key=${stand.codigo} className="campo-item" onClick=${() => setAbierto(stand.codigo)}>
                  <span className="campo-stand">${stand.codigo}</span>
                  <span className="campo-nombre">${nombreCompleto(asociado)}<small>${asociado.censo?.visita ? `Visita ${fecha(asociado.censo.visita)}` : `DNI ${asociado.dni}`}</small></span>
                  <${BadgeCenso} estado=${estadoCenso(asociado)} />
                </button>`)}
            </div>`)}
          ${!grupos.length && html`<${Vacio}>${soloPendientes ? "No quedan stands pendientes con ese filtro." : "Ningún stand coincide."}<//>`}
        </div>
      </section>
      ${actual?.asociado && html`<${PanelVisita} key=${abierto} asociado=${actual.asociado} stand=${actual.stand} onCerrar=${() => setAbierto(null)} />`}
    </div>`;
}
