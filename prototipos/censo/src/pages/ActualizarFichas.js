// Actualizar el padrón con fichas del libro (archivo JSON con la transcripción y la foto de
// cada ficha). Primero muestra la revisión sin guardar; con «Aplicar» guarda todo: datos,
// fichas nuevas, traspasos (el anterior queda en el historial) y la foto como documento.
// Solo el administrador principal (como Respaldo e importación).
import { html, useState } from "../components/html.js";
import { CabPagina, Badge, Barra } from "../components/ui.js";
import { useApp } from "../components/contexto.js";
import { leerArchivoFichas, procesarFichas, copiarEstado, opsSimuladas, resumir } from "../lib/actualizarFichas.js";
import { aplicarFichas } from "../api/actualizarFichas.js";
import { MOTIVOS_TRASPASO } from "../config.js";
import { hoy, ahoraISO, fecha } from "../lib/formato.js";

const TONO_STAND = { traspaso: "info", asignado: "ok", creado: "ok", suyo: "neutro", vendido: "neutro", conflicto: "alerta" };
const TEXTO_STAND = { traspaso: "Traspaso", asignado: "Se asigna", creado: "Stand nuevo", suyo: "Ya es suyo", vendido: "Ya lo vendió", conflicto: "Revisar" };

export function ActualizarFichas() {
  const { datos, usuario, avisar } = useApp();
  const [lote, setLote] = useState(null);
  const [error, setError] = useState("");
  const [motivo, setMotivo] = useState(MOTIVOS_TRASPASO[0]);
  const [informe, setInforme] = useState(null); // { modo: "revision"|"aplicado", filas }
  const [avance, setAvance] = useState(null);
  const [verFoto, setVerFoto] = useState(null);

  if (!usuario?.esAdmin) {
    return html`<div className="pagina angosta"><div className="aviso aviso-alerta"><span>Esta herramienta es solo para el administrador principal.</span></div></div>`;
  }

  async function revisar(l = lote, m = motivo) {
    if (!l) return;
    const estado = copiarEstado(datos);
    const filas = await procesarFichas(l, estado, { ops: opsSimuladas(estado), hoyIso: hoy().iso, ahora: ahoraISO(), motivo: m, por: usuario.id });
    setInforme({ modo: "revision", filas });
  }

  async function cargar(e) {
    const archivo = e.target.files?.[0];
    e.target.value = "";
    if (!archivo) return;
    setError(""); setInforme(null);
    try {
      const l = leerArchivoFichas(JSON.parse(await archivo.text()));
      setLote({ ...l, archivo: archivo.name });
      await revisar(l, motivo);
    } catch (err) {
      setLote(null);
      setError(err?.message || "No se pudo leer el archivo.");
    }
  }

  async function aplicar() {
    const r = resumir(informe.filas);
    if (!confirm(`Se guardarán los cambios: ${r.existentes} fichas actualizadas, ${r.nuevas} fichas nuevas, ${r.traspasos} traspasos (el dueño anterior queda en el historial) y la foto de cada ficha como documento. ¿Continuar?`)) return;
    setAvance({ hechos: 0, total: lote.fichas.length, actual: "" });
    try {
      const filas = await aplicarFichas(lote, datos, { por: usuario.id, motivo, onAvance: (hechos, total, actual) => setAvance({ hechos, total, actual }) });
      setInforme({ modo: "aplicado", filas });
      const fin = resumir(filas);
      avisar(fin.errores ? `Terminado con ${fin.errores} error(es): revisa la tabla.` : `Listo: ${fin.existentes} fichas actualizadas, ${fin.nuevas} nuevas y ${fin.traspasos} traspasos.`, fin.errores ? "error" : "ok");
    } catch (err) {
      avisar(err?.message || "No se pudo terminar la actualización.", "error");
    } finally {
      setAvance(null);
    }
  }

  const r = informe ? resumir(informe.filas) : null;
  const aplicado = informe?.modo === "aplicado";
  return html`
    <div className="pagina">
      <${CabPagina} miga=${{ href: "#padron", texto: "Padrón" }} titulo="Actualizar con fichas del libro"
        sub="Carga el archivo de fichas transcritas: primero se revisa sin guardar y luego se aplica." />

      <div className="card card-pad" style=${{ display: "grid", gap: 12 }}>
        <p className="ayuda" style=${{ margin: 0 }}>
          Por cada ficha: si la persona ya está en el padrón (por DNI o por nombre) se actualizan dirección, celular, correo,
          ocupación, estado civil, cónyuge, hijos y familiares, y se completa lo que falte; nombres, DNI y N° no se cambian si ya
          estaban (las diferencias se muestran para revisar). Si no está, se crea su ficha <b>por revisar</b>. Si un stand de la
          ficha figuraba a nombre de otra persona y la ficha es de alguien nuevo en el libro, se registra el <b>traspaso</b>: el
          dueño anterior queda en el historial del stand, igual que con «Registrar venta o traspaso». La foto de cada ficha
          queda en los documentos de la persona.
        </p>
        <div className="fila-acciones" style=${{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end" }}>
          <label className="btn btn-ghost" style=${{ cursor: "pointer" }}>
            ${lote ? "Cargar otro archivo…" : "Cargar archivo de fichas (JSON)…"}
            <input type="file" accept="application/json,.json" className="sr" onChange=${cargar} disabled=${!!avance} />
          </label>
          <label className="campo" style=${{ margin: 0, minWidth: 240 }}>
            <span className="label">Motivo de los traspasos</span>
            <select className="input" value=${motivo} disabled=${!!avance || aplicado}
              onChange=${(e) => { setMotivo(e.target.value); revisar(lote, e.target.value); }}>
              ${MOTIVOS_TRASPASO.map((m) => html`<option key=${m} value=${m}>${m}</option>`)}
            </select>
          </label>
          ${lote && !aplicado && html`<button className="btn btn-ghost" disabled=${!!avance} onClick=${() => revisar()}>Volver a revisar</button>`}
          ${lote && informe && !aplicado && html`<button className="btn btn-primary" disabled=${!!avance} onClick=${aplicar}>Aplicar actualización</button>`}
        </div>
        ${lote && html`<p className="ayuda" style=${{ margin: 0 }}>Archivo: <b>${lote.archivo}</b> · ${lote.fichas.length} fichas${lote.fechaDocumento ? ` · fotos del ${fecha(lote.fechaDocumento)}` : ""}${lote.omitidas.length ? ` · ${lote.omitidas.length} fotos no se toman (copias repetidas o anuladas)` : ""}.</p>`}
        ${error && html`<div className="aviso aviso-peligro"><span>${error}</span></div>`}
        ${avance && html`<div><div className="tabla-pie" style=${{ padding: "6px 0", border: 0 }}><span>Guardando ${avance.hechos} de ${avance.total} · ${avance.actual}</span></div><${Barra} pct=${Math.round((avance.hechos / Math.max(1, avance.total)) * 100)} tono="ok" /></div>`}
      </div>

      ${informe && html`
        <div className=${`aviso ${aplicado ? (r.errores ? "aviso-alerta" : "aviso-ok") : "aviso-info"}`} style=${{ marginTop: 16 }}>
          <span><b>${aplicado ? "Actualización guardada." : "Revisión (todavía no se guardó nada)."}</b>
            ${" "}${r.existentes} ya estaban en el padrón · ${r.nuevas} fichas nuevas (por revisar) · ${r.traspasos} traspasos · ${r.asignados} stands asignados
            ${r.conflictos ? ` · ${r.conflictos} stands para revisar a mano` : ""} · ${r.documentos} fotos de ficha ${aplicado ? "adjuntadas" : "por adjuntar"}${r.errores ? ` · ${r.errores} con error` : ""}.</span>
        </div>
        <div className="card" style=${{ marginTop: 12 }}>
          <div className="tabla-caja">
            <table className="tabla">
              <thead><tr><th>Ficha</th><th>Persona</th><th>Datos</th><th>Stands</th><th>Avisos</th></tr></thead>
              <tbody>
                ${informe.filas.map((f) => html`
                  <tr key=${f.ficha.id} style=${{ verticalAlign: "top" }}>
                    <td>${f.ficha.fotos.map((x) => html`<button key=${x.nombre} type="button" className="btn-foto" title="Ver la foto" onClick=${() => setVerFoto(x)}
                        style=${{ border: 0, padding: 0, background: "none", cursor: "zoom-in", display: "block", marginBottom: 4 }}>
                        <img src=${x.dataURL} alt=${`Ficha ${x.nombre}`} width="56" style=${{ borderRadius: 4, border: "1px solid var(--borde)" }} /></button>`)}</td>
                    <td>
                      <b>${f.nombre}</b><br />
                      <span className="muted">DNI ${f.ficha.dni || "—"}${f.ficha.numero ? ` · N° ${f.ficha.numero} en la ficha` : " · sin N° en la ficha"}</span><br />
                      ${f.persona?.accion === "existente" && html`<${Badge} tono="ok">Ya está (por ${f.persona.por})<//> ${!String(f.persona.id).startsWith("nuevo_") && html`<a href=${`#ficha-${f.persona.id}`}>${f.persona.etiqueta}</a>`}`}
                      ${f.persona?.accion === "creada" && html`<${Badge} tono="alerta">${aplicado ? "Ficha nueva" : "Se crea"} (por revisar)<//> ${aplicado && html`<a href=${`#ficha-${f.persona.id}`}>abrir</a>`}`}
                      ${f.error && html`<div className="aviso aviso-peligro" style=${{ marginTop: 6 }}><span>${f.error}</span></div>`}
                    </td>
                    <td>
                      ${f.persona?.accion === "creada" ? html`<span className="muted">Todos los datos de la ficha.</span>`
                        : f.cambios.length ? html`<ul className="lista-simple">${f.cambios.map((c, i) => html`<li key=${i}><b>${c.campo}:</b> ${c.antes ? html`<s className="muted">${c.antes}</s> → ` : ""}${c.despues}</li>`)}</ul>`
                        : html`<span className="muted">Sin cambios.</span>`}
                      ${f.diferencias.length > 0 && html`<details style=${{ marginTop: 6 }}><summary>${f.diferencias.length} diferencia(s) que no se cambian</summary>
                        <ul className="lista-simple">${f.diferencias.map((d, i) => html`<li key=${i}><b>${d.campo}:</b> padrón «${d.padron}» · ficha «${d.ficha}»</li>`)}</ul></details>`}
                    </td>
                    <td><ul className="lista-simple">${f.stands.map((s) => html`<li key=${s.codigo}><b>${s.codigo}</b> <${Badge} tono=${TONO_STAND[s.accion]}>${TEXTO_STAND[s.accion]}<//><br /><span className="muted">${s.texto}</span></li>`)}</ul></td>
                    <td>${f.avisos.length ? html`<ul className="lista-simple">${f.avisos.map((a, i) => html`<li key=${i}>${a}</li>`)}</ul>` : html`<span className="muted">—</span>`}</td>
                  </tr>`)}
              </tbody>
            </table>
          </div>
        </div>`}

      ${verFoto && html`
        <div className="panel-fondo" onClick=${() => setVerFoto(null)} style=${{ display: "grid", placeItems: "center", cursor: "zoom-out" }}>
          <img src=${verFoto.dataURL} alt="Foto de la ficha" style=${{ maxWidth: "94vw", maxHeight: "92vh", borderRadius: 6, background: "#fff" }} />
        </div>`}
    </div>`;
}
