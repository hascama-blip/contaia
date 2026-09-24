// Tablas adaptables: en pantallas angostas cada fila se muestra como tarjeta.
// Copia el título de cada columna (thead) a sus celdas como data-label, que el
// CSS muestra como etiqueta. Funciona para todas las tablas .tabla de la app.
function etiquetar(tabla) {
  const titulos = [...tabla.querySelectorAll("thead th")].map((th) => th.textContent.trim());
  if (!titulos.length) return;
  for (const fila of tabla.querySelectorAll("tbody tr")) {
    [...fila.children].forEach((td, i) => {
      const t = titulos[i] || "";
      if (td.getAttribute("data-label") !== t) td.setAttribute("data-label", t);
    });
  }
}

export function activarTablasAdaptables() {
  let pendiente = false;
  const revisar = () => {
    pendiente = false;
    document.querySelectorAll("table.tabla").forEach(etiquetar);
  };
  new MutationObserver(() => {
    if (!pendiente) { pendiente = true; requestAnimationFrame(revisar); }
  }).observe(document.body, { childList: true, subtree: true });
  revisar();
}
