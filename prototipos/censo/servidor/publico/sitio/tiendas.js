// /tiendas: todas las tiendas (las más visitadas primero) con filtro por categoría, orden y búsqueda.
(async function () {
  const $ = (s) => document.querySelector(s);
  let datos; try { datos = await S.pedir("GET", "/api/publico/sitio"); } catch { $("#lista-tiendas").innerHTML = `<div class="vacio" style="grid-column:1/-1">No se pudo cargar. Vuelve a intentarlo en un momento.</div>`; return; }
  const { sitio, tiendas, articulos } = datos;
  const cat = new Map(sitio.categorias.map((c) => [c.id, c]));
  const tiendaDe = new Map(tiendas.map((t) => [t.id, t]));
  const ctx = { tiendaDe, cat, sitio, articulos };
  document.title = `Todas las tiendas · ${sitio.nombre}`;
  S.cabecera(sitio);
  const p = new URLSearchParams(location.search);
  const f = { cat: cat.has(p.get("cat")) ? p.get("cat") : "", orden: ["visitas", "ofertas", "nombre"].includes(p.get("orden")) ? p.get("orden") : "visitas", q: (p.get("q") || "").trim().slice(0, 80) };
  $("#q").value = f.q;
  const top = new Set(tiendas.filter((t) => t.visitas > 0).slice(0, 3).map((t) => t.id));
  const coincide = (t) => { const q = S.norm(f.q); return !q || S.norm(`${t.nombre} ${t.stand} ${t.piso} ${t.descripcion} ${(t.categorias || []).map((id) => cat.get(id)?.nombre).join(" ")}`).includes(q); };
  function pintar() {
    const cats = sitio.categorias.filter((c) => c.visible !== false);
    $("#f-cat").innerHTML = `<option value="">Todas</option>` + cats.map((c) => `<option value="${S.esc(c.id)}">${S.esc(c.nombre)} (${tiendas.filter((t) => (t.categorias || []).includes(c.id)).length})</option>`).join(""); $("#f-cat").value = f.cat;
    $("#f-orden").value = f.orden;
    $("#f-limpiar").hidden = !(f.cat || f.orden !== "visitas" || f.q);
    let ts = tiendas.filter((t) => !f.cat || (t.categorias || []).includes(f.cat)).filter(coincide);
    if (f.orden === "nombre") ts = [...ts].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
    if (f.orden === "ofertas") ts = [...ts].sort((a, b) => (b.ofertas || 0) - (a.ofertas || 0) || (b.visitas || 0) - (a.visitas || 0));
    $("#lista-tiendas").innerHTML = ts.length ? ts.map((t) => S.tarjetaTienda(t, { cat, sello: top.has(t.id) ? "Más visitada" : "" })).join("") : `<div class="vacio" style="grid-column:1/-1">${tiendas.length ? "No hay tiendas con esos filtros." : "Todavía no hay tiendas publicadas."}</div>`;
    S.ajustarVerMas();
    const c = cat.get(f.cat);
    $("#tiendas-sub").textContent = `${ts.length} tienda${ts.length === 1 ? "" : "s"}${c ? ` · ${c.nombre}` : ""} · ${f.orden === "nombre" ? "por nombre" : f.orden === "ofertas" ? "con más ofertas primero" : "las más visitadas primero"}`;
    const fa = $("#filtro"); fa.hidden = !f.q; if (f.q) fa.innerHTML = `Resultados para <b>“${S.esc(f.q)}”</b>: ${ts.length} tienda(s) <button type="button" class="quitar">✕ Limpiar búsqueda</button>`;
    const u = new URLSearchParams(); if (f.cat) u.set("cat", f.cat); if (f.orden !== "visitas") u.set("orden", f.orden); if (f.q) u.set("q", f.q);
    history.replaceState(null, "", location.pathname + (u.toString() ? "?" + u : ""));
  }
  $("#f-cat").onchange = (e) => { f.cat = e.target.value; pintar(); };
  $("#f-orden").onchange = (e) => { f.orden = e.target.value; pintar(); };
  $("#f-limpiar").onclick = () => { Object.assign(f, { cat: "", orden: "visitas", q: "" }); $("#q").value = ""; pintar(); };
  $("#filtro").onclick = (e) => { if (e.target.closest(".quitar")) { f.q = ""; $("#q").value = ""; pintar(); } };
  let tBusca; $("#q").oninput = (e) => { clearTimeout(tBusca); tBusca = setTimeout(() => { f.q = e.target.value.trim().slice(0, 80); pintar(); }, 250); };
  $("#buscador").onsubmit = (e) => { e.preventDefault(); f.q = $("#q").value.trim().slice(0, 80); pintar(); };
  addEventListener("resize", () => { clearTimeout(S.ajustarVerMas.t); S.ajustarVerMas.t = setTimeout(S.ajustarVerMas, 150); });
  S.modalTienda(ctx);
  pintar();
})();
