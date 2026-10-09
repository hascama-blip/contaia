// Portada pública: carrusel de fotos, burbujas de categorías (filtran ofertas y tiendas),
// carrusel de "Las mejores ofertas" (10 + burbuja "Ver más" → /ofertas) y tiendas
// ordenadas por visitas a su perfil (8 + burbuja "Ver más tiendas" → /tiendas).
(async function () {
  const $ = (s) => document.querySelector(s);
  let datos; try { datos = await S.pedir("GET", "/api/publico/sitio"); } catch { $("#pista").innerHTML = `<div class="diapo diapo-vacia"><div><h1>No se pudo cargar</h1><p>Vuelve a intentarlo en un momento.</p></div></div>`; return; }
  const { sitio, tiendas, articulos } = datos;
  const cat = new Map(sitio.categorias.map((c) => [c.id, c]));
  const tiendaDe = new Map(tiendas.map((t) => [t.id, t]));
  const ctx = { tiendaDe, cat, sitio, articulos };
  document.title = `${sitio.nombre} · ${sitio.lema || "Tiendas y ofertas"}`;
  S.cabecera(sitio);

  // ---- Carrusel de fotos ----
  const pista = $("#pista"), puntos = $("#puntos");
  const diapos = sitio.carrusel.filter((d) => d && d.archivo);
  if (!diapos.length) {
    pista.innerHTML = `<div class="diapo diapo-vacia"><div><h1>${S.esc(sitio.nombre)}</h1><p>${S.esc(sitio.lema || "")}</p>${sitio.descripcion ? `<p>${S.esc(sitio.descripcion)}</p>` : ""}<a class="btn btn-dorado" href="#ofertas" style="margin-top:14px">Ver ofertas</a></div></div>`;
    $("#ant").hidden = $("#sig").hidden = true;
  } else {
    pista.innerHTML = diapos.map((d, i) => `<div class="diapo" role="group" aria-label="${i + 1} de ${diapos.length}"><div class="fondo" style="background-image:url('${S.blob(d.archivo)}')"></div><picture>${d.archivoMovil ? `<source media="(max-width: 640px)" srcset="${S.blob(d.archivoMovil)}">` : ""}<img src="${S.blob(d.archivo)}" alt="${S.esc(d.titulo || "")}" ${i ? 'loading="lazy"' : 'fetchpriority="high"'}></picture>${d.titulo || d.texto || d.enlace ? `<div class="diapo-texto">${d.titulo ? `<h2>${S.esc(d.titulo)}</h2>` : ""}${d.texto ? `<p>${S.esc(d.texto)}</p>` : ""}${S.url(d.enlace) ? `<a class="btn btn-dorado" href="${S.esc(S.url(d.enlace))}">${S.esc(d.textoEnlace || "Ver más")}</a>` : ""}</div>` : ""}</div>`).join("");
    puntos.innerHTML = diapos.map((_, i) => `<button type="button" aria-label="Ir a la foto ${i + 1}" data-i="${i}"></button>`).join("");
    let actual = 0, temporizador;
    // La caja mide exactamente lo que mide la foto que se está viendo: alto = ancho × proporción
    // de esa imagen (en celular, de su versión vertical si la tiene). Sin recortes ni vacíos.
    const imgs = [...pista.querySelectorAll("img")];
    const ajustarAlto = () => { const im = imgs[actual]; if (!im || !im.naturalWidth) return; pista.style.setProperty("--ratio", (im.naturalHeight / im.naturalWidth).toFixed(4)); };
    imgs.forEach((im, i) => im.addEventListener("load", () => { if (i === actual) ajustarAlto(); }));
    ajustarAlto(); addEventListener("resize", () => { clearTimeout(ajustarAlto.t); ajustarAlto.t = setTimeout(ajustarAlto, 150); });
    const ir = (i, suave = true) => { actual = (i + diapos.length) % diapos.length; pista.scrollTo({ left: actual * pista.clientWidth, behavior: suave ? "smooth" : "auto" }); };
    const marcar = () => { puntos.querySelectorAll("button").forEach((b, i) => b.setAttribute("aria-current", i === actual ? "true" : "false")); ajustarAlto(); };
    const auto = () => { clearInterval(temporizador); if (diapos.length > 1) temporizador = setInterval(() => ir(actual + 1), 5000); };
    pista.addEventListener("scroll", () => { const i = Math.round(pista.scrollLeft / pista.clientWidth); if (i !== actual) { actual = i; marcar(); } }, { passive: true });
    puntos.onclick = (e) => { const b = e.target.closest("button"); if (b) { ir(Number(b.dataset.i)); auto(); } };
    $("#ant").onclick = () => { ir(actual - 1); auto(); }; $("#sig").onclick = () => { ir(actual + 1); auto(); };
    pista.addEventListener("pointerdown", () => clearInterval(temporizador)); pista.addEventListener("pointerup", auto);
    if (diapos.length < 2) { $("#ant").hidden = $("#sig").hidden = true; puntos.hidden = true; }
    marcar(); auto();
  }

  // ---- Burbujas de categorías, búsqueda y filtro activo ----
  const burbujas = $("#burbujas"); let filtro = new URLSearchParams(location.search).get("cat") || "", busca = "";
  if (filtro && !cat.has(filtro)) filtro = "";
  const coincideTienda = (t) => !busca || S.norm(`${t.nombre} ${t.stand} ${t.piso} ${t.descripcion} ${(t.categorias || []).map((id) => cat.get(id)?.nombre).join(" ")}`).includes(busca);
  const coincideArt = (a) => !busca || S.norm(`${a.nombre} ${a.descripcion} ${a.etiquetaOferta || ""} ${cat.get(a.categoriaId)?.nombre || ""} ${tiendaDe.get(a.tiendaId)?.nombre || ""}`).includes(busca);
  let tBusca; $("#q").oninput = (e) => { clearTimeout(tBusca); tBusca = setTimeout(() => { busca = S.norm(e.target.value.trim()); pintar(); if (busca) $("#ofertas").scrollIntoView({ behavior: "smooth", block: "start" }); }, 250); };
  $("#buscador").onsubmit = (e) => { e.preventDefault(); busca = S.norm($("#q").value.trim()); pintar(); $("#ofertas").scrollIntoView({ behavior: "smooth", block: "start" }); };
  const conteo = (id) => tiendas.filter((t) => (t.categorias || []).includes(id)).length;
  const catsVisibles = sitio.categorias.filter((c) => c.visible !== false);
  burbujas.innerHTML = catsVisibles.map((c) => `<button type="button" class="burbuja" data-id="${S.esc(c.id)}" aria-pressed="false"><span class="ico">${S.iconoCategoria(c)}</span><b>${S.esc(c.nombre)}</b><small>${conteo(c.id)} tienda${conteo(c.id) === 1 ? "" : "s"}</small></button>`).join("") || `<p class="vacio" style="width:100%">Aún no hay categorías.</p>`;
  burbujas.onclick = (e) => { const b = e.target.closest(".burbuja"); if (!b) return; filtro = filtro === b.dataset.id ? "" : b.dataset.id; pintar(); if (filtro) $("#ofertas").scrollIntoView({ behavior: "smooth", block: "start" }); };
  $("#filtro").onclick = (e) => { if (e.target.closest(".quitar")) { filtro = ""; busca = ""; $("#q").value = ""; pintar(); } };

  // ---- Las mejores ofertas: carrusel de hasta 10 afiches + burbuja "Ver más" ----
  const LIM_OFERTAS = 10, LIM_TIENDAS = 8;
  let tipoFiltro = "", tiendaFiltro = "", ordenOfertas = "descuento";
  const carril = $("#lista-ofertas");
  const urlOfertas = () => { const p = new URLSearchParams(); if (tipoFiltro) p.set("tipo", tipoFiltro); if (tiendaFiltro) p.set("tienda", tiendaFiltro); if (filtro) p.set("cat", filtro); if (ordenOfertas !== "descuento") p.set("orden", ordenOfertas); if (busca) p.set("q", $("#q").value.trim()); const q = p.toString(); return "/ofertas" + (q ? "?" + q : ""); };
  const urlTiendas = () => { const p = new URLSearchParams(); if (filtro) p.set("cat", filtro); if (busca) p.set("q", $("#q").value.trim()); const q = p.toString(); return "/tiendas" + (q ? "?" + q : ""); };
  function pintarOfertas(todas) {
    // Cada lista de opciones depende del otro filtro: solo tipos que tenga la tienda elegida y solo tiendas con ofertas del tipo elegido.
    const tipos = (sitio.tiposOferta || []).filter((t) => todas.some((a) => a.tipoOferta === t.id && (!tiendaFiltro || a.tiendaId === tiendaFiltro)));
    const tiendasOf = [...new Set(todas.filter((a) => !tipoFiltro || a.tipoOferta === tipoFiltro).map((a) => a.tiendaId))].map((id) => tiendaDe.get(id)).filter(Boolean).sort((x, y) => x.nombre.localeCompare(y.nombre, "es"));
    if (tipoFiltro && !tipos.some((t) => t.id === tipoFiltro)) tipoFiltro = "";
    if (tiendaFiltro && !tiendasOf.some((t) => t.id === tiendaFiltro)) tiendaFiltro = "";
    const selTipo = $("#f-tipo"), selTienda = $("#f-tienda");
    selTipo.innerHTML = `<option value="">Todas</option>` + tipos.map((t) => `<option value="${S.esc(t.id)}">${S.esc(t.nombre)}</option>`).join(""); selTipo.value = tipoFiltro;
    selTienda.innerHTML = `<option value="">Todas</option>` + tiendasOf.map((t) => `<option value="${S.esc(t.id)}">${S.esc(t.nombre)}</option>`).join(""); selTienda.value = tiendaFiltro;
    $("#f-orden").value = ordenOfertas;
    $("#ofertas-filtros").hidden = todas.length < 2;
    $("#f-limpiar").hidden = !(tipoFiltro || tiendaFiltro || ordenOfertas !== "descuento");
    const of = S.ordenarOfertas(todas.filter((a) => (!tipoFiltro || a.tipoOferta === tipoFiltro) && (!tiendaFiltro || a.tiendaId === tiendaFiltro)), ordenOfertas);
    const mostradas = of.slice(0, LIM_OFERTAS), resto = of.length - mostradas.length;
    $("#ofertas").hidden = !articulos.length;
    carril.innerHTML = mostradas.length
      ? mostradas.map((a) => S.afiche(a, ctx)).join("") + S.burbujaMas(urlOfertas(), resto ? "Ver más" : "Ver todas", resto ? `${resto} oferta${resto === 1 ? "" : "s"} más` : "con todos los filtros")
      : `<div class="vacio" style="grid-column:1/-1;width:min(560px,80vw)">No hay ofertas con esos filtros.</div>`;
    indice = 0; irA(0, false); arrancar();
    const tiendasConOferta = new Set(of.map((a) => a.tiendaId)).size, nombreTipo = tipos.find((t) => t.id === tipoFiltro)?.nombre;
    $("#ofertas-sub").textContent = of.length ? `${of.length} oferta${of.length === 1 ? "" : "s"}${nombreTipo ? ` · ${nombreTipo}` : ""}${tiendaFiltro ? ` · ${tiendaDe.get(tiendaFiltro)?.nombre || ""}` : ` de ${tiendasConOferta} tienda${tiendasConOferta === 1 ? "" : "s"}`} · toca una para contactar a la tienda` : "Ninguna oferta coincide con los filtros elegidos.";
    const c = cat.get(filtro), fo = $("#filtro-ofertas"); fo.hidden = !(c || busca);
    if (c || busca) fo.innerHTML = `Mostrando solo ${busca ? `resultados de <b>“${S.esc($("#q").value.trim())}”</b>` : ""}${busca && c ? " en " : ""}${c ? `la categoría <b>${S.esc(c.nombre)}</b>` : ""} (${of.length} de ${articulos.length} ofertas) <button type="button" class="quitar">✕ Ver todas las ofertas</button>`;
  }
  $("#filtro-ofertas").onclick = (e) => { if (e.target.closest(".quitar")) { filtro = ""; busca = ""; $("#q").value = ""; pintar(); } };
  // Carrusel por tarjetas enteras: caben N por pantalla (--n del CSS) y siempre se alinea al inicio de una
  // tarjeta, así nunca se ve una cortada a la izquierda. Al llegar al final vuelve al inicio (también solo).
  let autoOf, visible = true, indice = 0;
  const porPantalla = () => Math.max(1, Number(getComputedStyle(carril).getPropertyValue("--n")) || 1);
  const total = () => carril.children.length;
  const paso = () => (carril.firstElementChild?.getBoundingClientRect().width || 0) + (parseFloat(getComputedStyle(carril).columnGap) || 0);
  const ultimo = () => Math.max(0, total() - porPantalla());
  const irA = (i, suave = true) => { indice = i > ultimo() ? 0 : i < 0 ? ultimo() : i; carril.scrollTo({ left: Math.round(indice * paso()), behavior: suave ? "smooth" : "auto" }); pintarPuntos(); };
  const pintarPuntos = () => {
    const n = porPantalla(), paginas = Math.max(1, Math.ceil(total() / n)), act = Math.min(paginas - 1, Math.round(indice / n));
    const caja = $("#of-puntos"); caja.hidden = paginas < 2;
    caja.innerHTML = Array.from({ length: paginas }, (_, p) => `<button type="button" role="tab" aria-label="Página ${p + 1} de ${paginas}" aria-current="${p === act}" data-i="${Math.min(p * n, ultimo())}"></button>`).join("");
    $("#of-ant").hidden = $("#of-sig").hidden = paginas < 2;
  };
  const reducir = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const arrancar = () => { clearInterval(autoOf); if (reducir || !visible || total() <= porPantalla()) return; autoOf = setInterval(() => irA(indice + 1), 4000); };
  const parar = () => clearInterval(autoOf);
  const flechas = () => { irA(Math.min(indice, ultimo()), false); };
  // Si el visitante desliza con el dedo, se toma la tarjeta en la que quedó.
  carril.addEventListener("scroll", () => { clearTimeout(carril.t); carril.t = setTimeout(() => { const i = Math.round(carril.scrollLeft / (paso() || 1)); if (i !== indice) { indice = Math.min(i, ultimo()); pintarPuntos(); } }, 120); }, { passive: true });
  carril.addEventListener("pointerenter", parar); carril.addEventListener("pointerleave", arrancar);
  carril.addEventListener("touchstart", parar, { passive: true }); carril.addEventListener("touchend", () => setTimeout(arrancar, 6000), { passive: true });
  carril.addEventListener("focusin", parar); carril.addEventListener("focusout", arrancar);
  $("#of-ant").onclick = () => { irA(indice - porPantalla() < 0 && indice > 0 ? 0 : indice - porPantalla()); arrancar(); };
  $("#of-sig").onclick = () => { irA(indice >= ultimo() ? 0 : Math.min(indice + porPantalla(), ultimo())); arrancar(); };
  $("#of-puntos").onclick = (e) => { const b = e.target.closest("button"); if (b) { irA(Number(b.dataset.i)); arrancar(); } };
  if ("IntersectionObserver" in window) new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) arrancar(); else parar(); }, { threshold: 0.2 }).observe(carril);
  document.addEventListener("visibilitychange", () => (document.hidden ? parar() : arrancar()));
  addEventListener("resize", () => { clearTimeout(flechas.r); flechas.r = setTimeout(() => { flechas(); arrancar(); }, 150); });
  $("#f-tipo").onchange = (e) => { tipoFiltro = e.target.value; pintar(); };
  $("#f-tienda").onchange = (e) => { tiendaFiltro = e.target.value; pintar(); };
  $("#f-orden").onchange = (e) => { ordenOfertas = e.target.value; pintar(); };
  $("#f-limpiar").onclick = () => { tipoFiltro = ""; tiendaFiltro = ""; ordenOfertas = "descuento"; pintar(); };

  // ---- Tiendas: las más visitadas primero (ya vienen ordenadas del servidor), 8 + burbuja ----
  const top = new Set(tiendas.filter((t) => t.visitas > 0).slice(0, 3).map((t) => t.id));
  function pintar() {
    const c = cat.get(filtro);
    burbujas.querySelectorAll(".burbuja").forEach((b) => b.setAttribute("aria-pressed", b.dataset.id === filtro ? "true" : "false"));
    const f = $("#filtro"); f.hidden = !c; if (c) f.innerHTML = `Mostrando ofertas y tiendas de <b>${S.esc(c.nombre)}</b> <button type="button" class="quitar">✕ Ver todo</button>`;
    if (location.search) history.replaceState(null, "", location.pathname); // al recargar se ve todo; el enlace del banner (?cat=) solo aplica al entrar
    const ts = (c ? tiendas.filter((t) => (t.categorias || []).includes(filtro)) : tiendas).filter(coincideTienda);
    const as = (c ? articulos.filter((a) => a.categoriaId === filtro || (tiendaDe.get(a.tiendaId)?.categorias || []).includes(filtro) && !a.categoriaId) : articulos).filter(coincideArt);
    if (busca) { f.hidden = false; f.innerHTML = `Resultados para <b>“${S.esc($("#q").value.trim())}”</b>${c ? ` en ${S.esc(c.nombre)}` : ""}: ${as.length} oferta(s), ${ts.length} tienda(s) <button type="button" class="quitar">✕ Limpiar búsqueda</button>`; }
    const mostradas = ts.slice(0, LIM_TIENDAS), resto = ts.length - mostradas.length;
    $("#tiendas-sub").textContent = `${ts.length} tienda${ts.length === 1 ? "" : "s"} · las más visitadas primero${c ? "" : " · toca una categoría arriba para filtrar"}`;
    $("#lista-tiendas").innerHTML = ts.length
      ? mostradas.map((t) => S.tarjetaTienda(t, { cat, sello: top.has(t.id) ? "Más visitada" : "" })).join("") + S.burbujaMas(urlTiendas(), resto ? "Ver más tiendas" : "Todas las tiendas", resto ? `${resto} tienda${resto === 1 ? "" : "s"} más` : "buscar y filtrar")
      : `<div class="vacio" style="grid-column:1/-1">Todavía no hay tiendas publicadas${c ? ` en ${S.esc(c.nombre)}` : ""}.</div>`;
    S.ajustarVerMas();
    pintarOfertas(as);
    $("#tiendas-titulo").innerHTML = (c ? `Tiendas que venden ${S.esc(c.nombre.toLowerCase())}` : "Tiendas") + ' <span class="punto">.</span>';
  }
  addEventListener("resize", () => { clearTimeout(S.ajustarVerMas.t); S.ajustarVerMas.t = setTimeout(S.ajustarVerMas, 150); });
  S.modalTienda(ctx);
  pintar();
})();
