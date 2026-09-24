// Cuadro anual de pagos de un stand y panel para registrar un pago.
import { html, useState, useMemo } from "./html.js";
import { Buscador, opcionesStands } from "./Buscador.js";
import { CONCEPTOS, MESES, MESES_LARGO, MEDIOS_PAGO } from "../config.js";
import { estadoCuota, claveRegistro } from "../lib/pagos.js";
import { soles, fecha, hoy } from "../lib/formato.js";
import { Campo, Entrada, Selector, Panel, mensajeError } from "./ui.js";
import { registrarPago } from "../api/pagos.js";
import { useApp } from "./contexto.js";

const SIMBOLO = { pagado: "✓", vencido: "×", pendiente: "!", futuro: "", na: "·" };
const TEXTO = { pagado: "Pagado", vencido: "Vencido", pendiente: "Pendiente (mes en curso)", futuro: "Aún no vence", na: "No se cobra" };

export function Leyenda() {
  return html`
    <div className="leyenda">
      <span><i className="c-pagado"></i>Pagado</span>
      <span><i className="c-pendiente"></i>Mes en curso</span>
      <span><i className="c-vencido"></i>Vencido</span>
      <span><i className="c-futuro" style=${{ border: "1px solid var(--borde)" }}></i>Por vencer</span>
    </div>`;
}

/** onCelda(concepto, mes) se llama al tocar una cuota impaga (para registrarla). */
export function CuadroAnual({ registros, anio, onCelda }) {
  const h = hoy();
  return html`
    <div className="tabla-caja">
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
                const clic = onCelda && (est === "vencido" || est === "pendiente" || est === "futuro");
                return html`<td key=${mes}>
                  ${clic
                    ? html`<button type="button" className=${`celda c-${est}`} title=${`${titulo} — tocar para registrar`} aria-label=${titulo} onClick=${() => onCelda(c.id, mes)}>${SIMBOLO[est]}</button>`
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
