// Formulario de la ficha del asociado. Lo usan "Nueva ficha" y "Ficha del asociado";
// cada página decide qué secciones muestra.
import { html } from "./html.js";
import { Campo, Entrada, Selector, Texto } from "./ui.js";
import { LISTAS } from "../config.js";
import { ESTADOS_ASOCIADO, ESTADOS_STAND } from "../lib/types.js";

// Lectura/escritura inmutable por ruta: "nacimiento.distrito", "hijos.0.nombre"
function leer(obj, ruta) {
  return ruta.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function escribir(obj, [k, ...resto], valor) {
  const copia = Array.isArray(obj) ? [...obj] : { ...(obj || {}) };
  copia[k] = resto.length ? escribir(copia[k], resto, valor) : valor;
  return copia;
}

export const SECCIONES = {
  identificacion: "Identificación",
  personales: "Datos personales",
  contacto: "Contacto y domicilio",
  vinculo: "Vínculo con la asociación",
  conyuge: "Cónyuge o conviviente",
  hijos: "Hijos",
  familiares: "Otros familiares o dependientes",
  stand: "Stand e inquilino",
  archivos: "Fotografía, huella y firma",
  compromiso: "Observaciones y compromiso",
};

export function FichaForm({ ficha, setFicha, errores = {}, secciones, numerar = true, slotArchivos = null, bloqueado = false }) {
  const c = (ruta) => ({
    id: `f-${ruta.replace(/\./g, "-")}`,
    valor: leer(ficha, ruta),
    onCambio: (v) => setFicha((f) => escribir(f, ruta.split("."), v)),
    disabled: bloqueado,
  });
  const agregar = (clave, vacio) => setFicha((f) => ({ ...f, [clave]: [...(f[clave] || []), vacio] }));
  const quitar = (clave, i) => setFicha((f) => ({ ...f, [clave]: f[clave].filter((_, j) => j !== i) }));

  const cuerpo = {
    identificacion: html`
      <div className="form-rejilla">
        <${Campo} id="f-numero" etiqueta="N° de asociado" req error=${errores.numero}>
          <${Entrada} ...${c("numero")} placeholder="Ej. 018" inputMode="numeric" error=${errores.numero} />
        <//>
        <${Campo} id="f-standsTexto" etiqueta="N° de stand (uno o varios)" req error=${errores.stands} ayuda="Separa con comas: A-12, A-13">
          <${Entrada} ...${c("standsTexto")} placeholder="Ej. A-12, A-13" error=${errores.stands} autoCapitalize="characters" />
        <//>
        <${Campo} id="f-cuentaBancaria" etiqueta="N° de cuenta bancaria">
          <${Entrada} ...${c("cuentaBancaria")} placeholder="Ej. 193-2547896-0-11" inputMode="numeric" />
        <//>
      </div>`,
    personales: html`
      <div className="form-rejilla">
        <${Campo} id="f-nombres" etiqueta="Nombres" req error=${errores.nombres}>
          <${Entrada} ...${c("nombres")} autoComplete="given-name" error=${errores.nombres} />
        <//>
        <${Campo} id="f-apellidoPaterno" etiqueta="Apellido paterno" req error=${errores.apellidoPaterno}>
          <${Entrada} ...${c("apellidoPaterno")} error=${errores.apellidoPaterno} />
        <//>
        <${Campo} id="f-apellidoMaterno" etiqueta="Apellido materno">
          <${Entrada} ...${c("apellidoMaterno")} />
        <//>
        <${Campo} id="f-dni" etiqueta="DNI" req error=${errores.dni} ayuda="8 dígitos">
          <${Entrada} ...${c("dni")} inputMode="numeric" maxLength="8" error=${errores.dni} />
        <//>
        <${Campo} id="f-fechaNacimiento" etiqueta="Fecha de nacimiento">
          <${Entrada} ...${c("fechaNacimiento")} tipo="date" />
        <//>
        <${Campo} id="f-estadoCivil" etiqueta="Estado civil">
          <${Selector} ...${c("estadoCivil")} opciones=${LISTAS.estadoCivil} />
        <//>
        <${Campo} id="f-nacimiento-departamento" etiqueta="Departamento de nacimiento">
          <${Entrada} ...${c("nacimiento.departamento")} lista="dl-departamentos" />
        <//>
        <${Campo} id="f-nacimiento-provincia" etiqueta="Provincia de nacimiento">
          <${Entrada} ...${c("nacimiento.provincia")} lista="dl-provincias" />
        <//>
        <${Campo} id="f-nacimiento-distrito" etiqueta="Distrito de nacimiento">
          <${Entrada} ...${c("nacimiento.distrito")} lista="dl-distritos" />
        <//>
        <${Campo} id="f-ocupacion" etiqueta="Ocupación">
          <${Entrada} ...${c("ocupacion")} />
        <//>
        <${Campo} id="f-instruccion" etiqueta="Grado de instrucción">
          <${Selector} ...${c("instruccion")} opciones=${LISTAS.instruccion} />
        <//>
      </div>`,
    contacto: html`
      <div className="form-rejilla">
        <${Campo} id="f-direccion" etiqueta="Dirección" className="ancho-2">
          <${Entrada} ...${c("direccion")} autoComplete="street-address" />
        <//>
        <${Campo} id="f-distritoResidencia" etiqueta="Distrito de residencia">
          <${Entrada} ...${c("distritoResidencia")} lista="dl-distritos" />
        <//>
        <${Campo} id="f-celular" etiqueta="Celular" error=${errores.celular} ayuda="9 dígitos">
          <${Entrada} ...${c("celular")} tipo="tel" inputMode="numeric" maxLength="11" error=${errores.celular} />
        <//>
        <${Campo} id="f-telefono" etiqueta="Teléfono fijo">
          <${Entrada} ...${c("telefono")} tipo="tel" />
        <//>
        <${Campo} id="f-correo" etiqueta="Correo electrónico" error=${errores.correo}>
          <${Entrada} ...${c("correo")} tipo="email" error=${errores.correo} />
        <//>
      </div>`,
    vinculo: html`
      <div className="form-rejilla">
        <${Campo} id="f-fechaIngreso" etiqueta="Fecha de ingreso">
          <${Entrada} ...${c("fechaIngreso")} tipo="date" />
        <//>
        <${Campo} id="f-estado" etiqueta="Estado del asociado">
          <${Selector} ...${c("estado")} vacio=${null} opciones=${Object.entries(ESTADOS_ASOCIADO).map(([k, v]) => [k, v.label])} />
        <//>
      </div>`,
    conyuge: html`
      <div className="form-rejilla">
        <${Campo} id="f-conyuge-nombre" etiqueta="Nombre completo">
          <${Entrada} ...${c("conyuge.nombre")} />
        <//>
        <${Campo} id="f-conyuge-dni" etiqueta="DNI" error=${errores.conyugeDni}>
          <${Entrada} ...${c("conyuge.dni")} inputMode="numeric" maxLength="8" error=${errores.conyugeDni} />
        <//>
        <${Campo} id="f-conyuge-celular" etiqueta="Celular">
          <${Entrada} ...${c("conyuge.celular")} tipo="tel" inputMode="numeric" />
        <//>
      </div>`,
    hijos: html`
      ${(ficha.hijos || []).map((h, i) => html`
        <div className="subtarjeta" key=${`h${i}`}>
          <div className="subtarjeta-cab"><span>Hijo(a) ${i + 1}</span>
            ${!bloqueado && html`<button type="button" className="enlace-btn" onClick=${() => quitar("hijos", i)}>Quitar</button>`}</div>
          <div className="form-rejilla">
            <${Campo} id=${`f-hijos-${i}-nombre`} etiqueta="Nombre completo"><${Entrada} ...${c(`hijos.${i}.nombre`)} /><//>
            <${Campo} id=${`f-hijos-${i}-edad`} etiqueta="Edad"><${Entrada} ...${c(`hijos.${i}.edad`)} inputMode="numeric" /><//>
            <${Campo} id=${`f-hijos-${i}-estudios`} etiqueta="Estudios"><${Selector} ...${c(`hijos.${i}.estudios`)} opciones=${LISTAS.estudios} /><//>
          </div>
        </div>`)}
      ${!bloqueado && html`<div><button type="button" className="btn btn-ghost" onClick=${() => agregar("hijos", { nombre: "", edad: "", estudios: "" })}>+ Agregar hijo(a)</button></div>`}`,
    familiares: html`
      ${(ficha.familiares || []).map((x, i) => html`
        <div className="subtarjeta" key=${`fa${i}`}>
          <div className="subtarjeta-cab"><span>Familiar ${i + 1}</span>
            ${!bloqueado && html`<button type="button" className="enlace-btn" onClick=${() => quitar("familiares", i)}>Quitar</button>`}</div>
          <div className="form-rejilla">
            <${Campo} id=${`f-familiares-${i}-nombre`} etiqueta="Nombre completo"><${Entrada} ...${c(`familiares.${i}.nombre`)} /><//>
            <${Campo} id=${`f-familiares-${i}-parentesco`} etiqueta="Parentesco"><${Selector} ...${c(`familiares.${i}.parentesco`)} opciones=${LISTAS.parentescos} /><//>
            <${Campo} id=${`f-familiares-${i}-estudios`} etiqueta="Estudios"><${Selector} ...${c(`familiares.${i}.estudios`)} opciones=${LISTAS.estudios} /><//>
          </div>
        </div>`)}
      ${!bloqueado && html`<div><button type="button" className="btn btn-ghost" onClick=${() => agregar("familiares", { nombre: "", parentesco: "", estudios: "" })}>+ Agregar familiar</button></div>`}`,
    stand: html`
      <div className="form-rejilla">
        <${Campo} id="f-giro" etiqueta="Giro comercial">
          <${Entrada} ...${c("giro")} placeholder="Ej. Calzado" />
        <//>
        <${Campo} id="f-estadoStand" etiqueta="Estado del stand">
          <${Selector} ...${c("estadoStand")} vacio=${null} opciones=${Object.entries(ESTADOS_STAND).map(([k, v]) => [k, v.label])} />
        <//>
        ${["alquilado", "litigio"].includes(ficha.estadoStand) && html`
          <${Campo} id="f-inquilino-nombre" etiqueta="Inquilino actual"><${Entrada} ...${c("inquilino.nombre")} placeholder="Apellidos, nombres" /><//>
          <${Campo} id="f-inquilino-dni" etiqueta="DNI del inquilino"><${Entrada} ...${c("inquilino.dni")} inputMode="numeric" maxLength="8" /><//>
          <${Campo} id="f-inquilino-celular" etiqueta="Celular del inquilino"><${Entrada} ...${c("inquilino.celular")} tipo="tel" inputMode="numeric" /><//>`}
      </div>`,
    archivos: slotArchivos,
    compromiso: html`
      <${Campo} id="f-observaciones" etiqueta="Observaciones de la Junta Directiva">
        <${Texto} ...${c("observaciones")} rows="3" />
      <//>
      <label className="check">
        <input type="checkbox" id="f-compromiso-estatutos" disabled=${bloqueado} checked=${Boolean(ficha.compromiso?.estatutos)}
          onChange=${(e) => setFicha((f) => escribir(f, ["compromiso", "estatutos"], e.target.checked))} />
        <span>Me comprometo a cumplir con la asociación y sus estatutos.</span>
      </label>
      <label className="check">
        <input type="checkbox" id="f-compromiso-datos" disabled=${bloqueado} checked=${Boolean(ficha.compromiso?.datos)}
          onChange=${(e) => setFicha((f) => escribir(f, ["compromiso", "datos"], e.target.checked))} />
        <span>Autorizo a la Asociación el tratamiento de mis datos personales y los de mi familia con fines de administración del padrón, conforme a la Ley N° 29733.</span>
      </label>
      <p className="ayuda">Las firmas del Presidente, Secretario(a) y Secretario de Organización quedan en blanco en la ficha impresa, para firma física.</p>`,
  };

  return html`
    <div>
      <datalist id="dl-departamentos">${LISTAS.departamentos.map((d) => html`<option key=${d} value=${d} />`)}</datalist>
      <datalist id="dl-provincias">${LISTAS.provincias.map((d) => html`<option key=${d} value=${d} />`)}</datalist>
      <datalist id="dl-distritos">${LISTAS.distritos.map((d) => html`<option key=${d} value=${d} />`)}</datalist>
      ${secciones.map((s, i) => cuerpo[s] && html`
        <section className="seccion-form" key=${s} aria-labelledby=${`sec-${s}`}>
          <h2 className="seccion-titulo" id=${`sec-${s}`}>${numerar && html`<span className="paso">${String(i + 1).padStart(2, "0")}</span>`}${SECCIONES[s]}</h2>
          ${cuerpo[s]}
        </section>`)}
    </div>`;
}
