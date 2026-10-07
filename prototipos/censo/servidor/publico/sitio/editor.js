// Editor de la web pública. Usa los mismos /api/db y /api/archivos del portal
// (sesión con permiso de edición). Todo se guarda al instante en el servidor.
(async function () {
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const nuevoId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const ahora = () => new Date().toISOString();
  let aviso; const estado = (t, mal = false) => { const e = $("#estado"); e.textContent = t; e.hidden = false; e.style.background = mal ? "var(--peligro, #b00020)" : "var(--brand-900)"; clearTimeout(aviso); aviso = setTimeout(() => (e.hidden = true), mal ? 5000 : 2200); };
  const subir = async (archivo, tipoEsperado) => {
    if (tipoEsperado && !archivo.type.startsWith(tipoEsperado)) throw new Error(`Se esperaba un archivo ${tipoEsperado === "image/" ? "de imagen" : "PDF"}.`);
    if (archivo.size > 20 * 1048576) throw new Error("El archivo pesa más de 20 MB.");
    const j = await S.pedir("POST", "/api/archivos", archivo, { "Content-Type": archivo.type || "application/octet-stream", "X-Nombre": encodeURIComponent(archivo.name || "") });
    return j.id;
  };
  const pedirArchivo = (accept) => new Promise((ok) => { const i = document.createElement("input"); i.type = "file"; i.accept = accept; i.onchange = () => ok(i.files[0] || null); i.click(); });

  // ---- Datos ----
  let config, tiendas = [], articulos = [];
  const cargar = async () => {
    const [c, t, a] = await Promise.all([fetch("/api/db/sitio/config").then((r) => (r.ok ? r.json() : null)), S.pedir("GET", "/api/db/tiendas"), S.pedir("GET", "/api/db/articulos")]);
    const pub = await S.pedir("GET", "/api/publico/sitio"); // trae los valores por defecto (categorías iniciales, nombre…)
    config = { ...pub.sitio, ...(c?.data || {}) }; if (!Array.isArray(config.categorias) || !config.categorias.length) config.categorias = pub.sitio.categorias; if (!Array.isArray(config.carrusel)) config.carrusel = [];
    tiendas = t.docs.map((d) => ({ id: d.id, ...d.data })).sort((a, b) => (a.orden ?? 999) - (b.orden ?? 999) || String(a.nombre || "").localeCompare(String(b.nombre || ""), "es"));
    articulos = a.docs.map((d) => ({ id: d.id, ...d.data })).sort((a, b) => String(b.actualizadoAt || "").localeCompare(String(a.actualizadoAt || "")));
  };
  const guardarConfig = async () => { await S.pedir("PUT", "/api/db/sitio/config", { ...config, actualizadoAt: ahora() }); estado("Guardado ✓"); };
  const catDe = (id) => config.categorias.find((c) => c.id === id);
  const tiendaDe = (id) => tiendas.find((t) => t.id === id);

  // ---- Pestañas ----
  $$(".pestanas button").forEach((b) => (b.onclick = () => { $$(".pestanas button").forEach((x) => x.setAttribute("aria-selected", x === b ? "true" : "false")); $$("[data-panel]").forEach((p) => (p.hidden = p.dataset.panel !== b.dataset.p)); location.hash = b.dataset.p; }));
  if (location.hash) $(`.pestanas button[data-p="${location.hash.slice(1)}"]`)?.click();
  $$("dialog [data-cerrar]").forEach((b) => (b.onclick = () => b.closest("dialog").close()));

  // ---- Portada ----
  const fS = $("#f-sitio");
  const pintarSitio = () => { for (const k of ["nombre", "lema", "descripcion", "direccion", "horario", "whatsapp"]) fS[k].value = config[k] || ""; };
  fS.onsubmit = async (e) => { e.preventDefault(); for (const k of ["nombre", "lema", "descripcion", "direccion", "horario", "whatsapp"]) config[k] = fS[k].value.trim(); try { await guardarConfig(); $("#sitio-estado").innerHTML = '<span class="ok">Guardado.</span>'; } catch (err) { estado(err.message, true); } };
  const pintarCarrusel = () => {
    $("#carrusel").innerHTML = config.carrusel.map((d, i) => `<div class="item"><img src="${S.blob(d.archivo)}" alt=""><div class="txt"><b>${S.esc(d.titulo || "(sin título)")}</b><small>${S.esc(d.texto || "")}${d.enlace ? ` · botón → ${S.esc(d.enlace)}` : ""}</small></div><div class="acc"><button class="btn btn-ghost btn-sm" data-mover="${i}:-1" ${i === 0 ? "disabled" : ""}>↑</button><button class="btn btn-ghost btn-sm" data-mover="${i}:1" ${i === config.carrusel.length - 1 ? "disabled" : ""}>↓</button><button class="btn btn-ghost btn-sm" data-texto="${i}">Texto</button><button class="btn btn-peligro btn-sm" data-quitar="${i}">Quitar</button></div></div>`).join("") || `<p class="ayuda">Aún no hay fotos. Sube la primera.</p>`;
  };
  $("#carrusel-subir").onchange = async (e) => {
    const lista = [...e.target.files]; if (!lista.length) return; $("#carrusel-estado").textContent = `Subiendo ${lista.length} foto(s)…`;
    try { for (const a of lista) config.carrusel.push({ archivo: await subir(a, "image/"), titulo: "", texto: "" }); await guardarConfig(); pintarCarrusel(); $("#carrusel-estado").textContent = ""; } catch (err) { $("#carrusel-estado").innerHTML = `<span class="mal">${S.esc(err.message)}</span>`; }
    e.target.value = "";
  };
  $("#carrusel").onclick = async (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.mover) { const [i, d] = b.dataset.mover.split(":").map(Number); const j = i + d; [config.carrusel[i], config.carrusel[j]] = [config.carrusel[j], config.carrusel[i]]; await guardarConfig(); pintarCarrusel(); }
    if (b.dataset.quitar !== undefined) { if (!confirm("¿Quitar esta foto del carrusel?")) return; const [q] = config.carrusel.splice(Number(b.dataset.quitar), 1); await guardarConfig(); pintarCarrusel(); S.pedir("DELETE", `/api/archivos/${q.archivo}`).catch(() => {}); }
    if (b.dataset.texto !== undefined) { const i = Number(b.dataset.texto), d = config.carrusel[i], f = $("#f-diapo"); for (const k of ["titulo", "texto", "textoEnlace", "enlace"]) f[k].value = d[k] || ""; f.onsubmit = async (ev) => { ev.preventDefault(); for (const k of ["titulo", "texto", "textoEnlace", "enlace"]) d[k] = f[k].value.trim(); await guardarConfig(); pintarCarrusel(); $("#d-diapo").close(); }; $("#d-diapo").showModal(); }
  };

  // ---- Categorías ----
  const pintarCategorias = () => {
    $("#categorias").innerHTML = config.categorias.map((c, i) => `<div class="item"><div class="ph">${S.esc(c.icono || "🛍️")}</div><div class="txt"><b>${S.esc(c.nombre)}</b><small>${tiendas.filter((t) => (t.categorias || []).includes(c.id)).length} tienda(s) · ${articulos.filter((a) => a.categoriaId === c.id).length} artículo(s)${c.visible === false ? " · <b>oculta</b>" : ""}</small></div><div class="acc"><button class="btn btn-ghost btn-sm" data-mover="${i}:-1" ${i === 0 ? "disabled" : ""}>↑</button><button class="btn btn-ghost btn-sm" data-mover="${i}:1" ${i === config.categorias.length - 1 ? "disabled" : ""}>↓</button><button class="btn btn-ghost btn-sm" data-editar="${i}">Editar</button><button class="btn btn-ghost btn-sm" data-ocultar="${i}">${c.visible === false ? "Mostrar" : "Ocultar"}</button><button class="btn btn-peligro btn-sm" data-quitar="${i}">Quitar</button></div></div>`).join("");
  };
  $("#f-cat").onsubmit = async (e) => { e.preventDefault(); const f = e.target; const nombre = f.nombre.value.trim(); if (!nombre) return; let id = nombre.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || nuevoId(); if (catDe(id)) id += "-" + nuevoId().slice(-3); config.categorias.push({ id, nombre, icono: f.icono.value.trim() }); await guardarConfig(); f.reset(); pintarCategorias(); };
  $("#categorias").onclick = async (e) => {
    const b = e.target.closest("button"); if (!b) return; const cs = config.categorias;
    if (b.dataset.mover) { const [i, d] = b.dataset.mover.split(":").map(Number); [cs[i], cs[i + d]] = [cs[i + d], cs[i]]; }
    if (b.dataset.editar !== undefined) { const c = cs[Number(b.dataset.editar)]; const n = prompt("Nombre de la categoría:", c.nombre); if (n === null) return; const ic = prompt("Ícono (emoji):", c.icono || ""); if (ic === null) return; c.nombre = n.trim() || c.nombre; c.icono = ic.trim(); }
    if (b.dataset.ocultar !== undefined) { const c = cs[Number(b.dataset.ocultar)]; c.visible = c.visible === false; }
    if (b.dataset.quitar !== undefined) { const i = Number(b.dataset.quitar); const n = tiendas.filter((t) => (t.categorias || []).includes(cs[i].id)).length; if (!confirm(`¿Quitar la categoría "${cs[i].nombre}"?${n ? ` ${n} tienda(s) la tienen asignada.` : ""}`)) return; cs.splice(i, 1); }
    await guardarConfig(); pintarCategorias();
  };

  // ---- Archivos en formularios (logo, QR, PDF, foto) ----
  const pintarArchivo = (caja, id) => {
    const esPdf = caja.dataset.tipo === "application/pdf"; caja.dataset.id = id || "";
    caja.innerHTML = (id ? (esPdf ? `<a class="doc" href="${S.blob(id)}" target="_blank" rel="noopener">📄 Ver PDF</a>` : `<img src="${S.blob(id)}" alt="">`) : `<span class="ayuda">Sin archivo</span>`) + ` <button type="button" class="btn btn-ghost btn-sm" data-subir>${id ? "Cambiar" : "Subir"}</button>${id ? ` <button type="button" class="btn btn-ghost btn-sm" data-quitar>Quitar</button>` : ""}`;
  };
  document.addEventListener("click", async (e) => {
    const b = e.target.closest(".archivo button"); if (!b) return; const caja = b.closest(".archivo");
    if (b.hasAttribute("data-quitar")) return pintarArchivo(caja, "");
    const a = await pedirArchivo(caja.dataset.tipo || "image/*"); if (!a) return;
    b.disabled = true; b.textContent = "Subiendo…";
    try { pintarArchivo(caja, await subir(a, caja.dataset.tipo || "image/")); } catch (err) { estado(err.message, true); b.disabled = false; b.textContent = "Subir"; }
  });
  const leerArchivos = (form) => Object.fromEntries($$(".archivo", form).map((c) => [c.dataset.campo, c.dataset.id || ""]));

  // ---- Tiendas ----
  const pintarTiendas = () => {
    const q = $("#buscar-tienda").value.trim().toLowerCase();
    const lista = tiendas.filter((t) => !q || `${t.nombre} ${t.stand} ${t.piso}`.toLowerCase().includes(q));
    $("#tiendas-n").textContent = `(${tiendas.length})`;
    $("#tiendas").innerHTML = lista.map((t) => `<div class="item">${t.logo ? `<img src="${S.blob(t.logo)}" alt="">` : `<div class="ph">${S.esc(S.iniciales(t.nombre))}</div>`}<div class="txt"><b>${S.esc(t.nombre)}${t.visible === false ? ' <span class="mal">(oculta)</span>' : ""}</b><small>${S.esc([t.stand, t.piso].filter(Boolean).join(" · "))} · ${(t.categorias || []).map((c) => catDe(c)?.nombre).filter(Boolean).join(", ") || "sin categoría"} · ${articulos.filter((a) => a.tiendaId === t.id).length} artículo(s)${t.whatsapp ? "" : ' · <span class="mal">sin WhatsApp</span>'}</small></div><div class="acc"><a class="btn btn-ghost btn-sm" href="/tienda/${encodeURIComponent(t.id)}" target="_blank" rel="noopener">Ver perfil</a><button class="btn btn-primary btn-sm" data-editar="${S.esc(t.id)}">Editar</button></div></div>`).join("") || `<p class="ayuda">No hay tiendas${q ? " que coincidan" : ". Crea la primera con “＋ Nueva tienda”"}.</p>`;
  };
  $("#buscar-tienda").oninput = pintarTiendas;
  const fT = $("#f-tienda"), dT = $("#d-tienda"); let tiendaActual = null;
  const abrirTienda = (t) => {
    tiendaActual = t; $("#t-titulo").textContent = t ? `Editar: ${t.nombre}` : "Nueva tienda"; $("#t-borrar").hidden = !t;
    fT.reset(); for (const k of ["nombre", "stand", "piso", "descripcion", "whatsapp", "telefono", "horario", "qrPagoTexto", "catalogoUrl", "ubicacionUrl", "orden"]) fT[k].value = t?.[k] ?? "";
    for (const k of ["facebook", "instagram", "tiktok"]) fT[k].value = t?.redes?.[k] || "";
    fT.enlaces.value = (t?.enlaces || []).map((e) => `${e.titulo || ""} | ${e.url || ""}`).join("\n"); fT.visible.checked = t ? t.visible !== false : true;
    $("#t-cats").innerHTML = config.categorias.map((c) => `<label><input type="checkbox" name="cat" value="${S.esc(c.id)}" ${(t?.categorias || []).includes(c.id) ? "checked" : ""}>${S.esc(c.icono || "")} ${S.esc(c.nombre)}</label>`).join("") || `<span class="ayuda">Primero crea categorías en la pestaña “Categorías”.</span>`;
    for (const caja of $$(".archivo", fT)) pintarArchivo(caja, t?.[caja.dataset.campo] || "");
    dT.showModal();
  };
  $("#nueva-tienda").onclick = () => abrirTienda(null);
  $("#tiendas").onclick = (e) => { const b = e.target.closest("[data-editar]"); if (b) abrirTienda(tiendaDe(b.dataset.editar)); };
  fT.onsubmit = async (e) => {
    e.preventDefault();
    const d = { ...(tiendaActual || { creadoAt: ahora() }) }; delete d.id;
    for (const k of ["nombre", "stand", "piso", "descripcion", "whatsapp", "telefono", "horario", "qrPagoTexto", "catalogoUrl", "ubicacionUrl"]) d[k] = fT[k].value.trim();
    d.orden = fT.orden.value === "" ? null : Number(fT.orden.value); d.visible = fT.visible.checked;
    d.categorias = $$("input[name=cat]:checked", fT).map((i) => i.value);
    d.redes = { facebook: fT.facebook.value.trim(), instagram: fT.instagram.value.trim(), tiktok: fT.tiktok.value.trim() };
    d.enlaces = fT.enlaces.value.split("\n").map((l) => l.split("|").map((s) => s.trim())).filter((p) => p[1] || p[0]).map(([titulo, url]) => ({ titulo, url: url || titulo }));
    Object.assign(d, leerArchivos(fT)); d.actualizadoAt = ahora();
    const id = tiendaActual?.id || nuevoId();
    try { await S.pedir("PUT", `/api/db/tiendas/${id}`, d); dT.close(); estado("Tienda guardada ✓"); await cargar(); pintarTodo(); } catch (err) { estado(err.message, true); }
  };
  $("#t-borrar").onclick = async () => { if (!tiendaActual) return; const n = articulos.filter((a) => a.tiendaId === tiendaActual.id).length; if (!confirm(`¿Borrar la tienda "${tiendaActual.nombre}"?${n ? ` También se borrarán sus ${n} artículo(s).` : ""}`)) return; try { for (const a of articulos.filter((a) => a.tiendaId === tiendaActual.id)) await S.pedir("DELETE", `/api/db/articulos/${a.id}`); await S.pedir("DELETE", `/api/db/tiendas/${tiendaActual.id}`); dT.close(); estado("Tienda borrada"); await cargar(); pintarTodo(); } catch (err) { estado(err.message, true); } };

  // ---- Artículos ----
  const pintarArticulos = () => {
    const sel = $("#filtro-art-tienda"); const val = sel.value; sel.innerHTML = `<option value="">Todas las tiendas</option>` + tiendas.map((t) => `<option value="${S.esc(t.id)}">${S.esc(t.nombre)}</option>`).join(""); sel.value = val;
    const lista = articulos.filter((a) => !val || a.tiendaId === val);
    $("#articulos-n").textContent = `(${articulos.length})`;
    $("#articulos").innerHTML = lista.map((a) => `<div class="item">${a.foto ? `<img src="${S.blob(a.foto)}" alt="">` : `<div class="ph">${S.esc(catDe(a.categoriaId)?.icono || "🛍️")}</div>`}<div class="txt"><b>${S.esc(a.nombre)}${a.oferta ? ' <span class="ok">· OFERTA</span>' : ""}${a.visible === false ? ' <span class="mal">(oculto)</span>' : ""}</b><small>${S.esc(tiendaDe(a.tiendaId)?.nombre || "⚠ tienda borrada")} · ${S.esc(catDe(a.categoriaId)?.nombre || "sin categoría")} · ${S.soles(a.precio) || "sin precio"}${a.oferta && a.precioOferta ? ` → ${S.soles(a.precioOferta)}` : ""}</small></div><div class="acc"><button class="btn btn-primary btn-sm" data-editar="${S.esc(a.id)}">Editar</button></div></div>`).join("") || `<p class="ayuda">No hay artículos${val ? " de esta tienda" : ""}. Crea uno con “＋ Nuevo artículo”.</p>`;
  };
  $("#filtro-art-tienda").onchange = pintarArticulos;
  const fA = $("#f-art"), dA = $("#d-art"); let artActual = null;
  const abrirArticulo = (a) => {
    if (!tiendas.length) return estado("Primero crea una tienda.", true);
    artActual = a; $("#a-titulo").textContent = a ? `Editar: ${a.nombre}` : "Nuevo artículo"; $("#a-borrar").hidden = !a;
    fA.reset(); fA.tiendaId.innerHTML = tiendas.map((t) => `<option value="${S.esc(t.id)}">${S.esc(t.nombre)}</option>`).join(""); fA.categoriaId.innerHTML = `<option value="">—</option>` + config.categorias.map((c) => `<option value="${S.esc(c.id)}">${S.esc(c.icono || "")} ${S.esc(c.nombre)}</option>`).join("");
    for (const k of ["nombre", "descripcion", "precio", "precioOferta"]) fA[k].value = a?.[k] ?? "";
    fA.tiendaId.value = a?.tiendaId || $("#filtro-art-tienda").value || tiendas[0].id; fA.categoriaId.value = a?.categoriaId || ""; fA.oferta.checked = !!a?.oferta; fA.destacado.checked = !!a?.destacado; fA.visible.checked = a ? a.visible !== false : true;
    pintarArchivo($(".archivo", fA), a?.foto || ""); dA.showModal();
  };
  $("#nuevo-articulo").onclick = () => abrirArticulo(null);
  $("#articulos").onclick = (e) => { const b = e.target.closest("[data-editar]"); if (b) abrirArticulo(articulos.find((a) => a.id === b.dataset.editar)); };
  fA.onsubmit = async (e) => {
    e.preventDefault();
    const d = { ...(artActual || { creadoAt: ahora() }) }; delete d.id;
    d.nombre = fA.nombre.value.trim(); d.descripcion = fA.descripcion.value.trim(); d.tiendaId = fA.tiendaId.value; d.categoriaId = fA.categoriaId.value;
    d.precio = fA.precio.value === "" ? null : Number(fA.precio.value); d.precioOferta = fA.precioOferta.value === "" ? null : Number(fA.precioOferta.value); d.oferta = fA.oferta.checked; d.destacado = fA.destacado.checked; d.visible = fA.visible.checked;
    Object.assign(d, leerArchivos(fA)); d.actualizadoAt = ahora();
    try { await S.pedir("PUT", `/api/db/articulos/${artActual?.id || nuevoId()}`, d); dA.close(); estado("Artículo guardado ✓"); await cargar(); pintarTodo(); } catch (err) { estado(err.message, true); }
  };
  $("#a-borrar").onclick = async () => { if (!artActual || !confirm(`¿Borrar "${artActual.nombre}"?`)) return; try { await S.pedir("DELETE", `/api/db/articulos/${artActual.id}`); dA.close(); estado("Artículo borrado"); await cargar(); pintarTodo(); } catch (err) { estado(err.message, true); } };

  const pintarTodo = () => { pintarSitio(); pintarCarrusel(); pintarCategorias(); pintarTiendas(); pintarArticulos(); };
  try { await cargar(); pintarTodo(); } catch (err) { estado("No se pudo cargar: " + err.message, true); }
  // Si alguien más edita a la vez, refrescar listas.
  try { const ev = new EventSource("/api/eventos"); let t; ev.onmessage = (e) => { const m = JSON.parse(e.data); if (!["sitio", "tiendas", "articulos"].includes(m.col)) return; clearTimeout(t); t = setTimeout(async () => { if (dT.open || dA.open || $("#d-diapo").open) return; await cargar(); pintarTodo(); }, 400); }; } catch { /* sin SSE */ }
})();
