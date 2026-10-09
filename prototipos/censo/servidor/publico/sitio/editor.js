// Editor de la web pública. Usa los mismos /api/db y /api/archivos del portal
// (sesión con permiso de edición). Todo se guarda al instante en el servidor.
(async function () {
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const nuevoId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const ahora = () => new Date().toISOString();
  let aviso; const estado = (t, mal = false) => { const e = $("#estado"); e.textContent = t; e.hidden = false; e.style.background = mal ? "var(--peligro, #b00020)" : "var(--brand-900)"; clearTimeout(aviso); aviso = setTimeout(() => (e.hidden = true), mal ? 5000 : 2200); };
  // Reduce la imagen en el navegador antes de subirla: lado mayor ≤ max px, JPEG (o PNG para logos/QR).
  // Así una foto de celular de 5 MB queda en ~200 KB y la web carga rápido con datos móviles.
  const MAX_IMAGEN = 2.5 * 1048576;
  const comprimirImagen = async (archivo, { max = 1200, png = false, calidad = 0.84 } = {}) => {
    if (!archivo.type.startsWith("image/") || /gif|svg/.test(archivo.type)) return archivo;
    let bmp; try { bmp = await createImageBitmap(archivo, { imageOrientation: "from-image" }); } catch { try { bmp = await createImageBitmap(archivo); } catch { return archivo; } }
    const esc = Math.min(1, max / Math.max(bmp.width, bmp.height)); const w = Math.max(1, Math.round(bmp.width * esc)), h = Math.max(1, Math.round(bmp.height * esc));
    const usarPng = png && archivo.type === "image/png";
    if (esc === 1 && archivo.size <= 350 * 1024) { bmp.close?.(); return archivo; } // ya es chica
    const c = document.createElement("canvas"); c.width = w; c.height = h; const ctx = c.getContext("2d");
    if (!usarPng) { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h); } ctx.drawImage(bmp, 0, 0, w, h); bmp.close?.();
    const blob = await new Promise((ok) => c.toBlob(ok, usarPng ? "image/png" : "image/jpeg", calidad));
    if (!blob || blob.size >= archivo.size) return archivo;
    return new File([blob], String(archivo.name || "imagen").replace(/\.\w+$/, "") + (usarPng ? ".png" : ".jpg"), { type: blob.type });
  };
  const subir = async (archivo, tipoEsperado, opciones = {}) => {
    if (tipoEsperado && !archivo.type.startsWith(tipoEsperado)) throw new Error(`Se esperaba un archivo ${tipoEsperado === "image/" ? "de imagen" : "PDF"}.`);
    if (archivo.size > 20 * 1048576) throw new Error("El archivo pesa más de 20 MB.");
    if (archivo.type.startsWith("image/")) { archivo = await comprimirImagen(archivo, opciones); if (archivo.size > MAX_IMAGEN) throw new Error(`La imagen sigue pesando ${(archivo.size / 1048576).toFixed(1)} MB (máximo 2,5 MB). Prueba con otra foto o recórtala.`); }
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
  // ---- Validación en el navegador (el servidor vuelve a validar) ----
  const esWhatsapp = (v) => { const s = String(v || "").trim(); if (!s) return true; if (/[^\d\s()+-]/.test(s)) return false; const d = s.replace(/\D/g, ""); return /^9\d{8}$/.test(d) || /^519\d{8}$/.test(d); };
  const esEnlace = (v) => { const s = String(v || "").trim(); return !s || /^(https?:\/\/|mailto:|tel:)/i.test(s) || (/^[/?#]/.test(s) && !/^\/\//.test(s)) || /^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(s); };
  const marcar = (campo, msj) => { campo.setAttribute("aria-invalid", "true"); campo.focus(); estado(msj, true); campo.oninput = () => campo.removeAttribute("aria-invalid"); return false; };
  const validarSitio = (f) => {
    if (!f.nombre.value.trim()) return marcar(f.nombre, "El centro comercial necesita un nombre.");
    if (!esWhatsapp(f.whatsapp.value)) return marcar(f.whatsapp, "El WhatsApp debe tener 9 dígitos y empezar con 9 (ej. 987654321).");
    return true;
  };
  const validarTienda = (f) => {
    if (!f.nombre.value.trim()) return marcar(f.nombre, "La tienda necesita un nombre.");
    if (!esWhatsapp(f.whatsapp.value)) return marcar(f.whatsapp, "El WhatsApp debe tener 9 dígitos y empezar con 9 (ej. 987654321).");
    if (f.telefono.value && !/^[\d\s()+-]{6,20}$/.test(f.telefono.value.trim())) return marcar(f.telefono, "Revisa el teléfono: solo números, espacios, + o guiones.");
    if (!esEnlace(f.catalogoUrl.value)) return marcar(f.catalogoUrl, "El enlace del catálogo debe empezar con https://");
    if (!esEnlace(f.ubicacionUrl.value)) return marcar(f.ubicacionUrl, "El enlace de ubicación debe empezar con https://");
    if (!esEnlace(f.contactoUrl.value)) return marcar(f.contactoUrl, "El enlace del botón Contactar debe empezar con https://");
    for (const l of f.enlaces.value.split("\n")) { const [tit, url] = l.split("|").map((x) => (x || "").trim()); if ((tit || url) && !esEnlace(url || tit)) return marcar(f.enlaces, `El enlace "${tit || url}" no es válido: escribe "Título | https://…".`); }
    if (f.orden.value !== "" && !(Number(f.orden.value) >= 0)) return marcar(f.orden, "El orden debe ser un número desde 0.");
    return true;
  };
  const validarArticulo = (f) => {
    if (!f.nombre.value.trim()) return marcar(f.nombre, "El artículo necesita un nombre.");
    if (!f.tiendaId.value) return marcar(f.tiendaId, "Elige la tienda que lo vende.");
    const precio = f.precio.value === "" ? null : Number(f.precio.value), oferta = f.precioOferta.value === "" ? null : Number(f.precioOferta.value);
    if (precio !== null && !(precio >= 0)) return marcar(f.precio, "El precio debe ser un número desde 0.");
    if (oferta !== null && !(oferta >= 0)) return marcar(f.precioOferta, "El precio de oferta debe ser un número desde 0.");
    if (f.oferta.checked && precio > 0 && oferta > 0 && oferta >= precio) return marcar(f.precioOferta, "El precio de oferta debe ser menor que el precio normal.");
    if (f.oferta.checked && ofertasDe(f.tiendaId.value, artActual?.id) >= MAX_OFERTAS) return marcar(f.oferta, `Esta tienda ya tiene ${MAX_OFERTAS} artículos en oferta (el máximo). Quita una oferta antes de agregar otra.`);
    if (f.oferta.checked && !(oferta > 0) && !(precio > 0)) estado("Sin precios la oferta saldrá como “consultar precio”.");
    return true;
  };

  fS.onsubmit = async (e) => { e.preventDefault(); if (!validarSitio(fS)) return; for (const k of ["nombre", "lema", "descripcion", "direccion", "horario", "whatsapp"]) config[k] = fS[k].value.trim(); try { await guardarConfig(); $("#sitio-estado").innerHTML = '<span class="ok">Guardado.</span>'; } catch (err) { estado(err.message, true); $("#sitio-estado").innerHTML = `<span class="mal">${S.esc(err.message)}</span>`; } };
  const pintarCarrusel = () => {
    $("#carrusel").innerHTML = config.carrusel.map((d, i) => `<div class="item"><img src="${S.blob(d.archivo)}" alt="">${d.archivoMovil ? `<img src="${S.blob(d.archivoMovil)}" alt="" style="width:40px;height:68px" title="Foto para celular">` : ""}<div class="txt"><b>${S.esc(d.titulo || "(sin título)")}</b><small>${S.esc(d.texto || "")}${d.enlace ? ` · botón → ${S.esc(d.enlace)}` : ""}${d.archivoMovil ? " · con foto para celular" : ""}</small></div><div class="acc"><button class="btn btn-ghost btn-sm" data-mover="${i}:-1" ${i === 0 ? "disabled" : ""}>↑</button><button class="btn btn-ghost btn-sm" data-mover="${i}:1" ${i === config.carrusel.length - 1 ? "disabled" : ""}>↓</button><button class="btn btn-ghost btn-sm" data-texto="${i}">Texto</button><button class="btn btn-ghost btn-sm" data-movil="${i}" title="Versión vertical o cuadrada que se muestra en celulares">${d.archivoMovil ? "Cambiar foto celular" : "Foto celular"}</button>${d.archivoMovil ? `<button class="btn btn-ghost btn-sm" data-sin-movil="${i}">Sin foto celular</button>` : ""}<button class="btn btn-peligro btn-sm" data-quitar="${i}">Quitar</button></div></div>`).join("") || `<p class="ayuda">Aún no hay fotos. Sube la primera.</p>`;
  };
  $("#carrusel-subir").onchange = async (e) => {
    const lista = [...e.target.files]; if (!lista.length) return; $("#carrusel-estado").textContent = `Subiendo ${lista.length} foto(s)…`;
    try { for (const a of lista) config.carrusel.push({ archivo: await subir(a, "image/", { max: 1920, calidad: 0.86 }), titulo: "", texto: "" }); await guardarConfig(); pintarCarrusel(); $("#carrusel-estado").textContent = ""; } catch (err) { $("#carrusel-estado").innerHTML = `<span class="mal">${S.esc(err.message)}</span>`; }
    e.target.value = "";
  };
  $("#carrusel").onclick = async (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.mover) { const [i, d] = b.dataset.mover.split(":").map(Number); const j = i + d; [config.carrusel[i], config.carrusel[j]] = [config.carrusel[j], config.carrusel[i]]; await guardarConfig(); pintarCarrusel(); }
    if (b.dataset.quitar !== undefined) { if (!confirm("¿Quitar esta foto del carrusel?")) return; const [q] = config.carrusel.splice(Number(b.dataset.quitar), 1); await guardarConfig(); pintarCarrusel(); for (const id of [q.archivo, q.archivoMovil]) if (id) S.pedir("DELETE", `/api/archivos/${id}`).catch(() => {}); }
    if (b.dataset.movil !== undefined) { const a = await pedirArchivo("image/*"); if (!a) return; b.disabled = true; b.textContent = "Subiendo…"; try { config.carrusel[Number(b.dataset.movil)].archivoMovil = await subir(a, "image/", { max: 1350, calidad: 0.86 }); await guardarConfig(); } catch (err) { estado(err.message, true); } pintarCarrusel(); }
    if (b.dataset.sinMovil !== undefined) { const d = config.carrusel[Number(b.dataset.sinMovil)]; const v = d.archivoMovil; delete d.archivoMovil; await guardarConfig(); pintarCarrusel(); if (v) S.pedir("DELETE", `/api/archivos/${v}`).catch(() => {}); }
    if (b.dataset.texto !== undefined) { const i = Number(b.dataset.texto), d = config.carrusel[i], f = $("#f-diapo"); for (const k of ["titulo", "texto", "textoEnlace", "enlace"]) f[k].value = d[k] || ""; f.onsubmit = async (ev) => { ev.preventDefault(); for (const k of ["titulo", "texto", "textoEnlace", "enlace"]) d[k] = f[k].value.trim(); await guardarConfig(); pintarCarrusel(); $("#d-diapo").close(); }; $("#d-diapo").showModal(); }
  };

  // ---- Categorías ----
  const pintarCategorias = () => {
    $("#categorias").innerHTML = config.categorias.map((c, i) => `<div class="item">${c.imagen ? `<img src="${S.blob(c.imagen)}" alt="">` : `<div class="ph">${S.esc(String(c.nombre || "?").charAt(0).toUpperCase())}</div>`}<div class="txt"><b>${S.esc(c.nombre)}</b><small>${tiendas.filter((t) => (t.categorias || []).includes(c.id)).length} tienda(s) · ${articulos.filter((a) => a.categoriaId === c.id).length} artículo(s)${c.visible === false ? " · <b>oculta</b>" : ""}</small></div><div class="acc"><button class="btn btn-ghost btn-sm" data-mover="${i}:-1" ${i === 0 ? "disabled" : ""}>↑</button><button class="btn btn-ghost btn-sm" data-mover="${i}:1" ${i === config.categorias.length - 1 ? "disabled" : ""}>↓</button><button class="btn btn-ghost btn-sm" data-editar="${i}">Editar</button><button class="btn btn-ghost btn-sm" data-imagen="${i}">${c.imagen ? "Cambiar imagen" : "Subir imagen"}</button>${c.imagen ? `<button class="btn btn-ghost btn-sm" data-sin-imagen="${i}">Quitar imagen</button>` : ""}<button class="btn btn-ghost btn-sm" data-ocultar="${i}">${c.visible === false ? "Mostrar" : "Ocultar"}</button><button class="btn btn-peligro btn-sm" data-quitar="${i}">Quitar</button></div></div>`).join("");
  };
  $("#f-cat").onsubmit = async (e) => { e.preventDefault(); const f = e.target; const nombre = f.nombre.value.trim(); if (!nombre) return; let id = nombre.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || nuevoId(); if (catDe(id)) id += "-" + nuevoId().slice(-3); config.categorias.push({ id, nombre, icono: f.icono.value.trim() }); await guardarConfig(); f.reset(); pintarCategorias(); };
  $("#categorias").onclick = async (e) => {
    const b = e.target.closest("button"); if (!b) return; const cs = config.categorias;
    if (b.dataset.mover) { const [i, d] = b.dataset.mover.split(":").map(Number); [cs[i], cs[i + d]] = [cs[i + d], cs[i]]; }
    if (b.dataset.editar !== undefined) { const c = cs[Number(b.dataset.editar)]; const n = prompt("Nombre de la categoría:", c.nombre); if (n === null) return; c.nombre = n.trim() || c.nombre; }
    if (b.dataset.ocultar !== undefined) { const c = cs[Number(b.dataset.ocultar)]; c.visible = c.visible === false; }
    if (b.dataset.imagen !== undefined) { const a = await pedirArchivo("image/*"); if (!a) return; b.disabled = true; b.textContent = "Subiendo…"; try { cs[Number(b.dataset.imagen)].imagen = await subir(a, "image/", { max: 400, png: true }); } catch (err) { estado(err.message, true); pintarCategorias(); return; } }
    if (b.dataset.sinImagen !== undefined) { const c = cs[Number(b.dataset.sinImagen)]; const vieja = c.imagen; delete c.imagen; if (vieja) S.pedir("DELETE", `/api/archivos/${vieja}`).catch(() => {}); }
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
    try { pintarArchivo(caja, await subir(a, caja.dataset.tipo || "image/", { max: Number(caja.dataset.max) || 1200, png: caja.dataset.formato === "png" })); } catch (err) { estado(err.message, true); b.disabled = false; b.textContent = "Subir"; }
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
    fT.reset(); for (const k of ["nombre", "stand", "piso", "descripcion", "whatsapp", "telefono", "horario", "qrPagoTexto", "catalogoUrl", "ubicacionUrl", "contactoUrl", "contactoTexto", "orden"]) fT[k].value = t?.[k] ?? "";
    for (const k of ["facebook", "instagram", "tiktok"]) fT[k].value = t?.redes?.[k] || "";
    fT.enlaces.value = (t?.enlaces || []).map((e) => `${e.titulo || ""} | ${e.url || ""}`).join("\n"); fT.visible.checked = t ? t.visible !== false : true;
    $("#t-cats").innerHTML = config.categorias.map((c) => `<label><input type="checkbox" name="cat" value="${S.esc(c.id)}" ${(t?.categorias || []).includes(c.id) ? "checked" : ""}>${S.esc(c.nombre)}</label>`).join("") || `<span class="ayuda">Primero crea categorías en la pestaña “Categorías”.</span>`;
    for (const caja of $$(".archivo", fT)) pintarArchivo(caja, t?.[caja.dataset.campo] || "");
    dT.showModal();
  };
  $("#nueva-tienda").onclick = () => abrirTienda(null);
  $("#tiendas").onclick = (e) => { const b = e.target.closest("[data-editar]"); if (b) abrirTienda(tiendaDe(b.dataset.editar)); };
  fT.onsubmit = async (e) => {
    e.preventDefault();
    if (!validarTienda(fT)) return;
    const d = { ...(tiendaActual || { creadoAt: ahora() }) }; delete d.id;
    for (const k of ["nombre", "stand", "piso", "descripcion", "whatsapp", "telefono", "horario", "qrPagoTexto", "catalogoUrl", "ubicacionUrl", "contactoUrl", "contactoTexto"]) d[k] = fT[k].value.trim();
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
    $("#articulos").innerHTML = lista.map((a) => `<div class="item">${a.foto ? `<img src="${S.blob(a.foto)}" alt="">` : `<div class="ph">${S.esc(String(a.nombre || "?").charAt(0).toUpperCase())}</div>`}<div class="txt"><b>${S.esc(a.nombre)}${a.oferta ? ` <span class="ok">· ${S.esc(((config.tiposOferta || []).find((t) => t.id === (a.tipoOferta || "oferta"))?.nombre || "Oferta").toUpperCase())}${a.etiquetaOferta ? " · " + S.esc(a.etiquetaOferta) : ""}</span>` : ""}${a.visible === false ? ' <span class="mal">(oculto)</span>' : ""}</b><small>${S.esc(tiendaDe(a.tiendaId)?.nombre || "⚠ tienda borrada")} · ${S.esc(catDe(a.categoriaId)?.nombre || "sin categoría")} · ${S.soles(a.precio) || "sin precio"}${a.oferta && a.precioOferta ? ` → ${S.soles(a.precioOferta)}` : ""}</small></div><div class="acc"><button class="btn btn-primary btn-sm" data-editar="${S.esc(a.id)}">Editar</button></div></div>`).join("") || `<p class="ayuda">No hay artículos${val ? " de esta tienda" : ""}. Crea uno con “＋ Nuevo artículo”.</p>`;
  };
  $("#filtro-art-tienda").onchange = pintarArticulos;
  const fA = $("#f-art"), dA = $("#d-art"); let artActual = null;
  const MAX_OFERTAS = 15;
  const ofertasDe = (tiendaId, excluirId) => articulos.filter((a) => a.tiendaId === tiendaId && a.oferta && a.visible !== false && a.id !== excluirId).length;
  const avisoOfertas = () => { const n = ofertasDe(fA.tiendaId.value, artActual?.id); const e = $("#a-ofertas-aviso"); if (!e) return; e.textContent = `Ofertas publicadas de esta tienda: ${n} de ${MAX_OFERTAS}${n >= MAX_OFERTAS ? " · llegó al máximo" : ""}.`; e.classList.toggle("mal", n >= MAX_OFERTAS); };
  const abrirArticulo = (a) => {
    if (!tiendas.length) return estado("Primero crea una tienda.", true);
    artActual = a; $("#a-titulo").textContent = a ? `Editar: ${a.nombre}` : "Nuevo artículo"; $("#a-borrar").hidden = !a;
    fA.reset(); fA.tiendaId.innerHTML = tiendas.map((t) => `<option value="${S.esc(t.id)}">${S.esc(t.nombre)}</option>`).join(""); fA.categoriaId.innerHTML = `<option value="">—</option>` + config.categorias.map((c) => `<option value="${S.esc(c.id)}">${S.esc(c.nombre)}</option>`).join("");
    fA.tipoOferta.innerHTML = (config.tiposOferta || []).map((t) => `<option value="${S.esc(t.id)}">${S.esc(t.nombre)}</option>`).join("");
    for (const k of ["nombre", "descripcion", "precio", "precioOferta", "etiquetaOferta"]) fA[k].value = a?.[k] ?? "";
    fA.tipoOferta.value = a?.tipoOferta || "oferta"; if (!fA.tipoOferta.value) fA.tipoOferta.value = "oferta";
    const mostrarTipo = () => { $("#a-tipo-fila").hidden = !fA.oferta.checked; avisoOfertas(); }; fA.oferta.onchange = mostrarTipo; fA.tiendaId.onchange = avisoOfertas;
    fA.tiendaId.value = a?.tiendaId || $("#filtro-art-tienda").value || tiendas[0].id; fA.categoriaId.value = a?.categoriaId || ""; fA.oferta.checked = !!a?.oferta; fA.destacado.checked = !!a?.destacado; fA.visible.checked = a ? a.visible !== false : true;
    pintarArchivo($(".archivo", fA), a?.foto || ""); mostrarTipo(); dA.showModal();
  };
  $("#nuevo-articulo").onclick = () => abrirArticulo(null);
  $("#articulos").onclick = (e) => { const b = e.target.closest("[data-editar]"); if (b) abrirArticulo(articulos.find((a) => a.id === b.dataset.editar)); };
  fA.onsubmit = async (e) => {
    e.preventDefault();
    if (!validarArticulo(fA)) return;
    const d = { ...(artActual || { creadoAt: ahora() }) }; delete d.id;
    d.nombre = fA.nombre.value.trim(); d.descripcion = fA.descripcion.value.trim(); d.tiendaId = fA.tiendaId.value; d.categoriaId = fA.categoriaId.value;
    d.precio = fA.precio.value === "" ? null : Number(fA.precio.value); d.precioOferta = fA.precioOferta.value === "" ? null : Number(fA.precioOferta.value); d.oferta = fA.oferta.checked; d.destacado = fA.destacado.checked; d.visible = fA.visible.checked; d.tipoOferta = fA.oferta.checked ? fA.tipoOferta.value : ""; d.etiquetaOferta = fA.oferta.checked ? fA.etiquetaOferta.value.trim() : "";
    Object.assign(d, leerArchivos(fA)); d.actualizadoAt = ahora();
    try { await S.pedir("PUT", `/api/db/articulos/${artActual?.id || nuevoId()}`, d); dA.close(); estado("Artículo guardado ✓"); await cargar(); pintarTodo(); } catch (err) { estado(err.message, true); }
  };
  $("#a-borrar").onclick = async () => { if (!artActual || !confirm(`¿Borrar "${artActual.nombre}"?`)) return; try { await S.pedir("DELETE", `/api/db/articulos/${artActual.id}`); dA.close(); estado("Artículo borrado"); await cargar(); pintarTodo(); } catch (err) { estado(err.message, true); } };

  const pintarTodo = () => { pintarSitio(); pintarCarrusel(); pintarCategorias(); pintarTiendas(); pintarArticulos(); };

  // ---- Datos de ejemplo para exposición (imágenes generadas en el navegador) ----
  const EJ = {
    banners: [
      { titulo: "Campaña escolar 2027", texto: "Mochilas desde S/ 25 al por mayor · más de 250 tiendas", enlace: "?cat=mochilas", textoEnlace: "Ver mochilas", colores: ["#0f4656", "#2aa7c0"], inicial: "M" },
      { titulo: "Liquidación de maletas", texto: "Hasta 40 % de descuento en maletas de cabina y bodega", enlace: "?cat=maletas", textoEnlace: "Ver maletas", colores: ["#7a0d0d", "#E01B1B"], inicial: "%" },
      { titulo: "Carteras y billeteras de cuero", texto: "Directo del fabricante · Galerías A y C", enlace: "?cat=carteras", textoEnlace: "Ver carteras", colores: ["#5a4300", "#E4C000"], inicial: "C" },
    ],
    tiendas: [
      { nombre: "Mochilas Pérez", stand: "Stand 1012", piso: "Galería A · 1er piso", cats: ["mochilas", "cartucheras"], wa: "987654321", desc: "Fabricamos mochilas escolares, de viaje y morrales urbanos. Venta por mayor desde 6 unidades y al menudeo.", redes: { instagram: "@mochilasperez", facebook: "mochilasperezlima" }, horario: "Lun–Sáb 9:00–19:30", colores: ["#2aa7c0", "#155e72"], qr: "Yape 987654321 · Juan Pérez" },
      { nombre: "Creaciones Lucero", stand: "Stand 1045", piso: "Galería B · 2do piso", cats: ["carteras", "billeteras"], wa: "912345678", desc: "Carteras de moda, bandoleras y billeteras para dama. Nuevos modelos cada semana.", redes: { instagram: "@creacioneslucero", tiktok: "@creacioneslucero" }, horario: "Lun–Dom 10:00–20:00", colores: ["#d946ef", "#7c3aed"], qr: "Plin 912345678 · Lucero Quispe" },
      { nombre: "Cueros Andinos", stand: "Stand 1078", piso: "Galería A · 1er piso", cats: ["carteras", "billeteras", "accesorios"], wa: "998877665", desc: "Cuero legítimo trabajado a mano: carteras, billeteras, correas y porta documentos.", redes: { facebook: "cuerosandinosperu" }, horario: "Lun–Sáb 9:30–19:00", colores: ["#7c4a1e", "#3b2412"], qr: "Yape 998877665 · Cueros Andinos" },
      { nombre: "Maletas del Sur", stand: "Stand 1103", piso: "Galería C · 1er piso", cats: ["maletas", "mochilas"], wa: "955443322", desc: "Maletas de cabina y bodega, rígidas y semirrígidas, con garantía de 1 año. Repuestos de ruedas y asas.", redes: {}, horario: "Lun–Sáb 9:00–20:00", colores: ["#0f766e", "#134e4a"], qr: "Yape 955443322 · Maletas del Sur" },
      { nombre: "Loncheras Kids", stand: "Stand 1150", piso: "Galería C · 2do piso", cats: ["loncheras", "utiles"], wa: "944332211", desc: "Loncheras térmicas, tomatodos y sets escolares para inicial y primaria.", redes: { instagram: "@loncheraskids" }, horario: "Lun–Sáb 9:00–19:00", colores: ["#f97316", "#c2410c"], qr: "Plin 944332211 · Loncheras Kids" },
      { nombre: "Mundo Escolar", stand: "Stand 1201", piso: "Galería D · pasaje 3", cats: ["utiles", "cartucheras"], wa: "933221100", desc: "Útiles escolares por mayor: cuadernos, cartucheras, colores, mochilas con ruedas. Listas escolares completas.", redes: { facebook: "mundoescolarlima" }, horario: "Lun–Sáb 8:30–19:30", colores: ["#2563eb", "#1e3a8a"], qr: "Yape 933221100 · Mundo Escolar" },
      { nombre: "Billeteras D'Luxe", stand: "Stand 1233", piso: "Galería D · 1er piso", cats: ["billeteras", "accesorios"], wa: "922110099", desc: "Billeteras, tarjeteros y monederos para dama y caballero. Grabado de iniciales al instante.", redes: { instagram: "@billeterasdluxe" }, horario: "Lun–Dom 10:00–19:00", colores: ["#334155", "#0f172a"], qr: "Yape 922110099 · D'Luxe" },
      { nombre: "Accesorios Nova", stand: "Stand 1310", piso: "Galería E · 2do piso", cats: ["accesorios", "carteras"], wa: "911009988", desc: "Gorras, correas, riñoneras y accesorios de temporada. Precios especiales por docena.", redes: { tiktok: "@accesoriosnova" }, horario: "Lun–Sáb 10:00–20:00", colores: ["#16a34a", "#14532d"], qr: "Plin 911009988 · Accesorios Nova" },
    ],
    articulos: [
      [0, "Mochila escolar reforzada 18”", "mochilas", 45, 35, "oferta", "", "", true, "Colores surtidos · Por mayor desde 6 unidades"],
      [0, "Morral urbano antirrobo", "mochilas", 79, null, "", "", "", false, "Puerto USB y bolsillo oculto"],
      [0, "Cartuchera triple cierre", "cartucheras", 25, 18, "campana", "Campaña escolar 2027", "", false, "Tela impermeable"],
      [0, "Mochila con ruedas", "mochilas", 120, 95, "campana", "Campaña escolar 2027", "", false, "Para primaria · 2 ruedas"],
      [1, "Cartera bandolera Lucero", "carteras", 89, 69, "oferta", "", "", true, "Cuero sintético premium"],
      [1, "Billetera dama con cierre", "billeteras", 40, 29, "combo", "2x1 esta semana", "", false, "Lleva 2 por el precio de 1"],
      [1, "Cartera tote grande", "carteras", 110, null, "", "", "", false, "Ideal para oficina"],
      [2, "Billetera de cuero legítimo", "billeteras", 95, null, "", "", "", false, "Hecha a mano · Grabado gratis"],
      [2, "Cartera de cuero clásica", "carteras", 260, 199, "liquidacion", "Hasta agotar stock", "", true, "Últimas unidades"],
      [2, "Correa de cuero caballero", "accesorios", 55, null, "", "", "", false, "Tallas 32 a 44"],
      [3, "Maleta de cabina 20”", "maletas", 180, 149, "liquidacion", "Hasta agotar stock", "", false, "Rígida · 4 ruedas 360°"],
      [3, "Maleta de bodega 28”", "maletas", 320, 259, "liquidacion", "Hasta agotar stock", "", false, "Expandible · candado TSA"],
      [3, "Set de 3 maletas", "maletas", 650, 520, "combo", "Set completo", "", false, "20” + 24” + 28”"],
      [4, "Lonchera térmica infantil", "loncheras", 35, null, "", "", "", false, "Con tomatodo 500 ml"],
      [4, "Set escolar inicial", "utiles", 60, 48, "campana", "Campaña escolar 2027", "", false, "Lonchera + cartuchera + tomatodo"],
      [4, "Tomatodo acero 750 ml", "accesorios", 28, null, "", "", "", false, "Libre de BPA"],
      [5, "Pack de 10 cuadernos A4", "utiles", 48, 39, "mayorista", "Precio por mayor", "", false, "Rayado y cuadriculado"],
      [5, "Cartuchera de 2 pisos", "cartucheras", 22, null, "", "", "", false, "Con 24 divisiones"],
      [5, "Colores x 36 unidades", "utiles", 30, 24, "campana", "Campaña escolar 2027", "", false, "Largos · estuche metálico"],
      [6, "Tarjetero slim de cuero", "billeteras", 45, null, "nuevo", "Nuevo modelo", "", false, "Protección RFID"],
      [6, "Billetera caballero bifold", "billeteras", 60, 45, "oferta", "", "", false, "Cuero graso · 8 tarjetas"],
      [7, "Gorra urbana bordada", "accesorios", 30, null, "", "", "", false, "Talla única ajustable"],
      [7, "Riñonera deportiva", "accesorios", 35, 25, "mayorista", "Por docena", "", false, "Impermeable · 2 bolsillos"],
      [7, "Cartera mini crossbody", "carteras", 55, 45, "nuevo", "Lanzamiento", "", false, "Cadena dorada"],
    ],
  };
  const lienzo = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return [c, c.getContext("2d")]; };
  const aArchivo = (canvas, nombre, tipo = "image/png", calidad) => new Promise((ok) => canvas.toBlob((bl) => ok(new File([bl], nombre, { type: tipo })), tipo, calidad));
  const degradado = (ctx, w, h, [c1, c2]) => { const g = ctx.createLinearGradient(0, 0, w, h); g.addColorStop(0, c1); g.addColorStop(1, c2); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); };
  const burbujas = (ctx, w, h, n = 6) => { ctx.fillStyle = "rgba(255,255,255,.08)"; for (let i = 0; i < n; i++) { ctx.beginPath(); ctx.arc(((i * 7919) % w), ((i * 104729) % h), 60 + ((i * 37) % 120), 0, Math.PI * 2); ctx.fill(); } };
  const ajustarTexto = (ctx, texto, max) => { const palabras = texto.split(" "), lineas = []; let l = ""; for (const p of palabras) { const t = l ? `${l} ${p}` : p; if (ctx.measureText(t).width > max && l) { lineas.push(l); l = p; } else l = t; } if (l) lineas.push(l); return lineas; };
  // El banner no lleva texto dibujado: el título, el texto y el botón los pone el carrusel encima (y se pueden editar).
  async function imagenBanner(b, movil) {
    const w = movil ? 1080 : 1920, h = movil ? 1350 : 700; const [c, ctx] = lienzo(w, h); degradado(ctx, w, h, b.colores); burbujas(ctx, w, h, 10);
    ctx.save(); ctx.globalAlpha = .14; ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; for (let i = 0; i < 16; i++) { ctx.beginPath(); ctx.arc(movil ? w / 2 : w * 0.76, movil ? h * 0.42 : h * 0.5, (movil ? 90 : 120) + i * 44, 0, Math.PI * 2); ctx.stroke(); } ctx.restore();
    ctx.save(); ctx.globalAlpha = .22; ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(movil ? w / 2 : w * 0.76, movil ? h * 0.42 : h * 0.5, movil ? 150 : 200, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    ctx.fillStyle = "rgba(255,255,255,.9)"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.font = `800 ${movil ? 150 : 180}px Outfit, "Segoe UI", Arial, sans-serif`; ctx.fillText(b.inicial, movil ? w / 2 : w * 0.76, movil ? h * 0.42 : h * 0.5);
    return aArchivo(c, `banner-${movil ? "movil" : "web"}.jpg`, "image/jpeg", .86);
  }
  async function imagenLogo(t) { const [c, ctx] = lienzo(400, 400); degradado(ctx, 400, 400, t.colores); burbujas(ctx, 400, 400, 4); ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.font = '800 150px Outfit, "Segoe UI", Arial, sans-serif'; ctx.fillText(S.iniciales(t.nombre), 200, 190); ctx.font = '600 30px Outfit, "Segoe UI", Arial, sans-serif'; ctx.fillStyle = "rgba(255,255,255,.85)"; ctx.fillText(t.nombre.toUpperCase().slice(0, 22), 200, 320); return aArchivo(c, "logo.png"); }
  async function imagenQR(t) { const [c, ctx] = lienzo(600, 700); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, 600, 700); const n = 25, m = 20, s = (600 - m * 2) / n; let semilla = [...t.nombre].reduce((a, ch) => a + ch.charCodeAt(0), 7); const rnd = () => { semilla = (semilla * 9301 + 49297) % 233280; return semilla / 233280; }; ctx.fillStyle = "#111"; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (rnd() > .55) ctx.fillRect(m + i * s, m + j * s, s - 1, s - 1); const buscador = (x, y) => { ctx.fillStyle = "#111"; ctx.fillRect(x, y, s * 7, s * 7); ctx.fillStyle = "#fff"; ctx.fillRect(x + s, y + s, s * 5, s * 5); ctx.fillStyle = "#111"; ctx.fillRect(x + s * 2, y + s * 2, s * 3, s * 3); }; buscador(m, m); buscador(m + s * 18, m); buscador(m, m + s * 18); ctx.fillStyle = "#111"; ctx.textAlign = "center"; ctx.font = '700 30px Outfit, "Segoe UI", Arial, sans-serif'; ctx.fillText(t.qr, 300, 640); ctx.font = '500 20px Arial, sans-serif'; ctx.fillStyle = "#b00020"; ctx.fillText("QR DE EJEMPLO · NO ES UN CÓDIGO REAL", 300, 675); return aArchivo(c, "qr.png"); }
  async function imagenArticulo(nombre, colores) {
    const [c, ctx] = lienzo(800, 800); degradado(ctx, 800, 800, colores); burbujas(ctx, 800, 800, 6);
    ctx.save(); ctx.globalAlpha = .18; ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(400, 380, 250, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    const palabras = String(nombre).split(/\s+/); const ini = (palabras[0]?.[0] || "") + (palabras[1]?.[0] || "");
    ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.font = '800 260px Outfit, "Segoe UI", Arial, sans-serif'; ctx.fillText(ini.toUpperCase(), 400, 380);
    ctx.font = '600 40px Outfit, "Segoe UI", Arial, sans-serif'; ctx.fillStyle = "rgba(255,255,255,.92)"; ctx.fillText(String(nombre).toUpperCase().slice(0, 30), 400, 700);
    ctx.font = '500 26px Outfit, "Segoe UI", Arial, sans-serif'; ctx.fillStyle = "rgba(255,255,255,.7)"; ctx.fillText("FOTO DE EJEMPLO", 400, 748);
    return aArchivo(c, "articulo.jpg", "image/jpeg", .85);
  }

  $("#ej-cargar").onclick = async () => {
    const yaHay = tiendas.some((t) => t.ejemplo);
    if (yaHay && !confirm("Ya hay datos de ejemplo cargados. ¿Cargarlos otra vez (se duplicarán)?")) return;
    const b = $("#ej-cargar"); b.disabled = true; const e = $("#ej-estado"); const paso = (t) => { e.textContent = t; };
    try {
      paso("Creando banners…");
      for (const bn of EJ.banners) config.carrusel.push({ archivo: await subir(await imagenBanner(bn, false), "image/"), archivoMovil: await subir(await imagenBanner(bn, true), "image/"), titulo: bn.titulo, texto: bn.texto, enlace: bn.enlace, textoEnlace: bn.textoEnlace, ejemplo: true });
      for (const k of ["lema", "descripcion", "direccion", "horario"]) if (!config[k]) config[k] = { lema: "Mochilas, carteras, cartucheras y maletas directo de los fabricantes", descripcion: "Más de 250 tiendas de productores y comerciantes. Compra al por mayor y menor.", direccion: "Jr. Amazonas con Jr. Ayacucho, Cercado de Lima", horario: "Lunes a sábado 9:00–20:00 · Domingos 10:00–18:00" }[k];
      await guardarConfig();
      const ids = [];
      for (const [i, t] of EJ.tiendas.entries()) {
        paso(`Creando tienda ${i + 1} de ${EJ.tiendas.length}: ${t.nombre}…`);
        const id = "ej_" + nuevoId(); ids.push(id);
        await S.pedir("PUT", `/api/db/tiendas/${id}`, { nombre: t.nombre, stand: t.stand, piso: t.piso, categorias: t.cats, descripcion: t.desc, whatsapp: t.wa, telefono: "", horario: t.horario, logo: await subir(await imagenLogo(t), "image/"), qrPago: await subir(await imagenQR(t), "image/"), qrPagoTexto: t.qr, catalogoUrl: "", catalogoPdf: "", ofertasPdf: "", ubicacionUrl: "", contactoUrl: "", contactoTexto: "", redes: { facebook: t.redes.facebook || "", instagram: t.redes.instagram || "", tiktok: t.redes.tiktok || "" }, enlaces: [], orden: null, visible: true, ejemplo: true, creadoAt: ahora(), actualizadoAt: ahora() });
      }
      for (const [i, a] of EJ.articulos.entries()) {
        const [ti, nombre, categoriaId, precio, precioOferta, tipoOferta, etiquetaOferta, emoji, destacado, descripcion] = a;
        paso(`Creando artículo ${i + 1} de ${EJ.articulos.length}: ${nombre}…`);
        await S.pedir("PUT", `/api/db/articulos/ej_${nuevoId()}`, { nombre, tiendaId: ids[ti], categoriaId, precio, precioOferta, oferta: !!(tipoOferta || (precioOferta && precioOferta < precio)), tipoOferta: tipoOferta || (precioOferta ? "oferta" : ""), etiquetaOferta, destacado, descripcion, foto: await subir(await imagenArticulo(nombre, EJ.tiendas[ti].colores), "image/"), visible: true, ejemplo: true, creadoAt: new Date(Date.now() - i * 3600e3).toISOString(), actualizadoAt: ahora() });
      }
      paso("Listo: 3 banners, 8 tiendas y 24 artículos de ejemplo."); estado("Ejemplos cargados ✓"); await cargar(); pintarTodo();
    } catch (err) { estado(err.message, true); paso("No se pudo completar: " + err.message); }
    b.disabled = false;
  };
  $("#ej-quitar").onclick = async () => {
    const ts = tiendas.filter((t) => t.ejemplo), as = articulos.filter((a) => a.ejemplo), cs = config.carrusel.filter((c) => c.ejemplo);
    if (!ts.length && !as.length && !cs.length) return estado("No hay datos de ejemplo cargados.");
    if (!confirm(`Se quitarán ${cs.length} banners, ${ts.length} tiendas y ${as.length} artículos de ejemplo. Lo que cargaste tú no se toca. ¿Continuar?`)) return;
    const e = $("#ej-estado"); e.textContent = "Quitando ejemplos…";
    try {
      const archivos = [];
      for (const a of as) { archivos.push(a.foto); await S.pedir("DELETE", `/api/db/articulos/${a.id}`); }
      for (const t of ts) { archivos.push(t.logo, t.qrPago, t.catalogoPdf, t.ofertasPdf); await S.pedir("DELETE", `/api/db/tiendas/${t.id}`); }
      for (const c of cs) archivos.push(c.archivo, c.archivoMovil);
      config.carrusel = config.carrusel.filter((c) => !c.ejemplo); await guardarConfig();
      for (const id of archivos.filter(Boolean)) S.pedir("DELETE", `/api/archivos/${id}`).catch(() => {});
      e.textContent = "Ejemplos quitados."; estado("Ejemplos quitados ✓"); await cargar(); pintarTodo();
    } catch (err) { estado(err.message, true); e.textContent = "No se pudo completar: " + err.message; }
  };
  try { await cargar(); pintarTodo(); } catch (err) { estado("No se pudo cargar: " + err.message, true); }
  // Si alguien más edita a la vez, refrescar listas.
  try { const ev = new EventSource("/api/eventos"); let t; ev.onmessage = (e) => { const m = JSON.parse(e.data); if (!["sitio", "tiendas", "articulos"].includes(m.col)) return; clearTimeout(t); t = setTimeout(async () => { if (dT.open || dA.open || $("#d-diapo").open) return; await cargar(); pintarTodo(); }, 400); }; } catch { /* sin SSE */ }
})();
