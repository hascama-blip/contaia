// Portada pública: carrusel, burbujas de categorías (filtran tiendas y artículos),
// tiendas con resumen de ofertas y artículos con "Contactar".
(async function () {
  const $ = (s) => document.querySelector(s);
  let datos; try { datos = await S.pedir("GET", "/api/publico/sitio"); } catch { $("#pista").innerHTML = `<div class="diapo diapo-vacia"><div><h1>No se pudo cargar</h1><p>Vuelve a intentarlo en un momento.</p></div></div>`; return; }
  const { sitio, tiendas, articulos } = datos;
  const cat = new Map(sitio.categorias.map((c) => [c.id, c]));
  const tiendaDe = new Map(tiendas.map((t) => [t.id, t]));
  document.title = `${sitio.nombre} · ${sitio.lema || "Tiendas y ofertas"}`;
  $("#marca-nombre").firstChild.textContent = sitio.nombre.replace(/^Centro Comercial/i, "C.C.");
  $("#marca-lema").textContent = sitio.lema || "";
  if (sitio.whatsapp) { const a = $("#wa-centro"); a.href = S.wa(sitio.whatsapp.replace(/\D/g, "").replace(/^(\d{9})$/, "51$1"), `Hola, escribo desde la web de ${sitio.nombre}.`); a.hidden = false; a.target = "_blank"; a.rel = "noopener"; }
  $("#pie-datos").textContent = [sitio.direccion, sitio.horario].filter(Boolean).join(" · ") || sitio.lema || "";
  $("#pie-nombre").textContent = sitio.nombre;
  $("#cab-direccion span").textContent = [sitio.direccion, sitio.horario].filter(Boolean).join(" · ");

  // ---- Carrusel ----
  const pista = $("#pista"), puntos = $("#puntos");
  const diapos = sitio.carrusel.filter((d) => d && d.archivo);
  if (!diapos.length) {
    pista.innerHTML = `<div class="diapo diapo-vacia"><div><h1>${S.esc(sitio.nombre)}</h1><p>${S.esc(sitio.lema || "")}</p>${sitio.descripcion ? `<p>${S.esc(sitio.descripcion)}</p>` : ""}<a class="btn btn-dorado" href="#tiendas" style="margin-top:14px">Ver tiendas</a></div></div>`;
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

  // ---- Burbujas y filtro ----
  const burbujas = $("#burbujas"); let filtro = new URLSearchParams(location.search).get("cat") || "", busca = "";
  const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const coincideTienda = (t) => !busca || norm(`${t.nombre} ${t.stand} ${t.piso} ${t.descripcion} ${(t.categorias || []).map((id) => cat.get(id)?.nombre).join(" ")}`).includes(busca);
  const coincideArt = (a) => !busca || norm(`${a.nombre} ${a.descripcion} ${cat.get(a.categoriaId)?.nombre || ""} ${tiendaDe.get(a.tiendaId)?.nombre || ""}`).includes(busca);
  let tBusca; $("#q").oninput = (e) => { clearTimeout(tBusca); tBusca = setTimeout(() => { busca = norm(e.target.value.trim()); pintar(); if (busca) $("#tiendas").scrollIntoView({ behavior: "smooth", block: "start" }); }, 250); };
  $("#buscador").onsubmit = (e) => { e.preventDefault(); busca = norm($("#q").value.trim()); pintar(); $("#tiendas").scrollIntoView({ behavior: "smooth", block: "start" }); };
  const conteo = (id) => tiendas.filter((t) => (t.categorias || []).includes(id)).length;
  const catsVisibles = sitio.categorias.filter((c) => c.visible !== false);
  burbujas.innerHTML = catsVisibles.map((c) => `<button type="button" class="burbuja" data-id="${S.esc(c.id)}" aria-pressed="false"><span class="ico">${S.iconoCategoria(c)}</span><b>${S.esc(c.nombre)}</b><small>${conteo(c.id)} tienda${conteo(c.id) === 1 ? "" : "s"}</small></button>`).join("") || `<p class="vacio" style="width:100%">Aún no hay categorías.</p>`;
  burbujas.onclick = (e) => { const b = e.target.closest(".burbuja"); if (!b) return; filtro = filtro === b.dataset.id ? "" : b.dataset.id; pintar(); if (filtro) $("#tiendas").scrollIntoView({ behavior: "smooth", block: "start" }); };
  $("#filtro").onclick = (e) => { if (e.target.closest(".quitar")) { filtro = ""; busca = ""; $("#q").value = ""; pintar(); } };

  // ---- Las mejores ofertas (afiches) y novedades ----
  const descuento = (a) => (Number(a.precio) > 0 && Number(a.precioOferta) > 0 && Number(a.precioOferta) < Number(a.precio) ? Math.round((1 - Number(a.precioOferta) / Number(a.precio)) * 100) : 0);
  let tipoFiltro = "", tiendaFiltro = "", ordenOfertas = "descuento", verTodas = false;
  function afiche(a) {
    const t = tiendaDe.get(a.tiendaId) || {}, d = descuento(a), c = cat.get(a.categoriaId), tipo = S.tipo(a, sitio.tiposOferta);
    const cifra = d ? `<div class="afiche-cifra">${d}<small>%</small></div><div class="afiche-sub">de descuento</div>` : Number(a.precioOferta) > 0 ? `<div class="afiche-cifra precio-cifra">S/ ${Number(a.precioOferta).toLocaleString("es-PE")}</div><div class="afiche-sub">precio de oferta</div>` : `<div class="afiche-cifra precio-cifra">${Number(a.precio) > 0 ? "S/ " + Number(a.precio).toLocaleString("es-PE") : "Oferta"}</div><div class="afiche-sub">${Number(a.precio) > 0 ? "precio especial" : "consulta por WhatsApp"}</div>`;
    return `<a class="afiche tipo-${S.esc(tipo?.id || "oferta")}" href="/tienda/${encodeURIComponent(a.tiendaId)}?art=${encodeURIComponent(a.id)}">
      <div class="afiche-tipo">${S.esc(tipo?.nombre || "Oferta")}</div>
      <div class="afiche-etiqueta">${a.etiquetaOferta ? `<span>${S.esc(a.etiquetaOferta)}</span>` : ""}</div>
      <div class="afiche-eti">${S.esc(c?.nombre || "\u00a0")}</div>
      ${cifra}
      <div class="afiche-marca">${S.esc(a.nombre)}</div>
      <div class="afiche-precios">${d && Number(a.precioOferta) > 0 ? `<b>S/ ${Number(a.precioOferta).toLocaleString("es-PE", { minimumFractionDigits: 2 })}</b> <s>S/ ${Number(a.precio).toLocaleString("es-PE", { minimumFractionDigits: 2 })}</s>` : Number(a.precioOferta) > 0 ? `<b>S/ ${Number(a.precioOferta).toLocaleString("es-PE", { minimumFractionDigits: 2 })}</b>` : Number(a.precio) > 0 ? `<b>S/ ${Number(a.precio).toLocaleString("es-PE", { minimumFractionDigits: 2 })}</b>` : "\u00a0"}</div>
      <div class="afiche-tienda">${S.logo(t, "afiche-logo")}<span><b>${S.esc(t.nombre || "")}</b><small>${S.esc([t.stand, t.piso].filter(Boolean).join(" · ") || "\u00a0")}</small></span></div>
      <div class="afiche-foto">${a.foto ? `<img src="${S.blob(a.foto)}" alt="${S.esc(a.nombre)}" loading="lazy">` : `<span class="sin-foto">${S.icono("foto")}</span>`}</div>
    </a>`;
  }
  const precioVigente = (a) => (Number(a.precioOferta) > 0 ? Number(a.precioOferta) : Number(a.precio) > 0 ? Number(a.precio) : Infinity);
  function pintarOfertas(lista) {
    const todas = lista.filter((a) => a.oferta);
    // Cada lista de opciones depende del otro filtro: solo tipos que tenga la tienda elegida y solo tiendas con ofertas del tipo elegido.
    const tipos = (sitio.tiposOferta || []).filter((t) => todas.some((a) => (a.tipoOferta || "oferta") === t.id && (!tiendaFiltro || a.tiendaId === tiendaFiltro)));
    const tiendasOf = [...new Set(todas.filter((a) => !tipoFiltro || (a.tipoOferta || "oferta") === tipoFiltro).map((a) => a.tiendaId))].map((id) => tiendaDe.get(id)).filter(Boolean).sort((x, y) => x.nombre.localeCompare(y.nombre, "es"));
    if (tipoFiltro && !tipos.some((t) => t.id === tipoFiltro)) tipoFiltro = "";
    if (tiendaFiltro && !tiendasOf.some((t) => t.id === tiendaFiltro)) tiendaFiltro = "";
    const selTipo = $("#f-tipo"), selTienda = $("#f-tienda");
    selTipo.innerHTML = `<option value="">Todas</option>` + tipos.map((t) => `<option value="${S.esc(t.id)}">${S.esc(t.nombre)}</option>`).join(""); selTipo.value = tipoFiltro;
    selTienda.innerHTML = `<option value="">Todas</option>` + tiendasOf.map((t) => `<option value="${S.esc(t.id)}">${S.esc(t.nombre)}</option>`).join(""); selTienda.value = tiendaFiltro;
    $("#f-orden").value = ordenOfertas;
    $("#ofertas-filtros").hidden = todas.length < 2;
    $("#f-limpiar").hidden = !(tipoFiltro || tiendaFiltro || ordenOfertas !== "descuento");
    let of = todas.filter((a) => (!tipoFiltro || (a.tipoOferta || "oferta") === tipoFiltro) && (!tiendaFiltro || a.tiendaId === tiendaFiltro));
    const porFecha = (x, y) => String(y.creadoAt || y.actualizadoAt || "").localeCompare(String(x.creadoAt || x.actualizadoAt || ""));
    of = of.sort(ordenOfertas === "precio-asc" ? (x, y) => precioVigente(x) - precioVigente(y) : ordenOfertas === "precio-desc" ? (x, y) => precioVigente(y) - precioVigente(x) : ordenOfertas === "reciente" ? porFecha : (x, y) => Number(!!y.destacado) - Number(!!x.destacado) || descuento(y) - descuento(x));
    const LIM = 8, mostradas = verTodas ? of : of.slice(0, LIM);
    $("#ofertas").hidden = !todas.length; $("#lista-ofertas").innerHTML = mostradas.length ? mostradas.map(afiche).join("") : `<div class="vacio" style="grid-column:1/-1">No hay ofertas con esos filtros.</div>`;
    const mas = $("#ofertas-mas"); mas.hidden = of.length <= LIM; mas.querySelector("button").textContent = verTodas ? "Ver menos" : `Ver todas las ofertas (${of.length})`;
    const tiendasConOferta = new Set(of.map((a) => a.tiendaId)).size;
    const nombreTipo = tipos.find((t) => t.id === tipoFiltro)?.nombre;
    $("#ofertas-sub").textContent = of.length ? `${of.length} oferta${of.length === 1 ? "" : "s"}${nombreTipo ? ` · ${nombreTipo}` : ""}${tiendaFiltro ? ` · ${tiendaDe.get(tiendaFiltro)?.nombre || ""}` : ` de ${tiendasConOferta} tienda${tiendasConOferta === 1 ? "" : "s"}`} · toca una para contactar a la tienda` : "Ninguna oferta coincide con los filtros elegidos.";
    const nov = [...lista].sort(porFecha).slice(0, 10);
    $("#novedades").hidden = nov.length < 3; $("#lista-novedades").innerHTML = nov.map(tarjetaArticulo).join("");
  }

  function pintar() {
    const c = cat.get(filtro);
    burbujas.querySelectorAll(".burbuja").forEach((b) => b.setAttribute("aria-pressed", b.dataset.id === filtro ? "true" : "false"));
    const f = $("#filtro"); f.hidden = !c; if (c) f.innerHTML = `Mostrando tiendas y artículos de <b>${S.esc(c.nombre)}</b> <button type="button" class="quitar">✕ Ver todo</button>`;
    history.replaceState(null, "", c ? `?cat=${encodeURIComponent(filtro)}` : location.pathname);
    const ts = (c ? tiendas.filter((t) => (t.categorias || []).includes(filtro)) : tiendas).filter(coincideTienda);
    const as = (c ? articulos.filter((a) => a.categoriaId === filtro || (tiendaDe.get(a.tiendaId)?.categorias || []).includes(filtro) && !a.categoriaId) : articulos).filter(coincideArt);
    if (busca) { f.hidden = false; f.innerHTML = `Resultados para <b>“${S.esc($("#q").value.trim())}”</b>${c ? ` en ${S.esc(c.nombre)}` : ""}: ${ts.length} tienda(s), ${as.length} artículo(s) <button type="button" class="quitar">✕ Limpiar búsqueda</button>`; }
    $("#tiendas-sub").textContent = `${ts.length} tienda${ts.length === 1 ? "" : "s"}${c ? "" : " · toca una categoría arriba para filtrar"}`;
    $("#lista-tiendas").innerHTML = ts.length ? ts.map(tarjetaTienda).join("") : `<div class="vacio" style="grid-column:1/-1">Todavía no hay tiendas publicadas${c ? ` en ${S.esc(c.nombre)}` : ""}.</div>`;
    ajustarVerMas();
    pintarOfertas(as);
    $("#art-titulo").innerHTML = (c ? `Todo en ${S.esc(c.nombre.toLowerCase())}` : "Variedad de artículos") + ' <span class="punto">.</span>';
    $("#tiendas-titulo").innerHTML = (c ? `Tiendas que venden ${S.esc(c.nombre.toLowerCase())}` : "Tiendas") + ' <span class="punto">.</span>';
    $("#lista-articulos").innerHTML = as.length ? as.map(tarjetaArticulo).join("") : `<div class="vacio" style="grid-column:1/-1">Aún no hay artículos publicados${c ? ` en ${S.esc(c.nombre)}` : ""}.</div>`;
  }
  // "Ver más" aparece solo cuando la descripción no cabe en sus 3 líneas (medido en pantalla).
  function ajustarVerMas() { for (const d of document.querySelectorAll(".tienda-desc")) { const b = d.parentElement.querySelector(".ver-mas"); if (b) b.hidden = d.scrollHeight <= d.clientHeight + 1; } }
  addEventListener("resize", () => { clearTimeout(ajustarVerMas.t); ajustarVerMas.t = setTimeout(ajustarVerMas, 150); });
  const nombresCat = (t) => (t.categorias || []).map((id) => cat.get(id)).filter(Boolean).slice(0, 3).map((c) => `<span class="etiqueta">${S.esc(c.nombre)}</span>`).join("");
  function tarjetaTienda(t) {
    return `<article class="tienda" data-id="${S.esc(t.id)}">
      <div class="tienda-cab">${S.logo(t)}<div><h3>${S.esc(t.nombre)}</h3><div class="stand">${S.esc([t.stand, t.piso].filter(Boolean).join(" · ")) || "&nbsp;"}</div></div></div>
      <p class="tienda-desc">${S.esc(t.descripcion || "") || `<span class="muted">Vende ${S.esc((t.categorias || []).map((id) => cat.get(id)?.nombre).filter(Boolean).join(", ").toLowerCase() || "en el centro comercial")}.</span>`}</p>
      <div class="tienda-meta"><button type="button" class="ver-mas" hidden>Ver más</button><span class="tienda-ofertas ${t.ofertas ? "con" : ""}">${t.ofertas ? `${t.ofertas} oferta${t.ofertas === 1 ? "" : "s"}` : `${t.articulos || 0} artículo${t.articulos === 1 ? "" : "s"}`}</span></div>
      <div class="tienda-acciones"><button type="button" class="btn btn-borde btn-sm ver">Ver ofertas</button><a class="btn btn-primario btn-sm" href="/tienda/${encodeURIComponent(t.id)}">Contactar</a></div>
    </article>`;
  }
  function tarjetaArticulo(a) {
    const t = tiendaDe.get(a.tiendaId) || {};
    return `<article class="art">
      <div class="art-foto">${a.foto ? `<img src="${S.blob(a.foto)}" alt="${S.esc(a.nombre)}" loading="lazy">` : `<span class="sin-foto">${S.icono("foto")}</span>`}${S.pill(a, sitio.tiposOferta)}</div>
      <div class="art-cuerpo"><h3>${S.esc(a.nombre)}</h3>${S.precio(a)}<div class="desc">${S.esc(a.descripcion || "").slice(0, 90)}</div><div class="vende">Vende: <b>${S.esc(t.nombre || "—")}</b>${t.stand ? ` · ${S.esc(t.stand)}` : ""}</div>
      <a class="btn btn-primario btn-sm" href="/tienda/${encodeURIComponent(a.tiendaId)}${a.id ? `?art=${encodeURIComponent(a.id)}` : ""}">Contactar</a></div>
    </article>`;
  }

  $("#f-tipo").onchange = (e) => { tipoFiltro = e.target.value; verTodas = false; pintar(); };
  $("#f-tienda").onchange = (e) => { tiendaFiltro = e.target.value; verTodas = false; pintar(); };
  $("#f-orden").onchange = (e) => { ordenOfertas = e.target.value; pintar(); };
  $("#f-limpiar").onclick = () => { tipoFiltro = ""; tiendaFiltro = ""; ordenOfertas = "descuento"; verTodas = false; pintar(); };
  $("#ofertas-mas").onclick = () => { verTodas = !verTodas; pintar(); if (!verTodas) $("#ofertas").scrollIntoView({ behavior: "smooth", block: "start" }); };

  // ---- Resumen de ofertas (modal) ----
  const modal = $("#modal");
  $("#lista-tiendas").onclick = (e) => { const b = e.target.closest(".ver, .ver-mas"); if (!b) return; abrir(tiendaDe.get(b.closest(".tienda").dataset.id)); };
  $("#m-cerrar").onclick = () => modal.close(); modal.onclick = (e) => { if (e.target === modal) modal.close(); };
  function abrir(t) {
    if (!t) return;
    $("#m-logo").outerHTML = S.logo(t).replace('class="logo"', 'class="logo" id="m-logo"');
    $("#m-nombre").textContent = t.nombre; $("#m-stand").textContent = [t.stand, t.piso, t.horario, (t.categorias || []).map((id) => cat.get(id)?.nombre).filter(Boolean).join(", ")].filter(Boolean).join(" · ");
    $("#m-desc").textContent = t.descripcion || "";
    const mios = articulos.filter((a) => a.tiendaId === t.id); const of = mios.filter((a) => a.oferta); const lista = (of.length ? of : mios).slice(0, 6);
    $("#m-ofertas-titulo").textContent = of.length ? `Ofertas (${of.length})` : mios.length ? "Lo que vende" : "";
    $("#m-ofertas").innerHTML = lista.length ? lista.map((a) => `<div class="oferta-fila">${a.foto ? `<img src="${S.blob(a.foto)}" alt="">` : `<div class="sin">${S.icono("foto")}</div>`}<div class="nom">${S.esc(a.nombre)}${a.oferta ? ` <span class="oferta-pill">${S.esc(S.tipo(a, sitio.tiposOferta)?.nombre || "oferta")}</span>` : ""}</div>${S.precio(a)}</div>`).join("") + (mios.length > lista.length ? `<div class="vende" style="text-align:center">y ${mios.length - lista.length} más en su perfil</div>` : "") : `<div class="vende">Esta tienda aún no publicó artículos. Contáctala para consultar.</div>`;
    $("#m-contactar").href = `/tienda/${encodeURIComponent(t.id)}`;
    modal.showModal();
  }

  pintar();
})();
