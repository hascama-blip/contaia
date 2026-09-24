// Reportes: avance por galería, pendientes de censo, morosos y descargas.
import { html, useState, useMemo } from "../components/html.js";
import { CabPagina, Tarjeta, Barra, BadgeCenso, BadgeAtraso, Vacio, mensajeError } from "../components/ui.js";
import { useApp } from "../components/contexto.js";
import { avancePorGaleria, nombreCompleto, nombreGaleria, ordenarPorNumero, estadoCenso } from "../lib/padron.js";
import { soles, fecha, hoy } from "../lib/formato.js";
import { aCSV, descargar, COLUMNAS_PADRON } from "../lib/exportar.js";
import { ESTADOS_STAND, GRAVEDADES, ESTADOS_INCIDENCIA } from "../lib/types.js";
import { contarEjemplos, vaciarEjemplos } from "../api/mantenimiento.js";

export function Reportes() {
  const { datos, derivados, caps, avisar, puedeEscribir } = useApp();
  const { mapaStands, porId, morosos, atraso } = derivados;
  const galerias = useMemo(() => avancePorGaleria(datos.asociados, datos.stands), [datos.asociados, datos.stands]);
  const pendientes = useMemo(
    () => ordenarPorNumero(datos.asociados.filter((a) => ["pendiente", "sin_ubicar"].includes(estadoCenso(a)))),
    [datos.asociados],
  );
  const ejemplos = contarEjemplos(datos);
  const [confirmar, setConfirmar] = useState(false);
  const [avance, setAvance] = useState(null);

  async function bajar(nombre, columnas, filas) {
    try {
      await descargar(`${nombre}-${hoy().iso}.csv`, aCSV(columnas, filas));
      avisar("Archivo listo.");
    } catch (e) {
      if (e?.code !== "declined") avisar(mensajeError(e), "error");
    }
  }
  const standsTxt = (a) => (mapaStands.get(a.id) || []).map((s) => s.codigo).join(" ");
  const descargas = [
    ["Padrón completo", () => bajar("padron-asociados", COLUMNAS_PADRON(mapaStands, atraso), ordenarPorNumero(datos.asociados))],
    ["Fichas pendientes", () => bajar("fichas-pendientes", [
      { titulo: "N°", valor: (a) => a.numero }, { titulo: "Asociado", valor: nombreCompleto }, { titulo: "Stands", valor: standsTxt },
      { titulo: "Celular", valor: (a) => a.celular }, { titulo: "Estado", valor: (a) => estadoCenso(a) }, { titulo: "Visita programada", valor: (a) => a.censo?.visita || "" },
    ], pendientes)],
    ["Morosos", () => bajar("morosos", [
      { titulo: "Stand", valor: (m) => m.stand.codigo }, { titulo: "Galería", valor: (m) => nombreGaleria(m.stand.galeria) },
      { titulo: "Propietario", valor: (m) => nombreCompleto(porId.get(m.stand.propietarioId)) },
      { titulo: "Celular", valor: (m) => porId.get(m.stand.propietarioId)?.celular || "" },
      { titulo: "Meses de atraso", valor: (m) => m.deuda.meses }, { titulo: "Deuda (S/)", valor: (m) => m.deuda.monto },
    ], morosos)],
    ["Stands e inquilinos", () => bajar("stands", [
      { titulo: "Stand", valor: (s) => s.codigo }, { titulo: "Galería", valor: (s) => nombreGaleria(s.galeria) }, { titulo: "Área m2", valor: (s) => s.area ?? "" },
      { titulo: "Giro", valor: (s) => s.giro }, { titulo: "Propietario", valor: (s) => nombreCompleto(porId.get(s.propietarioId)) },
      { titulo: "Inquilino", valor: (s) => s.inquilino?.nombre || "" }, { titulo: "Estado", valor: (s) => ESTADOS_STAND[s.estado]?.label },
    ], datos.stands)],
    ["Incidencias", () => bajar("incidencias", [
      { titulo: "Fecha", valor: (i) => i.fecha }, { titulo: "Stand", valor: (i) => i.stand }, { titulo: "Involucrado", valor: (i) => i.involucrado },
      { titulo: "Tipo", valor: (i) => i.tipo }, { titulo: "Gravedad", valor: (i) => GRAVEDADES[i.gravedad]?.label },
      { titulo: "Medida", valor: (i) => i.medida }, { titulo: "Estado", valor: (i) => ESTADOS_INCIDENCIA[i.estado]?.label }, { titulo: "Detalle", valor: (i) => i.detalle },
    ], datos.incidencias)],
  ];

  async function vaciar() {
    try {
      setAvance([0, ejemplos]);
      const n = await vaciarEjemplos(datos, (hechos, total) => setAvance([hechos, total]));
      avisar(`Listo: se borraron ${n} registros de ejemplo. Ya puedes cargar el padrón real.`);
    } catch (e) {
      avisar(mensajeError(e), "error");
    } finally {
      setAvance(null);
      setConfirmar(false);
    }
  }

  return html`
    <div className="pagina">
      <${CabPagina} miga=${{ href: "#inicio", texto: "Inicio" }} titulo="Reportes" sub=${`Corte al ${fecha(hoy().iso)}`} />

      <div className="rejilla r-7-5">
        <${Tarjeta} titulo="Avance de fichas por galería" sinCuerpo>
          <div className="tabla-caja" style=${{ marginTop: 10 }}>
            <table className="tabla">
              <thead><tr><th>Galería</th><th className="der">Stands</th><th className="der">Con ficha</th><th style=${{ width: "34%" }}>Avance</th></tr></thead>
              <tbody>${galerias.map((g) => html`<tr key=${g.id}>
                <td>${g.nombre}</td><td className="der num">${g.total}</td><td className="der num">${g.censados}</td>
                <td><div style=${{ display: "flex", gap: 8, alignItems: "center" }}><div style=${{ flex: 1 }}><${Barra} pct=${g.pct} tono=${g.pct >= 60 ? "ok" : g.pct >= 30 ? "alerta" : "peligro"} /></div><span className="num muted" style=${{ fontSize: "var(--t-xs)", width: 34, textAlign: "right" }}>${g.pct}%</span></div></td>
              </tr>`)}</tbody>
            </table>
          </div>
        <//>
        <${Tarjeta} titulo="Descargas" sub=${caps.descargas ? "Archivos CSV que se abren en Excel" : "Las descargas no están disponibles en esta vista."}>
          ${caps.descargas && html`<div style=${{ display: "flex", flexDirection: "column", gap: 8 }}>
            ${descargas.map(([t, fn]) => html`<button key=${t} className="btn btn-ghost" style=${{ justifyContent: "space-between" }} onClick=${fn}><span>${t}</span><span className="muted">CSV</span></button>`)}
          </div>`}
        <//>
      </div>

      <div className="rejilla r-2">
        <${Tarjeta} titulo="Fichas pendientes" sub=${`${pendientes.length} asociados por visitar o ubicar`} sinCuerpo>
          <div className="tabla-caja" style=${{ marginTop: 10, maxHeight: 420 }}>
            <table className="tabla">
              <tbody>${pendientes.map((a) => html`<tr key=${a.id}>
                <td className="num fuerte">${standsTxt(a) || "—"}</td>
                <td><a href=${`#ficha-${a.id}`}>${nombreCompleto(a)}</a>${a.censo?.visita ? html`<br /><span className="muted" style=${{ fontSize: "var(--t-xs)" }}>Visita ${fecha(a.censo.visita)}</span>` : ""}</td>
                <td><${BadgeCenso} estado=${estadoCenso(a)} /></td>
              </tr>`)}</tbody>
            </table>
            ${!pendientes.length && html`<${Vacio}>Todas las fichas están actualizadas.<//>`}
          </div>
        <//>
        <${Tarjeta} titulo="Morosos" sub=${`${morosos.length} stands · ${soles(morosos.reduce((s, m) => s + m.deuda.monto, 0))} por cobrar`} sinCuerpo>
          <div className="tabla-caja" style=${{ marginTop: 10, maxHeight: 420 }}>
            <table className="tabla">
              <tbody>${morosos.map((m) => html`<tr key=${m.stand.codigo}>
                <td className="num fuerte"><a href=${`#pagos-${m.stand.codigo}`}>${m.stand.codigo}</a></td>
                <td>${nombreCompleto(porId.get(m.stand.propietarioId))}</td>
                <td><${BadgeAtraso} meses=${m.deuda.meses} /></td>
                <td className="der num">${soles(m.deuda.monto)}</td>
              </tr>`)}</tbody>
            </table>
            ${!morosos.length && html`<${Vacio}>Todos los stands están al día.<//>`}
          </div>
        <//>
      </div>

      ${ejemplos > 0 && puedeEscribir !== false && html`
        <${Tarjeta} titulo="Datos de ejemplo" sub=${`Hay ${ejemplos} registros de ejemplo (asociados, stands, pagos e incidencias) para probar la app.`}>
          ${!confirmar
            ? html`<button className="btn btn-peligro" onClick=${() => setConfirmar(true)}>Vaciar datos de ejemplo</button>`
            : html`<div className="confirmar">
                <p>Se borrarán los ${ejemplos} registros de ejemplo para todos los que usan esta página. Lo que ustedes hayan registrado se queda. ¿Continuar?</p>
                <div className="acciones">
                  <button className="btn btn-peligro" disabled=${Boolean(avance)} onClick=${vaciar}>${avance ? `Borrando ${avance[0]} de ${avance[1]}…` : "Sí, vaciar"}</button>
                  <button className="btn btn-ghost" disabled=${Boolean(avance)} onClick=${() => setConfirmar(false)}>Cancelar</button>
                </div>
              </div>`}
        <//>`}
    </div>`;
}
