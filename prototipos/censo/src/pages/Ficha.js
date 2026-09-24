// Ficha del asociado: datos, familia, stands, pagos, incidencias y documentos.
import { html, useState, useEffect, useMemo } from "../components/html.js";
import { CabPagina, Tarjeta, BadgeAsociado, BadgeStand, BadgeGravedad, BadgeIncidencia, Vacio, mensajeError } from "../components/ui.js";
import { FichaForm } from "../components/FichaForm.js";
import { FotoCampo, ArchivoCampo, FirmaCampo } from "../components/Archivos.js";
import { CuadroAnual, Leyenda, PanelPago } from "../components/Pagos.js";
import { PanelIncidencia } from "../components/Incidencias.js";
import { Documentos } from "../components/Documentos.js";
import { useApp } from "../components/contexto.js";
import { ESTADOS_CENSO } from "../lib/types.js";
import { nombreCompleto, nombreGaleria } from "../lib/padron.js";
import { registrosDe, deudaStand } from "../lib/pagos.js";
import { incidenciasDe } from "../lib/incidencias.js";
import { fecha, soles } from "../lib/formato.js";
import { nombresDe } from "../lib/usuario.js";
import { actualizarFicha, cambiarEstadoCenso, adjuntarArchivo } from "../api/asociados.js";
import { pdfFicha, descargar } from "../lib/exportar.js";

const PESTANAS = [
  ["datos", "Datos personales"],
  ["familia", "Familia"],
  ["stands", "Stands e inquilinos"],
  ["pagos", "Pagos"],
  ["incidencias", "Incidencias"],
  ["huella", "Huella y firma"],
];

function fichaDesde(a, stands) {
  return {
    ...a,
    nacimiento: { departamento: "", provincia: "", distrito: "", ...(a.nacimiento || {}) },
    conyuge: { nombre: "", dni: "", celular: "", ...(a.conyuge || {}) },
    hijos: [...(a.hijos || [])],
    familiares: [...(a.familiares || [])],
    compromiso: { estatutos: false, datos: false, ...(a.compromiso || {}) },
    standsTexto: stands.map((s) => s.codigo).join(", "),
  };
}

export function Ficha({ id }) {
  const { datos, derivados, usuario, caps, avisar, puedeEscribir } = useApp();
  const a = derivados.porId.get(id);
  const stands = derivados.mapaStands.get(id) || [];
  const [pestana, setPestana] = useState("datos");
  const [ficha, setFicha] = useState(() => (a ? fichaDesde(a, stands) : null));
  const [sucio, setSucio] = useState(false);
  const [errores, setErrores] = useState({});
  const [ocupado, setOcupado] = useState(false);
  const [panel, setPanel] = useState(null);
  const [nombrePor, setNombrePor] = useState("");
  const editable = puedeEscribir !== false;

  // Si otro usuario cambia la ficha y aquí no hay cambios sin guardar, se refresca.
  useEffect(() => {
    if (a && !sucio) setFicha(fichaDesde(a, stands));
  }, [a, stands.map((s) => s.codigo).join(",")]);

  useEffect(() => {
    const por = a?.censo?.por;
    if (por) nombresDe([por]).then((m) => setNombrePor(m[por] || ""));
  }, [a?.censo?.por]);

  const incidencias = useMemo(() => incidenciasDe(id, datos.incidencias), [id, datos.incidencias]);

  if (!a || !ficha) {
    return html`<div className="pagina"><${CabPagina} miga=${{ href: "#padron", texto: "Padrón" }} titulo="Ficha no encontrada"
      sub="Puede que se haya vaciado o que el enlace esté incompleto." /></div>`;
  }

  const setFichaSucia = (actualizar) => { setSucio(true); setFicha(actualizar); };

  async function guardar() {
    setOcupado(true);
    try {
      await actualizarFicha(id, ficha, { asociados: datos.asociados, stands: datos.stands, standsActuales: stands, por: usuario?.id });
      setSucio(false);
      setErrores({});
      avisar("Ficha guardada.");
    } catch (e) {
      setErrores(e.errores || {});
      if (e.errores) setPestana(e.errores.conyugeDni && Object.keys(e.errores).length === 1 ? "familia" : "datos");
      avisar(mensajeError(e), "error");
    } finally {
      setOcupado(false);
    }
  }

  async function estadoCenso(estado) {
    try {
      await cambiarEstadoCenso(id, estado, { por: usuario?.id });
      avisar(`Ficha: ${ESTADOS_CENSO[estado].label}.`);
    } catch (e) {
      avisar(mensajeError(e), "error");
    }
  }

  async function bajarPDF() {
    try {
      avisar("Preparando el PDF…");
      const blob = await pdfFicha(a, { stands });
      await descargar(`ficha-${a.numero}-${a.apellidoPaterno}.pdf`, blob);
    } catch (e) {
      if (e?.code !== "declined") avisar(mensajeError(e), "error");
    }
  }

  const subir = (tipo) => (archivo) => adjuntarArchivo(id, tipo, archivo).then(() => avisar("Archivo guardado en la ficha."));
  const puedeSubir = caps.archivos && editable;
  const estado = a.censo?.estado || "pendiente";
  const deudaTotal = stands.reduce((s, st) => s + deudaStand(registrosDe(derivados.indicePagos, st.codigo, derivados.h.anio), derivados.h.anio, derivados.h).monto, 0);

  const contenido = {
    datos: html`<${FichaForm} ficha=${ficha} setFicha=${setFichaSucia} errores=${errores} numerar=${false}
      bloqueado=${!editable} secciones=${["identificacion", "personales", "contacto", "vinculo", "compromiso"]} />`,
    familia: html`<${FichaForm} ficha=${ficha} setFicha=${setFichaSucia} errores=${errores} numerar=${false}
      bloqueado=${!editable} secciones=${["conyuge", "hijos", "familiares"]} />`,
    stands: html`
      ${!stands.length && html`<${Vacio}>Sin stands asignados.<//>`}
      ${stands.length > 0 && html`
        <div className="tabla-caja"><table className="tabla">
          <thead><tr><th>Stand</th><th>Galería</th><th>Área</th><th>Giro</th><th>Inquilino actual</th><th>Estado</th></tr></thead>
          <tbody>${stands.map((s) => html`<tr key=${s.codigo}>
            <td className="fuerte num">${s.codigo}</td><td>${nombreGaleria(s.galeria)}</td>
            <td className="num">${s.area ? `${s.area} m²` : "—"}</td><td>${s.giro || "—"}</td>
            <td>${s.inquilino?.nombre || "—"}</td><td><${BadgeStand} estado=${s.estado} /></td></tr>`)}</tbody>
        </table></div>
        <p className="ayuda" style=${{ marginTop: 10 }}>Para cambiar el giro, el estado o el inquilino, entra a <a href="#stands">Stands</a>. Para asignar o quitar stands, edita el campo "N° de stand" en Datos personales.</p>`}`,
    pagos: html`
      <div style=${{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <${Leyenda} />
        ${editable && stands.length > 0 && html`<button className="btn btn-primary btn-sm" onClick=${() => setPanel({ tipo: "pago", stand: stands[0].codigo })}>Registrar pago</button>`}
      </div>
      ${stands.map((s) => html`<div key=${s.codigo} style=${{ marginBottom: 16 }}>
        <p className="label" style=${{ marginBottom: 6 }}>Stand ${s.codigo} · ${derivados.h.anio}</p>
        <${CuadroAnual} registros=${registrosDe(derivados.indicePagos, s.codigo, derivados.h.anio)} anio=${derivados.h.anio}
          onCelda=${editable ? (concepto, mes) => setPanel({ tipo: "pago", stand: s.codigo, concepto, mes }) : null} />
      </div>`)}`,
    incidencias: html`
      <div style=${{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
        ${editable && html`<button className="btn btn-primary btn-sm" onClick=${() => setPanel({ tipo: "incidencia" })}>Registrar incidencia</button>`}
      </div>
      ${!incidencias.length && html`<${Vacio}>Sin llamadas de atención registradas.<//>`}
      ${incidencias.length > 0 && html`<div className="tabla-caja"><table className="tabla">
        <thead><tr><th>Fecha</th><th>Tipo</th><th>Gravedad</th><th>Medida</th><th>Estado</th></tr></thead>
        <tbody>${incidencias.map((i) => html`<tr key=${i.id}><td className="num">${fecha(i.fecha)}</td><td>${i.tipo}</td>
          <td><${BadgeGravedad} estado=${i.gravedad} /></td><td>${i.medida}</td><td><${BadgeIncidencia} estado=${i.estado} /></td></tr>`)}</tbody>
      </table></div>`}`,
    huella: html`
      <div className="rejilla r-3">
        <${ArchivoCampo} id="doc-huella" etiqueta="Huella digital" valorId=${a.archivos?.huella} onArchivo=${subir("huella")} habilitado=${puedeSubir} textoBoton="Subir huella" />
        <${ArchivoCampo} id="doc-dni" etiqueta="Foto del DNI" valorId=${a.archivos?.dni} onArchivo=${subir("dni")} habilitado=${puedeSubir} textoBoton="Subir foto del DNI" />
        <${FirmaCampo} valorId=${a.archivos?.firma} onArchivo=${subir("firma")} habilitado=${puedeSubir} />
      </div>
      ${!caps.archivos && html`<p className="ayuda" style=${{ marginTop: 12 }}>Subir archivos requiere acceso de edición a esta página.</p>`}`,
  };

  const standsTxt = stands.map((s) => s.codigo).join(", ");
  return html`
    <div className="pagina">
      <${CabPagina} miga=${{ href: "#padron", texto: "Padrón" }} titulo=${nombreCompleto(a)}
        sub=${html`N° ${a.numero} · DNI ${a.dni} · ${stands.length > 1 ? "Stands" : "Stand"} ${standsTxt || "—"} · Ingreso ${fecha(a.fechaIngreso)} <${BadgeAsociado} estado=${a.estado} />`}
        acciones=${html`
          ${caps.descargas && html`<button className="btn btn-ghost" onClick=${bajarPDF}>Descargar ficha PDF</button>`}
          ${editable && html`<button className="btn btn-primary" disabled=${!sucio || ocupado} onClick=${guardar}>${ocupado ? "Guardando…" : sucio ? "Guardar cambios" : "Sin cambios"}</button>`}`} />

      <div className="rejilla r-8-4" style=${{ alignItems: "start" }}>
        <section className="card">
          <div className="pestanas" role="tablist" style=${{ padding: "0 12px" }}>
            ${PESTANAS.map(([k, t]) => html`<button key=${k} role="tab" aria-selected=${pestana === k} onClick=${() => setPestana(k)}>${t}</button>`)}
          </div>
          <div className="card-cuerpo" style=${{ paddingTop: 18 }}>${contenido[pestana]}</div>
        </section>

        <div style=${{ display: "flex", flexDirection: "column", gap: 16 }}>
          <${Tarjeta}>
            <${FotoCampo} id="foto-ficha" valorId=${a.archivos?.foto} onArchivo=${subir("foto")} habilitado=${puedeSubir} />
          <//>
          <${Tarjeta} titulo="Estado de la ficha">
            <div className="segmentos" role="group" aria-label="Estado de la ficha" style=${{ flexWrap: "wrap" }}>
              ${Object.entries(ESTADOS_CENSO).map(([k, v]) => html`<button key=${k} aria-pressed=${estado === k} disabled=${!editable}
                onClick=${() => estado !== k && estadoCenso(k)}>${v.label}</button>`)}
            </div>
            <p className="ayuda" style=${{ marginTop: 10 }}>
              ${a.censo?.fecha ? `Último cambio el ${fecha(a.censo.fecha)}${nombrePor ? ` por ${nombrePor}` : ""}.` : "Aún no se visita."}
              ${a.censo?.visita ? ` Segunda visita programada el ${fecha(a.censo.visita)}.` : ""}
            </p>
            <p className="ayuda" style=${{ marginTop: 6 }}>Verificado = ficha impresa y firmada, archivada en el libro físico.</p>
          <//>
          <${Tarjeta} titulo=${`Cuenta corriente ${derivados.h.anio}`}>
            <ul className="lista">
              <li><span>Deuda vencida</span><span className="num" style=${{ color: deudaTotal ? "var(--peligro)" : "var(--ok)", fontWeight: 700 }}>${deudaTotal ? soles(deudaTotal) : "Al día"}</span></li>
              <li><span>Incidencias registradas</span><span className="num">${incidencias.length}</span></li>
            </ul>
          <//>
        </div>
      </div>

      <${Documentos} asociado=${a} />

      ${panel?.tipo === "pago" && html`<${PanelPago} inicial=${{ ...panel, anio: derivados.h.anio }} stands=${stands} onCerrar=${() => setPanel(null)} />`}
      ${panel?.tipo === "incidencia" && html`<${PanelIncidencia} inicial=${{ asociadoId: id, stand: stands[0]?.codigo }} onCerrar=${() => setPanel(null)} />`}
    </div>`;
}
