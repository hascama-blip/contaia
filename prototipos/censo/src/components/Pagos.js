// Cuadro anual de pagos de un stand y panel para registrar un pago.
import { html, useState, useMemo } from "./html.js";
import { Buscador, opcionesStands } from "./Buscador.js";
import { CONCEPTOS, MESES, MESES_LARGO, MEDIOS_PAGO, COBRANZA_DESDE } from "../config.js";
import { estadoCuota, claveRegistro } from "../lib/pagos.js";
import { soles, fecha, hoy } from "../lib/formato.js";
import { Campo, Entrada, Selector, Texto, Panel, mensajeError } from "./ui.js";
import { registrarPago, anularPago } from "../api/pagos.js";
import { useApp } from "./contexto.js";
import { nombresDe } from "../lib/usuario.js";
import { useEffect } from "./html.js";

const SIMBOLO = { pagado: "✓", vencido: "×", pendiente: "!", futuro: "", antes: "–", na: "·" };
const TEXTO = { pagado: "Pagado", vencido: "Vencido", pendiente: "Pendiente (mes en curso)", futuro: "Aún no vence", antes: "Antes del registro en el sistema", na: "No se cobra" };

export function Leyenda() {
  return html`
    <div className="leyenda">
      <span><i className="c-pagado"></i>Pagado</span>
      <span><i className="c-pendiente"></i>Mes en curso</span>
      <span><i className="c-vencido"></i>Vencido</span>
      <span><i className="c-futuro" style=${{ border: "1px solid var(--borde)" }}></i>Por vencer</span>
      <span><i className="c-antes"></i>Antes de ${MESES_LARGO[COBRANZA_DESDE.mes - 1]} ${COBRANZA_DESDE.anio} (sin registro)</span>
    </div>`;
}

/** onCelda(concepto, mes) se llama al tocar una cuota impaga (para registrarla); onPagado(concepto, mes, registro) al tocar una pagada (ver detalle / revertir). */
export function CuadroAnual({ registros, anio, onCelda, onPagado }) {
  const h = hoy();
  return html`
    <p className="aviso-deslizar">Desliza hacia los lados para ver los 12 meses.</p>
    <div className="tabla-caja cuadro-caja">
      <table className="cuadro">
        <thead><tr><th>Concepto</th>${MESES.map((m) => html`<th key=${m}>${m}</th>`)}</tr></thead>
        <tbody>
          ${CONCEPTOS.map((c) => html`
            <tr key=${c.id}>
              <td>${c.nombre}</td>
              ${MESES.map((_, i) => {
                const mes = i + 1;
                const est = estadoCuota(registros, c, mes, anio, h);
                const reg = registros?.[claveRegistro(c.id, mes)];
                const titulo = reg
                  ? `${c.nombre} ${MESES_LARGO[i]}: ${soles(reg.monto)} · ${reg.medio} · ${fecha(reg.fecha)}`
                  : `${c.nombre} ${MESES_LARGO[i]}: ${TEXTO[est]}`;
                const clic = onCelda && (est === "vencido" || est === "pendiente" || est === "futuro" || est === "antes");
                const clicPagado = onPagado && est === "pagado" && reg;
                return html`<td key=${mes}>
                  ${clic
                    ? html`<button type="button" className=${`celda c-${est}`} title=${`${titulo} — tocar para registrar`} aria-label=${titulo} onClick=${() => onCelda(c.id, mes)}>${SIMBOLO[est]}</button>`
                    : clicPagado
                      ? html`<button type="button" className=${`celda c-${est}`} title=${`${titulo} — tocar para ver o revertir`} aria-label=${titulo} onClick=${() => onPagado(c.id, mes, reg)}>${SIMBOLO[est]}</button>`
                      : html`<span className=${`celda c-${est}`} title=${titulo} aria-label=${titulo}>${SIMBOLO[est]}</span>`}
                </td>`;
              })}
            </tr>`)}
        </tbody>
      </table>
    </div>`;
}

/** Panel lateral para registrar un pago. `inicial` trae stand, concepto y mes sugeridos. */
export function PanelPago({ inicial, stands, onCerrar }) {
  const { usuario, avisar, derivados } = useApp();
  const h = hoy();
  const opciones = useMemo(() => opcionesStands(stands, derivados.porId), [stands, derivados.porId]);
  const concepto0 = CONCEPTOS.find((c) => c.id === inicial?.concepto) || CONCEPTOS[0];
  const [p, setP] = useState({
    stand: inicial?.stand || "",
    anio: inicial?.anio || h.anio,
    concepto: concepto0.id,
    mes: String(inicial?.mes || h.mes),
    monto: String(concepto0.monto),
    medio: "Yape / Plin",
    operacion: "",
    fecha: h.iso,
  });
  const [errores, setErrores] = useState({});
  const [ocupado, setOcupado] = useState(false);
  const cambia = (k) => (v) => setP((x) => {
    const n = { ...x, [k]: v };
    if (k === "concepto") n.monto = String(CONCEPTOS.find((c) => c.id === v)?.monto ?? x.monto);
    return n;
  });

  async function guardar() {
    setOcupado(true);
    try {
      await registrarPago(p, { por: usuario?.id });
      const c = CONCEPTOS.find((x) => x.id === p.concepto);
      avisar(`Pago registrado: ${c.nombre} ${MESES_LARGO[Number(p.mes) - 1]} · stand ${p.stand} · ${soles(p.monto)}`);
      onCerrar();
    } catch (e) {
      setErrores(e.errores || {});
      avisar(mensajeError(e), "error");
    } finally {
      setOcupado(false);
    }
  }

  return html`
    <${Panel} titulo="Registrar pago" onCerrar=${onCerrar}
      pie=${html`
        <button className="btn btn-ghost" onClick=${onCerrar}>Cancelar</button>
        <button className="btn btn-primary" disabled=${ocupado} onClick=${guardar}>${ocupado ? "Guardando…" : "Guardar pago"}</button>`}>
      <${Campo} id="p-stand" etiqueta="Stand" req error=${errores.stand}>
        <${Buscador} id="p-stand" opciones=${opciones} valor=${p.stand} onElegir=${cambia("stand")} error=${errores.stand}
          placeholder="Buscar por stand, DNI o nombre" />
      <//>
      <div className="form-rejilla" style=${{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
        <${Campo} id="p-concepto" etiqueta="Concepto" req error=${errores.concepto}>
          <${Selector} id="p-concepto" valor=${p.concepto} onCambio=${cambia("concepto")} vacio=${null}
            opciones=${CONCEPTOS.map((c) => [c.id, c.nombre])} />
        <//>
        <${Campo} id="p-mes" etiqueta=${`Mes (${p.anio})`} req error=${errores.mes}>
          <${Selector} id="p-mes" valor=${p.mes} onCambio=${cambia("mes")} vacio=${null}
            opciones=${MESES_LARGO.map((m, i) => [String(i + 1), m.charAt(0).toUpperCase() + m.slice(1)])} />
        <//>
        <${Campo} id="p-monto" etiqueta="Monto (S/)" req error=${errores.monto}>
          <${Entrada} id="p-monto" valor=${p.monto} onCambio=${cambia("monto")} inputMode="decimal" error=${errores.monto} />
        <//>
        <${Campo} id="p-fecha" etiqueta="Fecha de pago">
          <${Entrada} id="p-fecha" valor=${p.fecha} onCambio=${cambia("fecha")} tipo="date" />
        <//>
        <${Campo} id="p-medio" etiqueta="Medio de pago" req error=${errores.medio}>
          <${Selector} id="p-medio" valor=${p.medio} onCambio=${cambia("medio")} vacio=${null} opciones=${MEDIOS_PAGO} />
        <//>
        <${Campo} id="p-operacion" etiqueta="N° de operación" error=${errores.operacion}>
          <${Entrada} id="p-operacion" valor=${p.operacion} onCambio=${cambia("operacion")} inputMode="numeric" error=${errores.operacion} />
        <//>
      </div>
    <//>`;
}

/** Detalle de un pago registrado, con la opción de revertirlo (queda constancia; la cuota vuelve a figurar impaga). */
export function PanelRevertirPago({ stand, anio, concepto, mes, registro, onCerrar }) {
  const { usuario, avisar } = useApp();
  const c = CONCEPTOS.find((x) => x.id === concepto) || { nombre: concepto };
  const [motivo, setMotivo] = useState("");
  const [confirmando, setConfirmando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [nombrePor, setNombrePor] = useState("");
  useEffect(() => { if (registro?.por) nombresDe([registro.por]).then((m) => setNombrePor(m[registro.por] || "")); }, [registro?.por]);

  async function revertir() {
    setOcupado(true);
    try {
      await anularPago(stand, anio, claveRegistro(concepto, Number(mes)), { por: usuario?.id, motivo, registro });
      avisar(`Pago revertido: ${c.nombre} ${MESES_LARGO[Number(mes) - 1]} ${anio} · stand ${stand}. La cuota vuelve a figurar como pendiente.`);
      onCerrar();
    } catch (e) {
      avisar(mensajeError(e), "error");
    } finally {
      setOcupado(false);
    }
  }

  return html`
    <${Panel} titulo=${`Pago registrado · stand ${stand}`} onCerrar=${onCerrar}
      pie=${html`
        <button className="btn btn-ghost" onClick=${onCerrar}>Cerrar</button>
        ${confirmando
          ? html`<button className="btn btn-peligro" disabled=${ocupado} onClick=${revertir}>${ocupado ? "Revirtiendo…" : "Sí, revertir el pago"}</button>`
          : html`<button className="btn btn-peligro" onClick=${() => setConfirmando(true)}>Revertir pago</button>`}`}>
      <ul className="lista">
        <li><span>Concepto</span><span>${c.nombre} · ${MESES_LARGO[Number(mes) - 1]} ${anio}</span></li>
        <li><span>Monto</span><span className="num" style=${{ fontWeight: 700 }}>${soles(registro?.monto)}</span></li>
        <li><span>Medio</span><span>${registro?.medio || "—"}${registro?.operacion ? ` · op. ${registro.operacion}` : ""}</span></li>
        <li><span>Fecha de pago</span><span>${registro?.fecha ? fecha(registro.fecha) : "—"}</span></li>
        <li><span>Registrado por</span><span>${nombrePor || (registro?.por ? "usuario del portal" : "—")}</span></li>
      </ul>
      ${confirmando
        ? html`
          <div className="aviso aviso-alerta" style=${{ marginTop: 12 }}><span>Al revertirlo, la cuota vuelve a figurar como <strong>pendiente o vencida</strong> y este pago queda guardado como anulado, con tu nombre y la fecha. No se borra nada.</span></div>
          <${Campo} id="rv-motivo" etiqueta="Motivo (opcional)" ayuda="Ej.: se registró por error, el voucher no corresponde, pago rechazado.">
            <${Texto} id="rv-motivo" valor=${motivo} onCambio=${setMotivo} rows="2" />
          <//>`
        : html`<p className="ayuda" style=${{ marginTop: 12 }}>Si este pago se registró por error, usa <strong>Revertir pago</strong>. Quedará en el historial de pagos revertidos del stand.</p>`}
    <//>`;
}

/** Historial de pagos revertidos de un stand en el año. */
export function ListaAnulaciones({ anulaciones }) {
  if (!anulaciones?.length) return null;
  return html`
    <details className="desplegable" style=${{ marginTop: 4 }}>
      <summary className="ayuda" style=${{ cursor: "pointer" }}>Pagos revertidos este año: <strong>${anulaciones.length}</strong> (ver)</summary>
      <ul className="lista" style=${{ marginTop: 6 }}>
        ${anulaciones.map((an) => { const c = CONCEPTOS.find((x) => x.id === String(an.clave || "").split("-")[0]); const m = Number(String(an.clave || "").split("-")[1]); return html`
          <li key=${`${an.clave}@${an.anuladoAt}`}><span>${c?.nombre || an.clave} ${MESES_LARGO[m - 1] || ""} · ${soles(an.monto)} · ${an.medio || ""}${an.operacion ? ` op. ${an.operacion}` : ""}</span><span className="muted" style=${{ fontSize: "var(--t-xs)" }}>revertido el ${fecha(String(an.anuladoAt).slice(0, 10))}${an.motivo ? ` · ${an.motivo}` : ""}</span></li>`; })}
      </ul>
    </details>`;
}
