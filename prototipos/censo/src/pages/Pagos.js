// Control de pagos: cuadro anual por stand, registro de pagos y morosidad.
import { html, useState, useMemo } from "../components/html.js";
import { CabPagina, Tarjeta, BadgeAtraso, Vacio } from "../components/ui.js";
import { CuadroAnual, Leyenda, PanelPago } from "../components/Pagos.js";
import { Buscador, opcionesStands } from "../components/Buscador.js";
import { useApp } from "../components/contexto.js";
import { compararCodigos, nombreCompleto, nombreGaleria } from "../lib/padron.js";
import { registrosDe, deudaStand, morosidadPorGaleria } from "../lib/pagos.js";
import { soles } from "../lib/formato.js";

export function Pagos({ stand: standRuta }) {
  const { datos, derivados, puedeEscribir, ir } = useApp();
  const { h, indicePagos, morosos, porId } = derivados;
  const [anio, setAnio] = useState(h.anio);
  const [panel, setPanel] = useState(null);
  const ordenados = useMemo(() => [...datos.stands].sort((a, b) => compararCodigos(a.codigo, b.codigo)), [datos.stands]);
  const codigo = standRuta && ordenados.some((s) => s.codigo === standRuta) ? standRuta : morosos[0]?.stand.codigo || ordenados[0]?.codigo;
  const stand = ordenados.find((s) => s.codigo === codigo);
  const dueno = stand && porId.get(stand.propietarioId);
  const registros = stand ? registrosDe(indicePagos, stand.codigo, anio) : {};
  const deuda = stand ? deudaStand(registros, anio, h) : { monto: 0, meses: 0 };
  const moro = useMemo(() => morosidadPorGaleria(morosos), [morosos]);
  const opciones = useMemo(() => opcionesStands(ordenados, porId), [ordenados, porId]);
  const editable = puedeEscribir !== false;

  return html`
    <div className="pagina">
      <${CabPagina} miga=${{ href: "#inicio", texto: "Inicio" }} titulo=${`Control de pagos · ${anio}`} sub="Cuadro anual por stand y concepto"
        acciones=${editable && html`<button className="btn btn-primary" onClick=${() => setPanel({ stand: codigo })}>Registrar pago</button>`} />

      <section className="card">
        <div className="filtros">
          <label className="label" htmlFor="pg-stand" style=${{ margin: 0 }}>Stand</label>
          <div style=${{ flex: "1 1 280px", minWidth: 0 }}>
            <${Buscador} id="pg-stand" opciones=${opciones} valor=${codigo || ""} placeholder="Buscar por stand, DNI o nombre"
              onElegir=${(v) => v && ir(`pagos-${v}`)} />
          </div>
          <label className="sr" htmlFor="pg-anio">Año</label>
          <select id="pg-anio" className="input" value=${anio} onChange=${(e) => setAnio(Number(e.target.value))}>
            ${[h.anio, h.anio - 1].map((y) => html`<option key=${y} value=${y}>${y}</option>`)}
          </select>
        </div>
        ${stand
          ? html`<div className="card-cuerpo" style=${{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style=${{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                <div>
                  <p style=${{ fontWeight: 700 }}>Stand ${stand.codigo} · ${dueno ? html`<a href=${`#ficha-${dueno.id}`}>${nombreCompleto(dueno)}</a>` : "Sin propietario"}</p>
                  <p className="card-sub">${nombreGaleria(stand.galeria)}${stand.giro ? ` · ${stand.giro}` : ""}</p>
                </div>
                <div style=${{ display: "flex", gap: 10, alignItems: "center" }}>
                  <${BadgeAtraso} meses=${deuda.meses} />
                  ${deuda.monto > 0 && html`<span className="num" style=${{ color: "var(--peligro)", fontWeight: 700 }}>${soles(deuda.monto)} vencido</span>`}
                </div>
              </div>
              <${Leyenda} />
              <${CuadroAnual} registros=${registros} anio=${anio}
                onCelda=${editable ? (concepto, mes) => setPanel({ stand: stand.codigo, concepto, mes }) : null} />
              ${editable && html`<p className="ayuda">Toca una cuota vencida o pendiente para registrar su pago.</p>`}
            </div>`
          : html`<${Vacio}>Aún no hay stands registrados.<//>`}
      </section>

      <div className="rejilla r-2">
        <${Tarjeta} titulo="Morosidad por galería" sub=${`Cuotas vencidas hasta ${h.mes > 1 ? "el mes pasado" : "hoy"}`} sinCuerpo>
          <div className="tabla-caja" style=${{ marginTop: 10 }}>
            <table className="tabla">
              <thead><tr><th>Galería</th><th className="der">Stands morosos</th><th className="der">Deuda</th></tr></thead>
              <tbody>
                ${moro.filas.map((f) => html`<tr key=${f.id}><td>${f.nombre}</td><td className="der num">${f.morosos}</td><td className="der num">${soles(f.deuda)}</td></tr>`)}
                <tr><td className="fuerte">Total por cobrar</td><td className="der num fuerte">${moro.morosos}</td><td className="der num fuerte" style=${{ color: "var(--peligro)" }}>${soles(moro.total)}</td></tr>
              </tbody>
            </table>
          </div>
        <//>
        <${Tarjeta} titulo="Mayores deudas" sub="Toca para ver su cuadro" sinCuerpo>
          <div className="tabla-caja" style=${{ marginTop: 10 }}>
            <table className="tabla">
              <tbody>
                ${morosos.slice(0, 8).map((m) => html`<tr key=${m.stand.codigo} className="clic" onClick=${() => ir(`pagos-${m.stand.codigo}`)}>
                  <td className="fuerte num">${m.stand.codigo}</td>
                  <td>${nombreCompleto(porId.get(m.stand.propietarioId))}</td>
                  <td><${BadgeAtraso} meses=${m.deuda.meses} /></td>
                  <td className="der num">${soles(m.deuda.monto)}</td>
                </tr>`)}
              </tbody>
            </table>
            ${!morosos.length && html`<${Vacio}>Todos los stands están al día.<//>`}
          </div>
        <//>
      </div>
      ${panel && html`<${PanelPago} inicial=${{ ...panel, anio }} stands=${ordenados} onCerrar=${() => setPanel(null)} />`}
    </div>`;
}
