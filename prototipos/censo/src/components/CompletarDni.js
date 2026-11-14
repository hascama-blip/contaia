// Completar la columna DNI de un Excel con los datos del padrón: se sube el .xlsx, se revisa
// qué DNI corresponde a cada nombre y se descarga el MISMO archivo con la columna llena.
import { html, useState, useMemo } from "./html.js";
import { Panel, Badge } from "./ui.js";
import { useApp } from "./contexto.js";
import { leerLibro, ponerCeldasTexto } from "../lib/xlsx.js";
import { crearZip } from "../lib/zip.js";
import { descargar } from "../lib/exportar.js";
import { indicePersonas, planCompletarDni } from "../lib/completarDni.js";

const TONO = { exacto: "ok", aproximado: "alerta", varios: "peligro", sin_dni: "neutro", no: "neutro" };
const TEXTO = { exacto: "Encontrado", aproximado: "Parecido: revisar", varios: "Varias personas", sin_dni: "Sin DNI en el padrón", no: "No figura" };
const ORDEN = { varios: 0, aproximado: 1, no: 2, sin_dni: 3, exacto: 4 };

export function PanelCompletarDni({ onCerrar }) {
  const { datos, avisar } = useApp();
  const [libro, setLibro] = useState(null); // { nombre, partes, hojas }
  const [error, setError] = useState("");
  const [conParecidos, setConParecidos] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const indice = useMemo(() => indicePersonas(datos), [datos.asociados, datos.stands]);
  const plan = useMemo(() => (libro ? planCompletarDni(libro.hojas, indice) : null), [libro, indice]);
  const celdasDe = (h) => [...h.celdas].filter(([, v]) => conParecidos || v.estado === "exacto");
  const porLlenar = plan ? plan.hojas.reduce((n, h) => n + celdasDe(h).length, 0) : 0;

  async function cargar(e) {
    const archivo = e.target.files?.[0];
    e.target.value = "";
    if (!archivo) return;
    setError(""); setLibro(null);
    try {
      const l = await leerLibro(archivo);
      const p = planCompletarDni(l.hojas, indice);
      if (!p.hojas.length) throw new Error("No encontré una columna titulada «DNI» con los nombres en la columna de su izquierda.");
      setLibro({ nombre: archivo.name, ...l });
    } catch (err) { setError(err?.message || "No se pudo leer el Excel."); }
  }

  async function bajar() {
    setOcupado(true);
    try {
      const dec = new TextDecoder(), cod = new TextEncoder();
      const partes = new Map(libro.partes);
      for (const h of plan.hojas) {
        const celdas = new Map(celdasDe(h).map(([ref, v]) => [ref, v.dni]));
        if (celdas.size) partes.set(h.ruta, cod.encode(ponerCeldasTexto(dec.decode(partes.get(h.ruta)), celdas)));
      }
      const zip = await crearZip([...partes].map(([nombre, d]) => ({ nombre, datos: d })));
      const salida = new Blob([zip], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      await descargar(libro.nombre.replace(/\.xlsx$/i, "") + " - con DNI.xlsx", salida);
      avisar(`Excel descargado con ${porLlenar} celdas de DNI llenas.`);
    } catch (err) { avisar(err?.message || "No se pudo generar el Excel.", "error"); }
    finally { setOcupado(false); }
  }

  const r = plan?.resumen;
  const filas = plan ? [...plan.nombres].sort((a, b) => ORDEN[a.estado] - ORDEN[b.estado] || a.texto.localeCompare(b.texto)) : [];
  return html`
    <${Panel} titulo="Completar DNI en un Excel" onCerrar=${onCerrar}
      pie=${html`<button className="btn btn-ghost" onClick=${onCerrar}>Cerrar</button>
        ${plan && html`<button className="btn btn-primary" disabled=${!porLlenar || ocupado} onClick=${bajar}>${ocupado ? "Generando…" : `Descargar Excel con DNI (${porLlenar} celdas)`}</button>`}`}>
      <p className="ayuda" style=${{ marginTop: 0 }}>
        Sube un Excel que tenga una columna titulada <b>DNI</b> con los nombres en la columna de su izquierda. Cada nombre se busca en el
        padrón (asociados, inquilinos, cónyuges e hijos; no importa el orden de nombres y apellidos, las tildes ni el prefijo «APCCIC-») y
        se descarga el mismo archivo con el DNI escrito. Lo que ya tenía DNI no se cambia.
      </p>
      <label className="btn btn-ghost" style=${{ cursor: "pointer" }}>${libro ? "Cargar otro Excel…" : "Cargar Excel (.xlsx)…"}
        <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr" onChange=${cargar} /></label>
      ${error && html`<div className="aviso aviso-alerta" style=${{ marginTop: 10 }}><span>${error}</span></div>`}
      ${plan && html`
        <div className="aviso aviso-info" style=${{ marginTop: 12 }}><span>
          <b>${libro.nombre}</b> · ${plan.hojas.map((h) => `hoja «${h.nombre}», columna ${h.columna}`).join(" · ")}.<br />
          ${r.personas} personas: <b>${r.exactos}</b> encontradas${r.aproximados ? html` · <b>${r.aproximados}</b> parecidas (revisar)` : ""}${r.varios ? ` · ${r.varios} con varias personas posibles` : ""}${r.sinDni ? ` · ${r.sinDni} sin DNI en el padrón` : ""} · <b>${r.noFiguran}</b> no figuran.</span></div>
        ${r.aproximados > 0 && html`<label className="check" style=${{ marginTop: 10 }}><input type="checkbox" checked=${conParecidos} onChange=${(e) => setConParecidos(e.target.checked)} /> Llenar también las ${r.aproximados} parecidas (nombre casi igual: revísalas en la tabla)</label>`}
        <div className="tabla-caja" style=${{ marginTop: 10 }}><table className="tabla">
          <thead><tr><th>Nombre en el Excel</th><th>DNI</th><th>En el padrón</th></tr></thead>
          <tbody>${filas.map((n) => html`<tr key=${n.texto}>
            <td>${n.texto}${n.veces > 1 ? html`<span className="celda-sub">${n.veces} filas</span>` : ""}</td>
            <td className="num fuerte">${n.dni && (conParecidos || n.estado === "exacto") ? n.dni : "—"}</td>
            <td><${Badge} tono=${TONO[n.estado]}>${TEXTO[n.estado]}<//>
              ${n.persona && html`<span className="celda-sub">${n.persona.nombre} · ${n.persona.fuente}${n.persona.detalle ? ` (${n.persona.detalle})` : ""}</span>`}
              ${n.candidatos && html`<span className="celda-sub">${n.candidatos.map((c) => `${c.nombre} (${c.dni})`).join(" · ")}</span>`}
              ${n.yaTenia > 0 && html`<span className="celda-sub">${n.yaTenia} fila(s) ya tenían DNI: no se cambian</span>`}</td>
          </tr>`)}</tbody>
        </table></div>`}
    <//>`;
}
