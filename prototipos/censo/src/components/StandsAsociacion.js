// Marcar stands como propios de la Asociación, de a muchos: desde el Excel de revisión del libro
// (filas que dicen "STAND DE LA ASOCIACION") o pegando los números. Primero muestra qué pasará.
import { html, useState, useMemo } from "./html.js";
import { Panel, Badge, Barra } from "./ui.js";
import { useApp } from "./contexto.js";
import { leerPrimeraHoja } from "../lib/xlsx.js";
import { standsDesdeFilas, standsDesdeTexto, planAsociacion } from "../lib/standsAsociacion.js";
import { marcarStandsAsociacion } from "../api/stands.js";

const TONO = { crear: "asoc", marcar: "asoc", dueno: "alerta", ya: "neutro" };
const TEXTO = { crear: "Se crea", marcar: "Se marca", dueno: "Tenía dueño", ya: "Ya estaba" };

export function PanelStandsAsociacion({ onCerrar }) {
  const { datos, derivados, usuario, avisar } = useApp();
  const [items, setItems] = useState([]);
  const [origen, setOrigen] = useState("");
  const [texto, setTexto] = useState("");
  const [aviso, setAviso] = useState("");
  const [avance, setAvance] = useState(null);
  const [hecho, setHecho] = useState(null);
  const plan = useMemo(() => planAsociacion(items, datos.stands, derivados.porId), [items, datos.stands, derivados.porId]);
  const pendientes = plan.filter((p) => p.accion !== "ya");

  async function cargarExcel(e) {
    const archivo = e.target.files?.[0];
    e.target.value = "";
    if (!archivo) return;
    setAviso(""); setHecho(null);
    try {
      const lista = standsDesdeFilas(await leerPrimeraHoja(archivo));
      if (!lista.length) { setItems([]); setAviso("El Excel no tiene filas que digan «STAND DE LA ASOCIACION» con un número de stand del plano."); return; }
      setItems(lista); setOrigen(archivo.name);
    } catch (err) { setAviso(err?.message || "No se pudo leer el Excel."); }
  }
  function usarTexto() {
    const { items: lista, invalidos } = standsDesdeTexto(texto);
    setHecho(null); setItems(lista); setOrigen("");
    setAviso(invalidos.length ? `No reconozco: ${invalidos.join(", ")} (usa el número del plano, 1001 a 1405).` : "");
  }
  async function aplicar() {
    const conDueno = plan.filter((p) => p.accion === "dueno").length;
    if (!confirm(`Se marcarán ${pendientes.length} stands como de la asociación${conDueno ? `; ${conDueno} figuraban a nombre de un asociado, que pasa al historial del stand` : ""}. ¿Continuar?`)) return;
    setAvance({ hechos: 0, total: pendientes.length });
    const r = await marcarStandsAsociacion(pendientes.map(({ codigo, nota }) => ({ codigo, nota })), {
      asociados: datos.asociados, por: usuario?.id, documento: origen ? `Revisión del libro (${origen})` : "",
      onAvance: (hechos, total) => setAvance({ hechos, total }),
    });
    setAvance(null); setHecho(r);
    avisar(r.errores.length ? `Marcados ${r.marcados}; ${r.errores.length} con error.` : `Listo: ${r.marcados} stands marcados como de la asociación.`, r.errores.length ? "error" : "ok");
  }

  return html`
    <${Panel} titulo="Stands de la asociación" onCerrar=${avance ? () => {} : onCerrar}
      pie=${html`<button className="btn btn-ghost" disabled=${!!avance} onClick=${onCerrar}>Cerrar</button>
        ${!hecho && html`<button className="btn btn-primary" disabled=${!pendientes.length || !!avance} onClick=${aplicar}>${avance ? `Marcando ${avance.hechos} de ${avance.total}…` : `Marcar ${pendientes.length} stands`}</button>`}`}>
      <p className="ayuda" style=${{ marginTop: 0 }}>
        Un stand de la asociación no tiene a un asociado como dueño: en Stands, el plano y los reportes figura como
        <b> Asociación (stand propio)</b>. Si figuraba a nombre de un asociado, ese asociado pasa al historial del stand (no se borra)
        y su ficha queda «por revisar».
      </p>
      <label className="btn btn-ghost" style=${{ cursor: "pointer" }}>Cargar Excel de revisión del libro (.xlsx)…
        <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr" onChange=${cargarExcel} disabled=${!!avance} /></label>
      <p className="ayuda">Toma las filas que dicen «STAND DE LA ASOCIACION». También puedes pegar los números:</p>
      <div style=${{ display: "flex", gap: 8 }}>
        <input className="input" value=${texto} onChange=${(e) => setTexto(e.target.value)} placeholder="1014, 1015, 1019…" aria-label="Números de stand" />
        <button className="btn btn-ghost" disabled=${!texto.trim() || !!avance} onClick=${usarTexto}>Revisar</button>
      </div>
      ${aviso && html`<div className="aviso aviso-alerta" style=${{ marginTop: 10 }}><span>${aviso}</span></div>`}
      ${avance && html`<div style=${{ marginTop: 10 }}><${Barra} pct=${Math.round((avance.hechos / Math.max(1, avance.total)) * 100)} tono="ok" /></div>`}
      ${hecho && html`<div className=${`aviso ${hecho.errores.length ? "aviso-alerta" : "aviso-ok"}`} style=${{ marginTop: 10 }}><span>
        <b>Guardado.</b> ${hecho.marcados} stands marcados${hecho.creados ? ` (${hecho.creados} creados)` : ""}${hecho.conDueno ? ` · ${hecho.conDueno} con dueño anterior en el historial` : ""}${hecho.yaEstaban ? ` · ${hecho.yaEstaban} ya estaban` : ""}.
        ${hecho.errores.length ? html`<br />${hecho.errores.join(" · ")}` : ""}</span></div>`}
      ${plan.length > 0 && html`
        <p className="ayuda" style=${{ marginTop: 12 }}>${origen ? html`Archivo <b>${origen}</b>: ` : ""}${plan.length} stands · ${pendientes.length} por marcar${plan.length - pendientes.length ? ` · ${plan.length - pendientes.length} ya estaban` : ""}.</p>
        <div className="tabla-caja"><table className="tabla">
          <thead><tr><th>Stand</th><th>En el libro</th><th>Qué pasa</th></tr></thead>
          <tbody>${plan.map((p) => html`<tr key=${p.codigo}>
            <td className="fuerte num">${p.codigo}</td>
            <td>${p.nota || html`<span className="muted">—</span>`}</td>
            <td><${Badge} tono=${TONO[p.accion]}>${TEXTO[p.accion]}<//><span className="celda-sub">${p.texto}</span></td>
          </tr>`)}</tbody>
        </table></div>`}
    <//>`;
}
