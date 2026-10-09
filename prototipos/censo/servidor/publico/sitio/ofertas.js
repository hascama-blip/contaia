// /ofertas: todas las ofertas en rejilla, con filtros por categoría, tipo, tienda, orden y búsqueda.
// Los filtros viven en la URL (?cat=&tipo=&tienda=&orden=&q=) para poder compartir el enlace.
(async function () {
  const $ = (s) => document.querySelector(s);
  let datos; try { datos = await S.pedir("GET", "/api/publico/sitio"); } catch { $("#lista-ofertas").innerHTML = `<div class="vacio" style="grid-column:1/-1">No se pudo cargar. Vuelve a intentarlo en un momento.</div>`; return; }
  const { sitio, tiendas, articulos } = datos;
  const cat = new Map(sitio.categorias.map((c) => [c.id, c]));
  const tiendaDe = new Map(tiendas.map((t) => [t.id, t]));
  const ctx = { tiendaDe, cat, sitio, articulos };
  document.title = `Todas las ofertas · ${sitio.nombre}`;
  S.cabecera(sitio);
  const p = new URLSearchParams(location.search);
  const f = { cat: cat.has(p.get("cat")) ? p.get("cat") : "", tipo: (sitio.tiposOferta || []).some((t) => t.id === p.get("tipo")) ? p.get("tipo") : "", tienda: tiendaDe.has(p.get("tienda")) ? p.get("tienda") : "", orden: ["descuento", "precio-asc", "precio-desc", "reciente"].includes(p.get("orden")) ? p.get("orden") : "descuento", q: (p.get("q") || "").trim().slice(0, 80) };
  $("#q").value = f.q;
  const coincide = (a) => { const q = S.norm(f.q); return !q || S.norm(`${a.nombre} ${a.descripcion} ${a.etiquetaOferta || ""} ${cat.get(a.categoriaId)?.nombre || ""} ${tiendaDe.get(a.tiendaId)?.nombre || ""}`).includes(q); };
  const deCategoria = (a) => !f.cat || a.categoriaId === f.cat || (!a.categoriaId && (tiendaDe.get(a.tiendaId)?.categorias || []).includes(f.cat));
  function pintar() {
    const base = articulos.filter(coincide).filter(deCategoria);
    const cats = sitio.categorias.filter((c) => c.visible !== false && articulos.some((a) => a.categoriaId === c.id || (!a.categoriaId && (tiendaDe.get(a.tiendaId)?.categorias || []).includes(c.id))));
    const tipos = (sitio.tiposOferta || []).filter((t) => base.some((a) => a.tipoOferta === t.id && (!f.tienda || a.tiendaId === f.tienda)));
    const tiendasOf = [...new Set(base.filter((a) => !f.tipo || a.tipoOferta === f.tipo).map((a) => a.tiendaId))].map((id) => tiendaDe.get(id)).filter(Boolean).sort((x, y) => x.nombre.localeCompare(y.nombre, "es"));
    if (f.tipo && !tipos.some((t) => t.id === f.tipo)) f.tipo = "";
    if (f.tienda && !tiendasOf.some((t) => t.id === f.tienda)) f.tienda = "";
    $("#f-cat").innerHTML = `<option value="">Todas</option>` + cats.map((c) => `<option value="${S.esc(c.id)}">${S.esc(c.nombre)}</option>`).join(""); $("#f-cat").value = f.cat;
    $("#f-tipo").innerHTML = `<option value="">Todas</option>` + tipos.map((t) => `<option value="${S.esc(t.id)}">${S.esc(t.nombre)}</option>`).join(""); $("#f-tipo").value = f.tipo;
    $("#f-tienda").innerHTML = `<option value="">Todas</option>` + tiendasOf.map((t) => `<option value="${S.esc(t.id)}">${S.esc(t.nombre)}</option>`).join(""); $("#f-tienda").value = f.tienda;
    $("#f-orden").value = f.orden;
    $("#f-limpiar").hidden = !(f.cat || f.tipo || f.tienda || f.orden !== "descuento" || f.q);
    const of = S.ordenarOfertas(base.filter((a) => (!f.tipo || a.tipoOferta === f.tipo) && (!f.tienda || a.tiendaId === f.tienda)), f.orden);
    $("#lista-ofertas").innerHTML = of.length ? of.map((a) => S.afiche(a, ctx)).join("") : `<div class="vacio" style="grid-column:1/-1">${articulos.length ? "No hay ofertas con esos filtros." : "Todavía no hay ofertas publicadas."}</div>`;
    const partes = [f.cat && cat.get(f.cat)?.nombre, f.tipo && tipos.find((t) => t.id === f.tipo)?.nombre, f.tienda && tiendaDe.get(f.tienda)?.nombre].filter(Boolean);
    const n = new Set(of.map((a) => a.tiendaId)).size;
    $("#ofertas-sub").textContent = of.length ? `${of.length} oferta${of.length === 1 ? "" : "s"} de ${n} tienda${n === 1 ? "" : "s"}${partes.length ? ` · ${partes.join(" · ")}` : ""} · toca una para contactar a la tienda` : "Ninguna oferta coincide con los filtros elegidos.";
    const fa = $("#filtro"); fa.hidden = !f.q; if (f.q) fa.innerHTML = `Resultados para <b>“${S.esc(f.q)}”</b>: ${of.length} oferta(s) <button type="button" class="quitar">✕ Limpiar búsqueda</button>`;
    const u = new URLSearchParams(); if (f.cat) u.set("cat", f.cat); if (f.tipo) u.set("tipo", f.tipo); if (f.tienda) u.set("tienda", f.tienda); if (f.orden !== "descuento") u.set("orden", f.orden); if (f.q) u.set("q", f.q);
    history.replaceState(null, "", location.pathname + (u.toString() ? "?" + u : ""));
  }
  S.afichesInteractivos($("#lista-ofertas"));
  $("#f-cat").onchange = (e) => { f.cat = e.target.value; pintar(); };
  $("#f-tipo").onchange = (e) => { f.tipo = e.target.value; pintar(); };
  $("#f-tienda").onchange = (e) => { f.tienda = e.target.value; pintar(); };
  $("#f-orden").onchange = (e) => { f.orden = e.target.value; pintar(); };
  $("#f-limpiar").onclick = () => { Object.assign(f, { cat: "", tipo: "", tienda: "", orden: "descuento", q: "" }); $("#q").value = ""; pintar(); };
  $("#filtro").onclick = (e) => { if (e.target.closest(".quitar")) { f.q = ""; $("#q").value = ""; pintar(); } };
  let tBusca; $("#q").oninput = (e) => { clearTimeout(tBusca); tBusca = setTimeout(() => { f.q = e.target.value.trim().slice(0, 80); pintar(); }, 250); };
  $("#buscador").onsubmit = (e) => { e.preventDefault(); f.q = $("#q").value.trim().slice(0, 80); pintar(); };
  pintar();
})();
