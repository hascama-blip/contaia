// Plano interactivo del C.C.: cada stand se colorea según el modo elegido;
// al pasar el cursor (o tocar en el celular) aparece una burbuja con el resumen
// y el enlace "Ver detalle" a la ficha del asociado.
import { html, useState, useRef, useMemo, useEffect, useCallback } from "./html.js";
import { BadgeCenso, BadgeAtraso, BadgeStand } from "./ui.js";
import { useApp } from "./contexto.js";
import { PLANO } from "../plano.js";
import { standsDelPlano, tonoStand, LEYENDAS, ZOOMS } from "../lib/plano.js";
import { nombreCompleto, nombreGaleria, galeriaDeCodigo } from "../lib/padron.js";
import { registrosDe, deudaStand } from "../lib/pagos.js";
import { soles } from "../lib/formato.js";

const CELDAS = standsDelPlano(PLANO);
const ROTULO = { calle: "pl-calle", pasaje: "pl-pasaje", ambiente: "pl-texto-ambiente" };

/**
 * @param {object} p
 * @param {"censo"|"pagos"|"ocupacion"} p.modo
 * @param {Set<string>|null} p.resaltar  códigos a resaltar (los demás se atenúan); null = todos
 * @param {string|null} p.enfocar         código a abrir automáticamente (búsqueda con un solo resultado)
 * @param {(codigo:string)=>void} [p.onVerificar]
 */
export function Plano({ modo, resaltar, enfocar, onVerificar }) {
  const { datos, derivados, puedeEscribir } = useApp();
  const caja = useRef(null);
  const svg = useRef(null);
  const cierre = useRef(null);
  const [activo, setActivo] = useState(null); // { codigo, izq, arriba, abajo }
  const [fijo, setFijo] = useState(false);
  const [zoom, setZoom] = useState(0);

  const porCodigo = useMemo(() => new Map(datos.stands.map((s) => [s.codigo, s])), [datos.stands]);
  const info = useCallback((codigo) => {
    const stand = porCodigo.get(codigo);
    const asociado = stand && derivados.porId.get(stand.propietarioId);
    const deuda = stand && asociado ? deudaStand(registrosDe(derivados.indicePagos, codigo, derivados.h.anio), derivados.h.anio, derivados.h) : null;
    return { stand, asociado, deuda };
  }, [porCodigo, derivados]);

  const fueraDelPlano = useMemo(() => {
    const enPlano = new Set(CELDAS.map((c) => c.codigo));
    return datos.stands.filter((s) => !enPlano.has(s.codigo)).map((s) => s.codigo);
  }, [datos.stands]);

  const conteo = useMemo(() => {
    const c = {};
    for (const celda of CELDAS) {
      const t = tonoStand(modo, info(celda.codigo));
      c[t] = (c[t] || 0) + 1;
    }
    return c;
  }, [modo, info]);

  const posicion = (el) => {
    const r = el.getBoundingClientRect();
    const w = caja.current.getBoundingClientRect();
    const izq = Math.min(Math.max(r.left - w.left + r.width / 2, 140), w.width - 140);
    const abajo = r.top - w.top < 190;
    return { izq, arriba: abajo ? r.bottom - w.top + 8 : r.top - w.top - 8, abajo };
  };
  const abrir = (codigo, el) => {
    clearTimeout(cierre.current);
    setActivo({ codigo, ...posicion(el) });
  };
  const programarCierre = () => {
    if (fijo) return;
    clearTimeout(cierre.current);
    cierre.current = setTimeout(() => setActivo(null), 220);
  };
  const cerrar = () => { setFijo(false); setActivo(null); };

  // Búsqueda con un solo resultado: abre su burbuja.
  useEffect(() => {
    if (!enfocar || !svg.current) return;
    setZoom((z) => Math.max(z, 1));
    // Espera a que el plano se agrande para centrar el stand y abrir su burbuja.
    const t = setTimeout(() => {
      const el = svg.current?.querySelector(`[data-codigo="${enfocar}"]`);
      if (!el) return;
      el.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
      setTimeout(() => { setFijo(true); abrir(enfocar, el); }, 350);
    }, 60);
    return () => clearTimeout(t);
  }, [enfocar]);

  // En pantallas angostas el plano se desliza: se abre centrado en las galerías, no en la calle.
  useEffect(() => {
    const scroller = caja.current?.parentElement;
    if (scroller && scroller.scrollWidth > scroller.clientWidth) scroller.scrollLeft = (scroller.scrollWidth - scroller.clientWidth) * 0.55;
  }, []);

  // Al acercar o alejar, se mantiene el centro de lo que se estaba viendo.
  const cambiarZoom = (nuevo) => {
    const scroller = caja.current?.parentElement;
    const centro = scroller ? (scroller.scrollLeft + scroller.clientWidth / 2) / scroller.scrollWidth : 0.5;
    cerrar();
    setZoom(nuevo);
    requestAnimationFrame(() => { if (scroller) scroller.scrollLeft = centro * scroller.scrollWidth - scroller.clientWidth / 2; });
  };

  const burbuja = activo && (() => {
    const { stand, asociado, deuda } = info(activo.codigo);
    const estilo = { left: activo.izq, top: activo.arriba, transform: activo.abajo ? "translate(-50%, 0)" : "translate(-50%, -100%)" };
    return html`
      <div className="burbuja" style=${estilo} role="dialog" aria-label=${`Stand ${activo.codigo}`}
        onMouseEnter=${() => clearTimeout(cierre.current)} onMouseLeave=${programarCierre}>
        <div className="burbuja-cab">
          <strong className="num">${activo.codigo}</strong>
          <span className="muted">${nombreGaleria(galeriaDeCodigo(activo.codigo))}</span>
          ${fijo && html`<button className="cerrar" style=${{ marginLeft: "auto", fontSize: "1.05rem" }} aria-label="Cerrar" onClick=${cerrar}>×</button>`}
        </div>
        ${asociado
          ? html`
            <p className="burbuja-nombre">${nombreCompleto(asociado)}</p>
            <p className="burbuja-dato">DNI ${asociado.dni}${stand.giro ? ` · ${stand.giro}` : ""}</p>
            <div className="burbuja-badges">
              <${BadgeCenso} estado=${asociado.censo?.estado || "pendiente"} />
              <${BadgeAtraso} meses=${deuda?.meses || 0} />
              <${BadgeStand} estado=${stand.estado} />
            </div>
            ${deuda?.monto > 0 && html`<p className="burbuja-dato">Deuda vencida: <strong style=${{ color: "var(--peligro)" }}>${soles(deuda.monto)}</strong></p>`}
            ${stand.inquilino?.nombre && html`<p className="burbuja-dato">Inquilino: ${stand.inquilino.nombre}</p>`}
            ${stand.historial?.length > 0 && html`<p className="burbuja-dato">${stand.historial.length + 1}.º propietario · antes: ${stand.historial[stand.historial.length - 1].nombre}</p>`}
            <div className="burbuja-acciones">
              <a className="btn btn-primary btn-sm" href=${`#ficha-${asociado.id}`}>Ver detalle</a>
              ${onVerificar && puedeEscribir !== false && html`<button className="btn btn-ghost btn-sm" onClick=${() => { cerrar(); onVerificar(activo.codigo); }}>Verificar aquí</button>`}
            </div>`
          : html`
            <p className="burbuja-dato">Stand sin ficha en el padrón.</p>
            ${puedeEscribir !== false && html`<div className="burbuja-acciones"><a className="btn btn-primary btn-sm" href=${`#nueva-${activo.codigo}`}>Registrar ficha</a></div>`}`}
      </div>`;
  })();

  return html`
    <div className="plano-azul">
      <div className="plano-barra">
        <p className="aviso-deslizar">Toca un stand para ver su resumen. Acerca el plano para leer mejor los números.</p>
        <div className="segmentos en-linea zoom" role="group" aria-label="Tamaño del plano">
          <button type="button" disabled=${zoom === 0} onClick=${() => cambiarZoom(zoom - 1)}>− Alejar</button>
          <button type="button" disabled=${zoom === ZOOMS.length - 1} onClick=${() => cambiarZoom(zoom + 1)}>+ Acercar</button>
        </div>
      </div>
      <div className="plano-caja">
        <div className="plano-lienzo" ref=${caja} style=${{ width: `${ZOOMS[zoom] * 100}%` }}>
          <svg ref=${svg} viewBox=${`0 0 ${PLANO.ancho} ${PLANO.alto}`} className="plano" role="img"
            aria-label="Plano del centro comercial con los stands coloreados por estado"
            onClick=${(e) => e.target === e.currentTarget && cerrar()}>
            <path d=${PLANO.fondo} className="pl-fondo" />
            ${PLANO.salidas.map((pts, i) => html`<polygon key=${`s${i}`} points=${pts} className="pl-salida"><title>Salida de emergencia</title></polygon>`)}
            ${PLANO.rotulos.map((r, i) => html`<text key=${`r${i}`} transform=${`translate(${r.x} ${r.y}) rotate(${r.giro})`} className=${ROTULO[r.tipo]}>${r.texto}</text>`)}
            ${CELDAS.map((c) => {
              const tono = tonoStand(modo, info(c.codigo));
              const atenuado = resaltar && !resaltar.has(c.codigo);
              return html`
                <g key=${c.codigo} data-codigo=${c.codigo} tabIndex="0" role="button" aria-label=${`Stand ${c.codigo}`}
                  className=${`pl-stand pl-${tono}${atenuado ? " pl-atenuado" : ""}${activo?.codigo === c.codigo ? " pl-activo" : ""}`}
                  onMouseEnter=${(e) => !fijo && abrir(c.codigo, e.currentTarget)}
                  onMouseLeave=${programarCierre}
                  onFocus=${(e) => abrir(c.codigo, e.currentTarget)}
                  onClick=${(e) => { setFijo(true); abrir(c.codigo, e.currentTarget); }}
                  onKeyDown=${(e) => {
                    if (e.key === "Enter") { const a = info(c.codigo).asociado; location.hash = a ? `ficha-${a.id}` : `nueva-${c.codigo}`; }
                    if (e.key === "Escape") cerrar();
                  }}>
                  <polygon points=${c.puntos} />
                  <text x=${c.x} y=${c.y} className="pl-codigo">${c.codigo}</text>
                </g>`;
            })}
            ${PLANO.salidas.map((pts, i) => {
              const xy = pts.split(" ").map((p) => p.split(",").map(Number));
              const cx = xy.reduce((a, p) => a + p[0], 0) / xy.length, cy = xy.reduce((a, p) => a + p[1], 0) / xy.length;
              return html`<text key=${`st${i}`} x=${cx} y=${cy} className="pl-texto-salida">SALIDA</text>`;
            })}
            ${PLANO.etiquetas.map((e, i) => html`<g key=${`e${i}`} className="pl-galeria" aria-hidden="true">
              <circle cx=${e.x} cy=${e.y} r="13" /><text x=${e.x} y=${e.y}>${e.galeria}</text>
            </g>`)}
          </svg>
          ${burbuja}
        </div>
      </div>
      <div className="leyenda" style=${{ marginTop: 12 }}>
        ${LEYENDAS[modo].map(([tono, texto]) => html`<span key=${tono}><i className=${`ley-${tono}`}></i>${texto} <span className="num muted">${conteo[tono] || 0}</span></span>`)}
        <span><i className="ley-salida"></i>Salida de emergencia</span>
      </div>
      ${fueraDelPlano.length > 0 && html`<p className="ayuda" style=${{ marginTop: 8 }}>Registrados pero sin ubicación en el plano: ${fueraDelPlano.join(", ")}.</p>`}
    </div>`;
}
