// Arranque de la app (como app/layout.tsx en Radar): conecta la base, calcula
// los derivados una sola vez y elige la pantalla según la dirección (#padron, #ficha-…).
//
// Capas (igual que Radar):
//   config.js          catálogos y cuotas del C.C.
//   plano.js           distribución del plano (un solo piso)
//   lib/types.js       forma de los datos y etiquetas de estados
//   lib/db.js          ÚNICA puerta a la base de datos
//   lib/*.js           reglas de negocio puras (padrón, pagos, incidencias, validación, exportar)
//   api/*.js           servicios: validan y escriben (la pantalla nunca escribe directo)
//   components/*.js    piezas de interfaz reutilizables
//   pages/*.js         una pantalla por sección
import { html, useState, useEffect, useMemo, useCallback, useRef } from "./components/html.js";
import { Contexto } from "./components/contexto.js";
import { Cabecera } from "./components/Cabecera.js";
import { activarTablasAdaptables } from "./components/tablasAdaptables.js";
import { escucharTodo, conectar } from "./lib/db.js";
import { conectarArchivos } from "./lib/archivos.js";
import { conectarDescargas } from "./lib/exportar.js";
import { usuarioActual } from "./lib/usuario.js";
import { standsPorAsociado } from "./lib/padron.js";
import { indicePagos, standsMorosos, atrasoAsociado } from "./lib/pagos.js";
import { hoy } from "./lib/formato.js";
import { INSTITUCION } from "./config.js";
import { Inicio } from "./pages/Inicio.js";
import { Padron } from "./pages/Padron.js";
import { Ficha } from "./pages/Ficha.js";
import { NuevaFicha } from "./pages/NuevaFicha.js";
import { Stands } from "./pages/Stands.js";
import { Pagos } from "./pages/Pagos.js";
import { Incidencias } from "./pages/Incidencias.js";
import { Reportes } from "./pages/Reportes.js";

function leerRuta() {
  const h = decodeURIComponent(location.hash.replace(/^#/, "")) || "inicio";
  if (h.startsWith("ficha-")) return { seccion: "padron", pagina: "ficha", id: h.slice(6) };
  if (h.startsWith("pagos-")) return { seccion: "pagos", pagina: "pagos", stand: h.slice(6) };
  if (h.startsWith("nueva-")) return { seccion: "padron", pagina: "nueva", stand: h.slice(6) };
  const conocidas = ["inicio", "padron", "nueva", "stands", "pagos", "incidencias", "reportes"];
  const p = conocidas.includes(h) ? h : "inicio"; // #campo quedó dentro de Inicio
  return { seccion: p === "nueva" ? "padron" : p, pagina: p };
}

function App() {
  const [datos, setDatos] = useState({ asociados: [], stands: [], pagos: [], incidencias: [], cargado: false });
  const [estadoBase, setEstadoBase] = useState("conectando"); // conectando | lista | sin_base | error
  const [ruta, setRuta] = useState(leerRuta);
  const [usuario, setUsuario] = useState({ id: null, nombre: "", puedeEscribir: null });
  const [caps, setCaps] = useState({ archivos: false, descargas: false });
  const [aviso, setAviso] = useState(null);
  const temporizador = useRef(null);

  // Suscripción única a la base.
  useEffect(() => {
    let dejar = null;
    let vivo = true;
    escucharTodo(
      (d) => { if (vivo) { setDatos(d); if (d.cargado) setEstadoBase("lista"); } },
      (e) => vivo && setEstadoBase(e?.code === "revoked" ? "sin_base" : "error"),
    ).then((u) => {
      if (!vivo) return u?.();
      if (!u) setEstadoBase("sin_base");
      dejar = u;
    });
    return () => { vivo = false; dejar?.(); };
  }, []);

  // Capacidades opcionales: usuario, archivos y descargas.
  useEffect(() => {
    usuarioActual().then(setUsuario).catch(() => {});
    Promise.all([conectarArchivos(), conectarDescargas()]).then(([a, d]) => setCaps({ archivos: Boolean(a), descargas: Boolean(d) }));
  }, []);

  useEffect(() => {
    const cambio = () => { setRuta(leerRuta()); window.scrollTo(0, 0); };
    window.addEventListener("hashchange", cambio);
    return () => window.removeEventListener("hashchange", cambio);
  }, []);

  const ir = useCallback((destino) => { location.hash = destino; }, []);
  const avisar = useCallback((texto, tipo = "ok") => {
    clearTimeout(temporizador.current);
    setAviso({ texto, tipo });
    temporizador.current = setTimeout(() => setAviso(null), tipo === "error" ? 6000 : 3500);
  }, []);

  // Derivados que usan varias pantallas (se calculan una vez por cambio de datos).
  const derivados = useMemo(() => {
    const h = hoy();
    const mapaStands = standsPorAsociado(datos.stands);
    const idx = indicePagos(datos.pagos);
    const cache = new Map();
    return {
      h,
      mapaStands,
      porId: new Map(datos.asociados.map((a) => [a.id, a])),
      indicePagos: idx,
      morosos: standsMorosos(datos.stands, idx, h.anio, h),
      atraso: (a) => {
        if (!cache.has(a.id)) cache.set(a.id, atrasoAsociado(mapaStands.get(a.id), idx, h.anio, h));
        return cache.get(a.id);
      },
    };
  }, [datos]);

  const hayEjemplos = datos.asociados.some((a) => a.ejemplo);
  const ctx = { datos, derivados, usuario, caps, ir, avisar, puedeEscribir: usuario.puedeEscribir };

  let pagina;
  if (estadoBase === "conectando") pagina = html`<div className="arranque">Cargando el padrón…</div>`;
  else if (estadoBase === "sin_base") pagina = html`<div className="pagina angosta"><div className="aviso aviso-alerta">
    <span>No hay conexión con la base de datos del padrón en esta vista. Ábrela desde claude.ai con tu cuenta para ver y registrar fichas.</span></div></div>`;
  else if (estadoBase === "error") pagina = html`<div className="pagina angosta"><div className="aviso aviso-peligro">
    <span>Se perdió la conexión con la base de datos. Recarga la página para reconectar.</span></div></div>`;
  else {
    const P = { inicio: Inicio, padron: Padron, ficha: Ficha, nueva: NuevaFicha, stands: Stands, pagos: Pagos, incidencias: Incidencias, reportes: Reportes }[ruta.pagina] || Inicio;
    pagina = html`<${P} key=${ruta.pagina + (ruta.id || "") + (ruta.pagina === "nueva" ? ruta.stand || "" : "")} id=${ruta.id} stand=${ruta.stand} />`;
  }

  return html`
    <${Contexto.Provider} value=${ctx}>
      <${Cabecera} seccion=${ruta.seccion} usuario=${usuario} hayEjemplos=${hayEjemplos} puedeEscribir=${usuario.puedeEscribir} />
      <main>${pagina}</main>
      <footer className="pie">${INSTITUCION.nombre} · RUC ${INSTITUCION.ruc} · Gestión de propietarios · ${hoy().anio}</footer>
      ${aviso && html`<div className=${`toast ${aviso.tipo === "error" ? "error" : ""}`} role="status" aria-live="polite">${aviso.texto}</div>`}
    <//>`;
}

conectar();
activarTablasAdaptables();
window.ReactDOM.createRoot(document.getElementById("app")).render(html`<${App} />`);
