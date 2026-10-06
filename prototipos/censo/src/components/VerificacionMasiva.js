// Verificar todos los DNI con RENIEC: actualiza datos y foto de muchos asociados de corrido.
import { html, useState, useRef } from "./html.js";
import { Panel, Barra } from "./ui.js";
import { useApp } from "./contexto.js";
import { verificarEnLote, dniValido, verificado } from "../api/reniec.js";

export function VerificacionMasiva({ asociados, onCerrar }) {
  const { usuario, avisar } = useApp();
  const [incluirVerificados, setIncluir] = useState(false);
  const [estado, setEstado] = useState(null); // null | { ...resumen, corriendo }
  const parar = useRef(false);
  const validos = asociados.filter((a) => dniValido(a.dni));
  const sinDni = asociados.length - validos.length;
  const pendientes = validos.filter((a) => incluirVerificados || !verificado(a));

  async function iniciar() {
    if (!pendientes.length) return;
    if (!confirm(`Se consultarán ${pendientes.length} DNI en RENIEC. Cada consulta nueva descuenta del plan de apidni (las ya consultadas salen de la caché y no cuestan). ¿Continuar?`)) return;
    parar.current = false;
    setEstado({ total: pendientes.length, hechos: 0, ok: 0, conFoto: 0, errores: [], corriendo: true });
    const r = await verificarEnLote(pendientes, { por: usuario?.id, onAvance: (e) => setEstado({ ...e, corriendo: true }), detener: () => parar.current });
    setEstado({ ...r, corriendo: false });
    if (r.simulado) avisar("El servidor no tiene token de RENIEC: no se cambió nada. Configúralo en Administración.", "error");
    else avisar(`Verificación terminada: ${r.ok} fichas actualizadas, ${r.conFoto} con foto, ${r.errores.length} con error.`);
  }

  const pct = estado ? Math.round((estado.hechos / Math.max(1, estado.total)) * 100) : 0;
  return html`
    <${Panel} titulo="Verificar DNI con RENIEC" onCerrar=${estado?.corriendo ? () => {} : onCerrar}
      pie=${html`
        ${estado?.corriendo
          ? html`<button className="btn btn-ghost" onClick=${() => { parar.current = true; }}>Detener</button>`
          : html`<button className="btn btn-ghost" onClick=${onCerrar}>Cerrar</button>
                 <button className="btn btn-primary" disabled=${!pendientes.length} onClick=${iniciar}>Verificar ${pendientes.length} DNI</button>`}`}>
      <p className="ayuda" style=${{ marginTop: 0 }}>Para cada asociado se consulta su DNI y se reemplazan nombres, apellidos, fecha de nacimiento y dirección con lo que dice RENIEC. Si el plan incluye la foto del DNI, se guarda como foto de la ficha. Los stands, pagos, contacto y familia no se tocan.</p>
      <ul className="lista-simple">
        <li>${validos.length} asociados con DNI de 8 dígitos${sinDni ? html` · <span className="muted">${sinDni} sin DNI válido (se omiten)</span>` : ""}</li>
        <li>${validos.filter(verificado).length} ya verificados antes</li>
      </ul>
      <label className="check"><input type="checkbox" checked=${incluirVerificados} onChange=${(e) => setIncluir(e.target.checked)} disabled=${estado?.corriendo} /> Volver a consultar también los ya verificados</label>
      ${estado && html`
        <div style=${{ marginTop: 14 }}>
          <div className="tabla-pie" style=${{ padding: "6px 0", border: 0 }}><span>${estado.hechos} de ${estado.total}${estado.actual ? ` · ${estado.actual.apellidoPaterno || ""} ${estado.actual.nombres || ""}` : ""}</span><span>${estado.ok} ok · ${estado.conFoto} con foto · ${estado.errores.length} errores</span></div>
          <${Barra} pct=${pct} tono=${estado.errores.length ? "alerta" : "ok"} />
          ${estado.detenido && !estado.simulado && html`<p className="ayuda">Detenido. Lo ya hecho quedó guardado; puedes continuar luego.</p>`}
          ${estado.errores.length > 0 && html`
            <details style=${{ marginTop: 10 }}><summary>Errores (${estado.errores.length})</summary>
              <ul className="lista-simple">${estado.errores.map((e) => html`<li key=${e.id}><a href=${`#ficha-${e.id}`}>N° ${e.numero} · DNI ${e.dni}</a> · ${e.nombre}: ${e.mensaje}</li>`)}</ul>
            </details>`}
        </div>`}
    <//>`;
}
