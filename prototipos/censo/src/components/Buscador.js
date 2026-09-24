// Buscador con sugerencias (combobox): reemplaza a los desplegables largos.
// Escribe DNI, nombre, N° de asociado o stand y elige de la lista.
import { html, useState, useMemo, useRef } from "./html.js";
import { normalizar, nombreCompleto, ordenarPorNumero } from "../lib/padron.js";

const MAX = 8;

/**
 * @param {object} p
 * @param {string} p.id
 * @param {{ valor:string, titulo:string, detalle?:string, pajar:string }[]} p.opciones
 * @param {string} p.valor                 opción elegida
 * @param {(valor:string)=>void} p.onElegir
 * @param {string} [p.placeholder]
 * @param {string} [p.error]
 */
export function Buscador({ id, opciones, valor, onElegir, placeholder = "Buscar…", error }) {
  const [texto, setTexto] = useState("");
  const [abierto, setAbierto] = useState(false);
  const [cursor, setCursor] = useState(0);
  const cierre = useRef(null);
  const elegida = opciones.find((o) => o.valor === valor);

  const resultados = useMemo(() => {
    const partes = normalizar(texto).split(/\s+/).filter(Boolean);
    if (!partes.length) return [];
    return opciones.filter((o) => partes.every((p) => o.pajar.includes(p))).slice(0, MAX);
  }, [texto, opciones]);

  const elegir = (o) => {
    onElegir(o.valor);
    setTexto("");
    setAbierto(false);
  };

  if (elegida && !abierto) {
    return html`
      <div className="buscador-elegido">
        <div style=${{ minWidth: 0 }}>
          <span className="buscador-titulo">${elegida.titulo}</span>
          ${elegida.detalle && html`<span className="buscador-detalle">${elegida.detalle}</span>`}
        </div>
        <button type="button" className="enlace-btn" onClick=${() => { onElegir(""); setAbierto(true); }}>Cambiar</button>
      </div>`;
  }

  const lista = `${id}-lista`;
  return html`
    <div className="buscador">
      <input id=${id} className="input" type="search" role="combobox" autoComplete="off"
        aria-expanded=${abierto && resultados.length > 0} aria-controls=${lista} aria-autocomplete="list"
        aria-invalid=${error ? "true" : undefined}
        aria-activedescendant=${abierto && resultados[cursor] ? `${id}-op-${cursor}` : undefined}
        placeholder=${placeholder} value=${texto}
        onChange=${(e) => { setTexto(e.target.value); setCursor(0); setAbierto(true); }}
        onFocus=${() => { clearTimeout(cierre.current); setAbierto(true); }}
        onBlur=${() => { cierre.current = setTimeout(() => setAbierto(false), 150); }}
        onKeyDown=${(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(c + 1, resultados.length - 1)); }
          if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
          if (e.key === "Enter" && resultados[cursor]) { e.preventDefault(); elegir(resultados[cursor]); }
          if (e.key === "Escape") setAbierto(false);
        }} />
      ${abierto && texto.trim() && html`
        <ul id=${lista} className="buscador-lista" role="listbox">
          ${resultados.map((o, i) => html`
            <li key=${o.valor} id=${`${id}-op-${i}`} role="option" aria-selected=${i === cursor}
              className=${i === cursor ? "activo" : ""}
              onMouseDown=${(e) => { e.preventDefault(); elegir(o); }} onMouseEnter=${() => setCursor(i)}>
              <span className="buscador-titulo">${o.titulo}</span>
              ${o.detalle && html`<span className="buscador-detalle">${o.detalle}</span>`}
            </li>`)}
          ${!resultados.length && html`<li className="buscador-vacio">Nada coincide con "${texto}". Prueba con el DNI o el código del stand (A-03).</li>`}
        </ul>`}
    </div>`;
}

/** Opciones de asociados: buscar por N°, DNI, apellidos, nombres o stand. */
export function opcionesAsociados(asociados, mapaStands) {
  return ordenarPorNumero(asociados).map((a) => {
    const suyos = (mapaStands.get(a.id) || []).map((s) => s.codigo);
    return {
      valor: a.id,
      titulo: nombreCompleto(a),
      detalle: `N° ${a.numero} · DNI ${a.dni}${suyos.length ? ` · ${suyos.join(", ")}` : ""}`,
      pajar: normalizar(`${a.numero} ${a.dni} ${a.nombres} ${a.apellidoPaterno} ${a.apellidoMaterno} ${suyos.join(" ")} ${suyos.map((c) => c.replace("-", "")).join(" ")}`),
    };
  });
}

/** Opciones de stands: buscar por código, propietario, DNI o giro. */
export function opcionesStands(stands, porId) {
  return stands.map((s) => {
    const a = porId.get(s.propietarioId);
    return {
      valor: s.codigo,
      titulo: `${s.codigo} · ${a ? nombreCompleto(a) : "Sin propietario"}`,
      detalle: [a && `DNI ${a.dni}`, s.giro].filter(Boolean).join(" · "),
      pajar: normalizar(`${s.codigo} ${s.codigo.replace("-", "")} ${a ? `${a.dni} ${a.nombres} ${a.apellidoPaterno} ${a.apellidoMaterno} ${a.numero}` : ""} ${s.giro || ""}`),
    };
  });
}
