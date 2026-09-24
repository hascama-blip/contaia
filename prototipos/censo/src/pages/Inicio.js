// Panel principal: avance del censo, cobranza del mes y lo que requiere atención.
import { html, useMemo } from "../components/html.js";
import { Kpi, Tarjeta, Barra, BadgeGravedad, Vacio } from "../components/ui.js";
import { useApp } from "../components/contexto.js";
import { MESES_LARGO } from "../config.js";
import { avanceCenso, avancePorGaleria, nombreCompleto } from "../lib/padron.js";
import { recaudacionMes, morosidadPorGaleria } from "../lib/pagos.js";
import { alertasReincidencia, ordenarRecientes } from "../lib/incidencias.js";
import { soles, fechaCorta, fecha } from "../lib/formato.js";
import { ESTADOS_INCIDENCIA } from "../lib/types.js";

export function Inicio() {
  const { datos, derivados, puedeEscribir } = useApp();
  const { h, porId, morosos } = derivados;

  const avance = useMemo(() => avanceCenso(datos.asociados), [datos.asociados]);
  const galerias = useMemo(() => avancePorGaleria(datos.asociados, datos.stands), [datos.asociados, datos.stands]);
  const cobro = useMemo(() => recaudacionMes(datos.pagos, h.anio, h.mes), [datos.pagos, h]);
  const moro = useMemo(() => morosidadPorGaleria(morosos), [morosos]);
  const alertas = useMemo(() => alertasReincidencia(datos.incidencias, h.iso), [datos.incidencias, h]);
  const visitas = datos.asociados.filter((a) => a.censo?.visita && a.censo.visita >= h.iso).sort((a, b) => a.censo.visita.localeCompare(b.censo.visita));
  const recientes = ordenarRecientes(datos.incidencias).slice(0, 4);
  const mes = MESES_LARGO[h.mes - 1];

  return html`
    <div className="pagina">
      <section className="hero">
        <div>
          <span className="hero-eti">Censo de asociados ${h.anio}</span>
          <h1>Estado del censo y la recaudación</h1>
          <p>${avance.censados} de ${avance.total} fichas actualizadas. Faltan ${avance.pendientes} por visitar${avance.sinUbicar ? ` y ${avance.sinUbicar} sin ubicar` : ""}.</p>
          <div className="hero-barra">
            <${Barra} pct=${avance.pct} />
            <div className="hero-cifras num"><span>${avance.censados} de ${avance.total}</span><span>${avance.pct}%</span></div>
          </div>
        </div>
        <div className="acciones">
          ${puedeEscribir !== false && html`<a className="btn btn-accent" href="#nueva">+ Nueva ficha</a>`}
          <a className="btn btn-claro" href="#campo">Continuar en campo</a>
        </div>
      </section>

      <div className="rejilla r-4">
        <${Kpi} etiqueta="Asociados en el padrón" valor=${avance.total} nota=${`${datos.stands.length} stands registrados`} />
        <${Kpi} etiqueta="Fichas actualizadas" valor=${avance.censados} tono="ok" nota=${`${avance.pct}% del padrón`} />
        <${Kpi} etiqueta="Verificadas y firmadas" valor=${avance.verificados} nota="Archivadas en el libro físico" />
        <${Kpi} etiqueta="Stands morosos" valor=${moro.morosos} tono=${moro.morosos ? "peligro" : "ok"} nota=${`${soles(moro.total)} por cobrar`} />
      </div>

      <div className="rejilla r-7-5">
        <${Tarjeta} titulo="Avance del censo por galería" sub="Stands con ficha actualizada sobre el total de la galería">
          ${galerias.map((g) => html`
            <div className="avance-fila" key=${g.id}>
              <div className="avance-cab"><span>${g.nombre}${g.id !== "S" ? html` <span className="muted">· ${g.piso}</span>` : ""}</span>
                <span className="num muted">${g.censados} / ${g.total}</span></div>
              <${Barra} pct=${g.pct} tono=${g.pct >= 60 ? "ok" : g.pct >= 30 ? "alerta" : "peligro"} />
            </div>`)}
          <div className="acciones" style=${{ marginTop: 18 }}>
            <a className="btn btn-ghost" href="#padron">Ver padrón</a>
            <a className="btn btn-ghost" href="#reportes">Ver reportes</a>
          </div>
        <//>

        <${Tarjeta} titulo=${`Recaudación de ${mes}`} sub="Pagos registrados este mes, por concepto">
          <ul className="lista">
            ${cobro.filas.map((c) => html`<li key=${c.id}><span>${c.nombre}</span><span className="num">${soles(c.cobrado)}</span></li>`)}
            <li className="total"><span>Total cobrado</span><span className="num">${soles(cobro.total)}</span></li>
          </ul>
        <//>
      </div>

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
      </div>
    </div>`;
}
