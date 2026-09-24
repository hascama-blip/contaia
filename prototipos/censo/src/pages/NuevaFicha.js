// Nueva ficha de asociado: una sola columna, pensada para el celular.
// El borrador se guarda en este dispositivo mientras se llena.
import { html, useState, useEffect, useRef } from "../components/html.js";
import { CabPagina, mensajeError } from "../components/ui.js";
import { FichaForm } from "../components/FichaForm.js";
import { FotoCampo, ArchivoCampo, FirmaCampo } from "../components/Archivos.js";
import { useApp } from "../components/contexto.js";
import { fichaVacia } from "../lib/types.js";
import { haceCuanto } from "../lib/formato.js";
import { subirArchivo } from "../lib/archivos.js";
import { crearAsociado } from "../api/asociados.js";

const CLAVE = "censo.borrador.nuevaFicha";

function leerBorrador() {
  try {
    const t = localStorage.getItem(CLAVE);
    return t ? JSON.parse(t) : null;
  } catch {
    return null;
  }
}
function escribirBorrador(valor) {
  try {
    if (valor) localStorage.setItem(CLAVE, JSON.stringify(valor));
    else localStorage.removeItem(CLAVE);
    return true;
  } catch {
    return false;
  }
}

export function NuevaFicha({ stand }) {
  const { datos, usuario, caps, ir, avisar, puedeEscribir } = useApp();
  const inicial = useRef(leerBorrador());
  const [ficha, setFicha] = useState(() => {
    const f = { ...fichaVacia(), ...(inicial.current?.ficha || {}) };
    // Desde el plano: "Registrar ficha" trae el stand ya escrito.
    if (stand && !String(f.standsTexto || "").trim()) f.standsTexto = stand;
    return f;
  });
  const [guardadoEn, setGuardadoEn] = useState(inicial.current?.en || null);
  const [, setTic] = useState(0);
  const [errores, setErrores] = useState({});
  const [ocupado, setOcupado] = useState(false);

  // Borrador automático (1 s después de dejar de escribir).
  useEffect(() => {
    const t = setTimeout(() => {
      const en = Date.now();
      if (escribirBorrador({ ficha, en })) setGuardadoEn(en);
    }, 1000);
    return () => clearTimeout(t);
  }, [ficha]);
  useEffect(() => {
    const t = setInterval(() => setTic((n) => n + 1), 15000);
    return () => clearInterval(t);
  }, []);

  const subir = (tipo) => async (archivo) => {
    const { id } = await subirArchivo(archivo);
    setFicha((f) => ({ ...f, archivos: { ...f.archivos, [tipo]: id } }));
  };

  async function guardar() {
    setOcupado(true);
    try {
      const id = await crearAsociado(ficha, { asociados: datos.asociados, stands: datos.stands, por: usuario?.id });
      escribirBorrador(null);
      avisar("Ficha guardada en el padrón.");
      ir(`ficha-${id}`);
    } catch (e) {
      setErrores(e.errores || {});
      avisar(mensajeError(e), "error");
      if (e.errores) document.querySelector(".error-campo")?.scrollIntoView({ block: "center" });
    } finally {
      setOcupado(false);
    }
  }

  function descartar() {
    escribirBorrador(null);
    setFicha(fichaVacia());
    setErrores({});
    setGuardadoEn(null);
  }

  if (puedeEscribir === false) {
    return html`<div className="pagina angosta"><${CabPagina} miga=${{ href: "#inicio", texto: "Inicio" }} titulo="Nueva ficha de asociado"
      sub="Tu acceso a esta página es de solo lectura. Pide acceso de edición para registrar fichas." /></div>`;
  }

  const puedeSubir = caps.archivos;
  const archivos = html`
    <div className="rejilla r-2">
      <${FotoCampo} id="nf-foto" valorId=${ficha.archivos?.foto} onArchivo=${subir("foto")} habilitado=${puedeSubir} />
      <div style=${{ display: "flex", flexDirection: "column", gap: 14 }}>
        <${ArchivoCampo} id="nf-huella" etiqueta="Huella digital" valorId=${ficha.archivos?.huella} onArchivo=${subir("huella")} habilitado=${puedeSubir} textoBoton="Subir huella" />
        <${ArchivoCampo} id="nf-dni" etiqueta="Foto del DNI" valorId=${ficha.archivos?.dni} onArchivo=${subir("dni")} habilitado=${puedeSubir} textoBoton="Subir foto del DNI" />
      </div>
    </div>
    <${FirmaCampo} valorId=${ficha.archivos?.firma} onArchivo=${subir("firma")} habilitado=${puedeSubir} />
    ${!puedeSubir && html`<p className="ayuda">Subir archivos requiere acceso de edición a esta página.</p>`}`;

  const hayErrores = Object.keys(errores).length > 0;
  return html`
    <div className="pagina angosta">
      <${CabPagina} miga=${{ href: "#padron", texto: "Padrón" }} titulo="Nueva ficha de asociado"
        sub="Libro de padrón de asociados. Una sola columna en el celular; el borrador se guarda solo." />

      <div className="aviso aviso-ok" role="status">
        <span className="punto" style=${{ marginTop: 6 }}></span>
        <span>${guardadoEn ? `Borrador guardado en este dispositivo ${haceCuanto(guardadoEn)}. Si se corta la señal, lo avanzado no se pierde.` : "El borrador se guarda en este dispositivo mientras escribes."}</span>
      </div>
      ${hayErrores && html`<div className="aviso aviso-peligro" role="alert">Faltan datos o hay campos por corregir (marcados en rojo).</div>`}

      <section className="card card-pad">
        <${FichaForm} ficha=${ficha} setFicha=${setFicha} errores=${errores} slotArchivos=${archivos}
          secciones=${["identificacion", "personales", "contacto", "vinculo", "conyuge", "hijos", "familiares", "stand", "archivos", "compromiso"]} />
      </section>

      <div style=${{ display: "flex", flexDirection: "column", gap: 10 }}>
        <button className="btn btn-primary btn-bloque" disabled=${ocupado} onClick=${guardar}>${ocupado ? "Guardando…" : "Guardar ficha"}</button>
        <button className="btn btn-ghost" onClick=${descartar}>Descartar borrador</button>
        <p className="ayuda" style=${{ textAlign: "center" }}>Con las dos casillas del compromiso marcadas, la ficha entra como "Actualizada".</p>
      </div>
    </div>`;
}
