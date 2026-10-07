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
  $("#pie-datos").textContent = [sitio.nombre, sitio.direccion, sitio.horario].filter(Boolean).join(" · ");

  // ---- Carrusel ----
  const pista = $("#pista"), puntos = $("#puntos");
  const diapos = sitio.carrusel.filter((d) => d && d.archivo);
  if (!diapos.length) {
    pista.innerHTML = `<div class="diapo diapo-vacia"><div><h1>${S.esc(sitio.nombre)}</h1><p>${S.esc(sitio.lema || "")}</p>${sitio.descripcion ? `<p>${S.esc(sitio.descripcion)}</p>` : ""}<a class="btn btn-dorado" href="#tiendas" style="margin-top:14px">Ver tiendas</a></div></div>`;
    $("#ant").hidden = $("#sig").hidden = true;
  } else {
    pista.innerHTML = diapos.map((d, i) => `<div class="diapo" role="group" aria-label="${i + 1} de ${diapos.length}"><img src="${S.blob(d.archivo)}" alt="${S.esc(d.titulo || "")}" ${i ? 'loading="lazy"' : ""}>${d.titulo || d.texto || d.enlace ? `<div class="diapo-texto">${d.titulo ? `<h2>${S.esc(d.titulo)}</h2>` : ""}${d.texto ? `<p>${S.esc(d.texto)}</p>` : ""}${d.enlace ? `<a class="btn btn-dorado" href="${S.esc(d.enlace)}">${S.esc(d.textoEnlace || "Ver más")}</a>` : ""}</div>` : ""}</div>`).join("");
    puntos.innerHTML = diapos.map((_, i) => `<button type="button" aria-label="Ir a la foto ${i + 1}" data-i="${i}"></button>`).join("");
    let actual = 0, temporizador;
    const ir = (i, suave = true) => { actual = (i + diapos.length) % diapos.length; pista.scrollTo({ left: actual * pista.clientWidth, behavior: suave ? "smooth" : "auto" }); };
    const marcar = () => { puntos.querySelectorAll("button").forEach((b, i) => b.setAttribute("aria-current", i === actual ? "true" : "false")); };
    const auto = () => { clearInterval(temporizador); if (diapos.length > 1) temporizador = setInterval(() => ir(actual + 1), 5000); };
    pista.addEventListener("scroll", () => { const i = Math.round(pista.scrollLeft / pista.clientWidth); if (i !== actual) { actual = i; marcar(); } }, { passive: true });
    puntos.onclick = (e) => { const b = e.target.closest("button"); if (b) { ir(Number(b.dataset.i)); auto(); } };
    $("#ant").onclick = () => { ir(actual - 1); auto(); }; $("#sig").onclick = () => { ir(actual + 1); auto(); };
    pista.addEventListener("pointerdown", () => clearInterval(temporizador)); pista.addEventListener("pointerup", auto);
    if (diapos.length < 2) { $("#ant").hidden = $("#sig").hidden = true; puntos.hidden = true; }
    marcar(); auto();
  }

  // ---- Burbujas y filtro ----
  const burbujas = $("#burbujas"); let filtro = new URLSearchParams(location.search).get("cat") || "";
  const conteo = (id) => tiendas.filter((t) => (t.categorias || []).includes(id)).length;
  const catsVisibles = sitio.categorias.filter((c) => c.visible !== false);
  burbujas.innerHTML = catsVisibles.map((c) => `<button type="button" class="burbuja" data-id="${S.esc(c.id)}" aria-pressed="false"><span class="ico">${c.icono ? S.esc(c.icono) : "🛍️"}</span><b>${S.esc(c.nombre)}</b></button>`).join("") || `<p class="vacio" style="width:100%">Aún no hay categorías.</p>`;
  burbujas.onclick = (e) => { const b = e.target.closest(".burbuja"); if (!b) return; filtro = filtro === b.dataset.id ? "" : b.dataset.id; pintar(); if (filtro) $("#tiendas").scrollIntoView({ behavior: "smooth", block: "start" }); };
  $("#filtro").onclick = (e) => { if (e.target.closest(".quitar")) { filtro = ""; pintar(); } };

  function pintar() {
    const c = cat.get(filtro);
    burbujas.querySelectorAll(".burbuja").forEach((b) => b.setAttribute("aria-pressed", b.dataset.id === filtro ? "true" : "false"));
    const f = $("#filtro"); f.hidden = !c; if (c) f.innerHTML = `Mostrando tiendas y artículos de <b>${S.esc(c.icono || "")} ${S.esc(c.nombre)}</b> <button type="button" class="quitar">✕ Ver todo</button>`;
    history.replaceState(null, "", c ? `?cat=${encodeURIComponent(filtro)}` : location.pathname);
    const ts = c ? tiendas.filter((t) => (t.categorias || []).includes(filtro)) : tiendas;
    const as = c ? articulos.filter((a) => a.categoriaId === filtro || (tiendaDe.get(a.tiendaId)?.categorias || []).includes(filtro) && !a.categoriaId) : articulos;
    $("#tiendas-titulo").textContent = c ? `Tiendas que venden ${c.nombre.toLowerCase()}` : "Tiendas";
    $("#tiendas-sub").textContent = `${ts.length} tienda${ts.length === 1 ? "" : "s"}${c ? "" : " · toca una categoría arriba para filtrar"}`;
    $("#lista-tiendas").innerHTML = ts.length ? ts.map(tarjetaTienda).join("") : `<div class="vacio" style="grid-column:1/-1">Todavía no hay tiendas publicadas${c ? ` en ${S.esc(c.nombre)}` : ""}.</div>`;
    $("#art-titulo").textContent = c ? `${c.nombre} en oferta y más` : "Variedad de artículos";
    $("#lista-articulos").innerHTML = as.length ? as.map(tarjetaArticulo).join("") : `<div class="vacio" style="grid-column:1/-1">Aún no hay artículos publicados${c ? ` en ${S.esc(c.nombre)}` : ""}.</div>`;
  }
  const nombresCat = (t) => (t.categorias || []).map((id) => cat.get(id)).filter(Boolean).slice(0, 3).map((c) => `<span class="etiqueta">${S.esc(c.icono || "")} ${S.esc(c.nombre)}</span>`).join("");
  function tarjetaTienda(t) {
    return `<article class="tienda" data-id="${S.esc(t.id)}">
      <div class="tienda-cab">${S.logo(t)}<div><h3>${S.esc(t.nombre)}</h3><div class="stand">${S.esc([t.stand, t.piso].filter(Boolean).join(" · ")) || "&nbsp;"}</div></div></div>
      <div class="etiquetas">${nombresCat(t)}${t.ofertas ? `<span class="oferta-pill">🔥 ${t.ofertas} oferta${t.ofertas === 1 ? "" : "s"}</span>` : ""}</div>
      <div class="tienda-acciones"><button type="button" class="btn btn-borde btn-sm ver">Ver ofertas</button><a class="btn btn-primario btn-sm" href="/tienda/${encodeURIComponent(t.id)}">Contactar</a></div>
    </article>`;
  }
  function tarjetaArticulo(a) {
    const t = tiendaDe.get(a.tiendaId) || {};
    return `<article class="art">
      <div class="art-foto">${a.foto ? `<img src="${S.blob(a.foto)}" alt="${S.esc(a.nombre)}" loading="lazy">` : `<span>${S.esc(cat.get(a.categoriaId)?.icono || "🛍️")}</span>`}${a.oferta ? `<span class="oferta-pill">OFERTA</span>` : ""}</div>
      <div class="art-cuerpo"><h3>${S.esc(a.nombre)}</h3>${S.precio(a)}${a.descripcion ? `<div class="vende">${S.esc(a.descripcion).slice(0, 90)}</div>` : ""}<div class="vende">Vende: <b>${S.esc(t.nombre || "—")}</b>${t.stand ? ` · ${S.esc(t.stand)}` : ""}</div>
      <a class="btn btn-primario btn-sm" href="/tienda/${encodeURIComponent(a.tiendaId)}${a.id ? `?art=${encodeURIComponent(a.id)}` : ""}">Contactar</a></div>
    </article>`;
  }

  // ---- Resumen de ofertas (modal) ----
  const modal = $("#modal");
  $("#lista-tiendas").onclick = (e) => { const b = e.target.closest(".ver"); if (!b) return; abrir(tiendaDe.get(b.closest(".tienda").dataset.id)); };
  $("#m-cerrar").onclick = () => modal.close(); modal.onclick = (e) => { if (e.target === modal) modal.close(); };
  function abrir(t) {
    if (!t) return;
    $("#m-logo").outerHTML = S.logo(t).replace('class="logo"', 'class="logo" id="m-logo"');
    $("#m-nombre").textContent = t.nombre; $("#m-stand").textContent = [t.stand, t.piso, t.horario].filter(Boolean).join(" · ");
    $("#m-desc").textContent = t.descripcion || "";
    const mios = articulos.filter((a) => a.tiendaId === t.id); const of = mios.filter((a) => a.oferta); const lista = (of.length ? of : mios).slice(0, 6);
    $("#m-ofertas-titulo").textContent = of.length ? `Ofertas (${of.length})` : mios.length ? "Lo que vende" : "";
    $("#m-ofertas").innerHTML = lista.length ? lista.map((a) => `<div class="oferta-fila">${a.foto ? `<img src="${S.blob(a.foto)}" alt="">` : `<div class="sin">${S.esc(cat.get(a.categoriaId)?.icono || "🛍️")}</div>`}<div class="nom">${S.esc(a.nombre)}${a.oferta ? ` <span class="oferta-pill">oferta</span>` : ""}</div>${S.precio(a)}</div>`).join("") + (mios.length > lista.length ? `<div class="vende" style="text-align:center">y ${mios.length - lista.length} más en su perfil</div>` : "") : `<div class="vende">Esta tienda aún no publicó artículos. Contáctala para consultar.</div>`;
    $("#m-contactar").href = `/tienda/${encodeURIComponent(t.id)}`;
    modal.showModal();
  }

  pintar();
  S.mostrarEditar("#editar");
})();
