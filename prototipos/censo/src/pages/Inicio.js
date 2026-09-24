// Panel principal: indicadores, plano del C.C. con la barra de logro del censo,
// lo que requiere atención y el recorrido en orden de inventario.
import { html, useMemo } from "../components/html.js";
import { Kpi, Tarjeta, BadgeGravedad, Vacio } from "../components/ui.js";
import { useApp } from "../components/contexto.js";
import { Campo } from "./Campo.js";
import { avanceCenso, nombreCompleto } from "../lib/padron.js";
import { morosidadPorGaleria } from "../lib/pagos.js";
import { alertasReincidencia, ordenarRecientes } from "../lib/incidencias.js";
import { soles, fechaCorta, fecha } from "../lib/formato.js";
import { ESTADOS_INCIDENCIA } from "../lib/types.js";

export function Inicio() {
  const { datos, derivados, puedeEscribir } = useApp();
  const { h, porId, morosos } = derivados;

  const avance = useMemo(() => avanceCenso(datos.asociados), [datos.asociados]);
  const moro = useMemo(() => morosidadPorGaleria(morosos), [morosos]);
  const alertas = useMemo(() => alertasReincidencia(datos.incidencias, h.iso), [datos.incidencias, h]);
  const visitas = datos.asociados.filter((a) => a.censo?.visita && a.censo.visita >= h.iso).sort((a, b) => a.censo.visita.localeCompare(b.censo.visita));
  const recientes = ordenarRecientes(datos.incidencias).slice(0, 4);

  const atencion = html`
      <div className="rejilla r-2">
        <${Tarjeta} titulo="Requiere atención">
          ${!alertas.length && !visitas.length && html`<${Vacio}>Sin alertas ni visitas programadas.<//>`}
          <div style=${{ display: "flex", flexDirection: "column", gap: 10 }}>
            ${alertas.map((al) => {
              const a = porId.get(al.asociadoId);
              return html`<a key=${al.asociadoId} className="aviso aviso-peligro" href=${`#ficha-${al.asociadoId}`} style=${{ textDecoration: "none" }}>
                <span><strong>${nombreCompleto(a)}</strong> acumula ${al.cantidad} llamadas de atención en los últimos doce meses. Corresponde evaluar sanción según estatutos.</span></a>`;
            })}
            ${visitas.map((a) => html`<a key=${a.id} className="aviso aviso-info" href=${`#ficha-${a.id}`} style=${{ textDecoration: "none" }}>
              <span>Segunda visita programada el <strong>${fecha(a.censo.visita)}</strong> · ${nombreCompleto(a)} (${(derivados.mapaStands.get(a.id) || []).map((s) => s.codigo).join(", ")})</span></a>`)}
          </div>
        <//>

        <${Tarjeta} titulo="Incidencias recientes" accion=${html`<a className="enlace-btn" href="#incidencias">Ver todas</a>`}>
          ${!recientes.length && html`<${Vacio}>No hay incidencias registradas.<//>`}
          <ul className="lista">
            ${recientes.map((i) => html`
              <li key=${i.id} style=${{ alignItems: "flex-start" }}>
                <span style=${{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <${BadgeGravedad} estado=${i.gravedad} />
                  <span>${i.tipo} — ${i.stand}<br /><span className="muted" style=${{ fontSize: "var(--t-xs)" }}>${fechaCorta(i.fecha)} · ${i.involucrado || nombreCompleto(porId.get(i.asociadoId))}</span></span>
                </span>
                <span className="muted" style=${{ fontSize: "var(--t-xs)", whiteSpace: "nowrap" }}>${ESTADOS_INCIDENCIA[i.estado]?.label}</span>
              </li>`)}
          </ul>
        <//>
      </div>`;

  return html`
    <div className="pagina">
      <section className="hero">
        <div>
          <span className="hero-eti">Censo de asociados ${h.anio}</span>
          <h1>Estado del censo</h1>
          <p>${avance.censados} de ${avance.total} fichas actualizadas. Faltan ${avance.pendientes} por visitar${avance.sinUbicar ? ` y ${avance.sinUbicar} sin ubicar` : ""}.</p>
        </div>
        <div className="acciones">
          ${puedeEscribir !== false && html`<a className="btn btn-accent" href="#nueva">+ Nueva ficha</a>`}
          <a className="btn btn-claro" href="#padron">Ver padrón</a>
        </div>
      </section>

      <div className="rejilla r-4">
        <${Kpi} etiqueta="Asociados en el padrón" valor=${avance.total} nota=${`${datos.stands.length} stands registrados`} />
        <${Kpi} etiqueta="Fichas actualizadas" valor=${avance.censados} tono="ok" nota=${`${avance.pct}% del padrón`} />
        <${Kpi} etiqueta="Verificadas y firmadas" valor=${avance.verificados} nota="Archivadas en el libro físico" />
        <${Kpi} etiqueta="Stands morosos" valor=${moro.morosos} tono=${moro.morosos ? "peligro" : "ok"} nota=${`${soles(moro.total)} por cobrar`} />
      </div>

      <${Campo} incrustado debajoDelPlano=${html`<${Logro} avance=${avance} />`} antesDeLista=${atencion} />
    </div>`;
}

const METAS = [25, 50, 75, 100];

/** Barra de logro del censo: verificadas + actualizadas, con metas al 25/50/75/100 %. */
function Logro({ avance }) {
  const { total, verificados, actualizados, censados, pct } = avance;
  const pv = total ? (verificados / total) * 100 : 0;
  const pa = total ? (actualizados / total) * 100 : 0;
  const meta = METAS.find((m) => m > pct);
  const faltan = meta ? Math.max(0, Math.ceil((meta / 100) * total) - censados) : 0;
  return html`
    <div className="logro" role="group" aria-label="Avance del censo">
      <div className="logro-cab">
        <div>
          <span className="logro-eti">Avance del censo</span>
          <span className="logro-cifra num">${pct}%</span>
          <span className="muted num" style=${{ fontSize: "var(--t-sm)" }}>${censados} de ${total} fichas</span>
        </div>
        <span className="logro-meta">${meta
          ? html`Próxima meta: <strong>${meta}%</strong> · faltan ${faltan} ${faltan === 1 ? "ficha" : "fichas"}`
          : html`<strong>¡Censo completo!</strong>`}</span>
      </div>
      <div className="logro-pista" role="progressbar" aria-valuenow=${pct} aria-valuemin="0" aria-valuemax="100">
        <span className="logro-ver" style=${{ width: `${pv}%` }}></span>
        <span className="logro-act" style=${{ width: `${pa}%` }}></span>
        ${METAS.slice(0, -1).map((m) => html`<i key=${m} className=${`logro-hito${pct >= m ? " hecho" : ""}`} style=${{ left: `${m}%` }}></i>`)}
      </div>
      <div className="logro-escala num">
        ${METAS.map((m) => html`<span key=${m} className=${pct >= m ? "hecho" : ""} style=${{ left: `${m}%` }}>${pct >= m ? "✓ " : ""}${m}%</span>`)}
      </div>
      <div className="leyenda">
        <span><i style=${{ background: "var(--ok)" }}></i>Verificadas ${verificados}</span>
        <span><i style=${{ background: "var(--info)" }}></i>Actualizadas ${actualizados}</span>
        <span><i style=${{ background: "var(--neutro-fondo)", border: "1px solid var(--borde-fuerte)" }}></i>Por censar ${total - censados}</span>
      </div>
    </div>`;
}
