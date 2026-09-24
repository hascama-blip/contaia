// Plano interactivo del C.C.: cada stand se colorea según el modo elegido;
// al pasar el cursor (o tocar en el celular) aparece una burbuja con el resumen
// y el enlace "Ver detalle" a la ficha del asociado.
import { html, useState, useRef, useMemo, useEffect, useCallback } from "./html.js";
import { BadgeCenso, BadgeAtraso, BadgeStand } from "./ui.js";
import { useApp } from "./contexto.js";
import { PLANO } from "../plano.js";
import { standsDelPlano, corredoresDelPlano, tonoStand, LEYENDAS } from "../lib/plano.js";
import { nombreCompleto, nombreGaleria } from "../lib/padron.js";
import { registrosDe, deudaStand } from "../lib/pagos.js";
import { soles } from "../lib/formato.js";

const CELDAS = standsDelPlano(PLANO);
const CORREDORES = corredoresDelPlano(PLANO);

function Mesas({ x, y, w, h }) {
  const puntos = [];
  for (let cx = x + 30; cx < x + w - 10; cx += 56) {
    for (let cy = y + 18; cy < y + h - 6; cy += 34) puntos.push([cx, cy]);
  }
  return html`<g aria-hidden="true">${puntos.map(([cx, cy]) => html`<circle key=${`${cx}-${cy}`} cx=${cx} cy=${cy} r="9" className="pl-mesa" />`)}</g>`;
}

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
    const el = svg.current.querySelector(`[data-codigo="${enfocar}"]`);
    if (el) { setFijo(true); abrir(enfocar, el); }
  }, [enfocar]);

  const burbuja = activo && (() => {
    const { stand, asociado, deuda } = info(activo.codigo);
    const estilo = { left: activo.izq, top: activo.arriba, transform: activo.abajo ? "translate(-50%, 0)" : "translate(-50%, -100%)" };
    return html`
      <div className="burbuja" style=${estilo} role="dialog" aria-label=${`Stand ${activo.codigo}`}
        onMouseEnter=${() => clearTimeout(cierre.current)} onMouseLeave=${programarCierre}>
        <div className="burbuja-cab">
          <strong className="num">${activo.codigo}</strong>
          <span className="muted">${nombreGaleria(activo.codigo.split("-")[0])}</span>
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
            <div className="burbuja-acciones">
              <a className="btn btn-primary btn-sm" href=${`#ficha-${asociado.id}`}>Ver detalle</a>
              ${onVerificar && puedeEscribir !== false && html`<button className="btn btn-ghost btn-sm" onClick=${() => { cerrar(); onVerificar(activo.codigo); }}>Censar aquí</button>`}
            </div>`
          : html`
            <p className="burbuja-dato">Stand sin ficha en el padrón.</p>
            ${puedeEscribir !== false && html`<div className="burbuja-acciones"><a className="btn btn-primary btn-sm" href=${`#nueva-${activo.codigo}`}>Registrar ficha</a></div>`}`}
      </div>`;
  })();

  return html`
    <div>
      <div className="plano-caja">
        <div className="plano-lienzo" ref=${caja}>
          <svg ref=${svg} viewBox=${`0 0 ${PLANO.ancho} ${PLANO.alto}`} className="plano" role="img"
            aria-label="Plano del centro comercial con los stands coloreados por estado"
            onClick=${(e) => e.target === e.currentTarget && cerrar()}>
            <rect x=${PLANO.muro.x} y=${PLANO.muro.y} width=${PLANO.muro.w} height=${PLANO.muro.h} rx="6" className="pl-muro" />
            ${PLANO.zonas.map((z, i) => z.tipo === "mesas"
              ? html`<${Mesas} key=${`z${i}`} ...${z} />`
              : html`<g key=${`z${i}`}>
                  <rect x=${z.x} y=${z.y} width=${z.w} height=${z.h} className=${z.tipo === "pasillo" ? "pl-pasillo" : "pl-ambiente"} />
                  ${z.texto && html`<text x=${z.tx ?? z.x + z.w / 2} y=${z.ty ?? z.y + z.h / 2} className=${z.tipo === "pasillo" ? "pl-texto-pasillo" : "pl-texto-ambiente"}>${z.texto}</text>`}
                </g>`)}
            ${CORREDORES.map((c) => html`<g key=${`c${c.galeria}`}>
              <rect x=${c.pasillo.x} y=${c.pasillo.y} width=${c.pasillo.w} height=${c.pasillo.h} className="pl-pasillo" />
              <text x=${c.rotulo.x} y=${c.rotulo.y} className="pl-rotulo">${nombreGaleria(c.galeria)}</text>
            </g>`)}
            ${PLANO.bloques.filter((b) => b.etiqueta).map((b) => html`<text key=${`e${b.galeria}`} x=${b.etiqueta.x} y=${b.etiqueta.y} className="pl-rotulo">${nombreGaleria(b.galeria)}</text>`)}
            ${PLANO.ingresos.map((g) => {
              const x = g.lado === "izquierda" ? PLANO.muro.x : PLANO.muro.x + PLANO.muro.w;
              return html`<g key=${g.texto}>
                <line x1=${x} y1=${g.y} x2=${x} y2=${g.y + g.h} className="pl-ingreso" />
                <text x=${g.lado === "izquierda" ? 24 : PLANO.muro.x + PLANO.muro.w - 14} y=${g.y + g.h / 2 + 4}
                  className="pl-texto-ingreso" textAnchor=${g.lado === "izquierda" ? "start" : "end"}>${g.lado === "izquierda" ? `→ ${g.texto}` : `${g.texto} ←`}</text>
              </g>`;
            })}
            ${CELDAS.map((c) => {
              const tono = tonoStand(modo, info(c.codigo));
              const atenuado = resaltar && !resaltar.has(c.codigo);
              const grande = c.w >= 70;
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
                  <rect x=${c.x + 1.5} y=${c.y + 1.5} width=${c.w - 3} height=${c.h - 3} rx="4" />
                  <text x=${c.x + c.w / 2} y=${c.y + c.h / 2 + (grande ? -2 : 4)} className="pl-codigo">${c.codigo}</text>
                  ${grande && html`<text x=${c.x + c.w / 2} y=${c.y + c.h / 2 + 13} className="pl-sub">${(porCodigo.get(c.codigo)?.giro || "").slice(0, 14)}</text>`}
                </g>`;
            })}
          </svg>
          ${burbuja}
        </div>
      </div>
      <div className="leyenda" style=${{ marginTop: 12 }}>
        ${LEYENDAS[modo].map(([tono, texto]) => html`<span key=${tono}><i className=${`ley-${tono}`}></i>${texto} <span className="num muted">${conteo[tono] || 0}</span></span>`)}
      </div>
      ${fueraDelPlano.length > 0 && html`<p className="ayuda" style=${{ marginTop: 8 }}>Registrados pero sin ubicación en el plano: ${fueraDelPlano.join(", ")}.</p>`}
    </div>`;
}
