// Utilidades compartidas por la portada, el perfil de tienda y el editor.
// Íconos de línea (24×24, trazo currentColor). Sin emojis: se ven igual en todos los dispositivos.
const ICONOS = {
  mochilas: '<path d="M8 7V5a4 4 0 0 1 8 0v2"/><rect x="5" y="7" width="14" height="14" rx="4"/><path d="M8 14h8v4a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1z"/><path d="M12 7v3"/>',
  carteras: '<path d="M4 10h16l-1.2 9.2a2 2 0 0 1-2 1.8H7.2a2 2 0 0 1-2-1.8z"/><path d="M8 10V8a4 4 0 0 1 8 0v2"/><path d="M4 13h16"/>',
  cartucheras: '<rect x="3" y="8" width="18" height="10" rx="4"/><path d="M3 12h18"/><path d="M8 12v-2M12 12v-2M16 12v-2"/>',
  billeteras: '<rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10h18"/><path d="M16 14.5h2"/><path d="M6 6V5a1.5 1.5 0 0 1 1.5-1.5h8"/>',
  maletas: '<rect x="4" y="7" width="16" height="12" rx="2.5"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/><path d="M8 19v2M16 19v2"/><path d="M9 11v4M15 11v4"/>',
  loncheras: '<rect x="3" y="8" width="18" height="12" rx="2.5"/><path d="M3 13h18"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
  utiles: '<path d="M5 4h9a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2z"/><path d="M16 8h3v12h-3"/><path d="M8 8h5M8 11h5"/>',
  accesorios: '<path d="M5 14a7 7 0 0 1 14 0"/><path d="M3 14h18l-2 2H5z"/><path d="M12 7V5"/>',
  flecha: '<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>',
  tienda: '<path d="M4 9l1.5-4h13L20 9"/><path d="M4 9a2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0"/><path d="M5 11v9h14v-9"/><path d="M10 20v-5h4v5"/>',
  buscar: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  whatsapp: '<path d="M4 20l1.3-3.8A8 8 0 1 1 8.2 19z"/><path d="M9.5 9.5c0 3 2 5 5 5l1-1.5-1.8-.8-.8.8c-1-.4-1.8-1.2-2.2-2.2l.8-.8-.8-1.8z"/>',
  telefono: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
  catalogo: '<path d="M4 5a2 2 0 0 1 2-2h12v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5"/><path d="M8 7h7M8 10h7"/>',
  enlace: '<path d="M10 14a4 4 0 0 0 5.7 0l2.5-2.5a4 4 0 0 0-5.7-5.7L11 7.3"/><path d="M14 10a4 4 0 0 0-5.7 0L5.8 12.5a4 4 0 0 0 5.7 5.7L13 16.7"/>',
  ofertas: '<path d="M3 12V4h8l9 9-8 8z"/><circle cx="7.5" cy="8.5" r="1.5"/>',
  qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM19 14h2M14 19h2M19 19h2v2"/>',
  mapa: '<path d="M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/>',
  facebook: '<path d="M14 8h2V5h-2a3 3 0 0 0-3 3v2H9v3h2v7h3v-7h2.2l.5-3H14V8.5z"/>',
  instagram: '<rect x="4" y="4" width="16" height="16" rx="4.5"/><circle cx="12" cy="12" r="3.5"/><path d="M16.8 7.2h.01"/>',
  tiktok: '<path d="M14 4v9.5a3.5 3.5 0 1 1-3.5-3.5"/><path d="M14 4c.5 2.5 2 4 4.5 4.5"/>',
  foto: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="M21 16l-5-5-8 8"/>',
  flecha: '<path d="M9 6l6 6-6 6"/>',
};
window.S = {
  icono: (k, cls = "") => `<svg class="ico-svg ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONOS[k] || ICONOS.tienda}</svg>`,
  // Ícono de una categoría: su imagen si la subieron; si no, el ícono de línea de la categoría base; si no, su inicial.
  iconoCategoria: (c) => (c.imagen ? `<img src="/_blob/${encodeURIComponent(c.imagen)}" alt="">` : ICONOS[c.id] ? S.icono(c.id) : `<span class="mono">${S.esc(String(c.nombre || "?").trim().charAt(0).toUpperCase())}</span>`),
  esc: (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),
  url: (u) => { const s = String(u || "").trim(); if (!s) return ""; if (/^(https?:\/\/|mailto:|tel:)/i.test(s)) return s; if (/^[/?#]/.test(s) && !/^\/\//.test(s)) return s; if (/^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(s)) return "https://" + s; return ""; },
  blob: (id) => (id ? `/_blob/${encodeURIComponent(id)}` : ""),
  soles: (v) => { const n = Number(v); return n > 0 ? "S/ " + n.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ""; },
  iniciales: (n) => String(n || "?").split(/\s+/).slice(0, 2).map((p) => p[0] || "").join("").toUpperCase(),
  wa: (num, texto) => (num ? `https://wa.me/${num}${texto ? "?text=" + encodeURIComponent(texto) : ""}` : ""),
  // Botón Contactar de una tienda: si tiene "contactoUrl" (su perfil digital en otra web) va ahí en pestaña nueva;
  // si no, al perfil dentro de esta web (/tienda/id). El texto del botón también es editable (contactoTexto).
  contacto: (t, interno) => { const u = S.url(t?.contactoUrl); const externo = !!u && !/^[/?#]/.test(u); return { href: externo ? u : interno || `/tienda/${encodeURIComponent(t?.id || "")}`, externo, texto: String(t?.contactoTexto || "").trim() || "Contactar" }; },
  // Botón Contactar: abre el perfil digital externo de la tienda (contactoUrl). Sin enlace no se muestra.
  btnContacto: (t, cls = "btn btn-primario btn-sm") => { const c = S.contacto(t); return c.externo ? `<a class="${cls}" href="${S.esc(c.href)}" target="_blank" rel="noopener" data-visita="${S.esc(t.id || "")}">${S.esc(c.texto)}</a>` : ""; },
  logo: (t, cls = "logo") => (t.logo ? `<img class="${cls}" src="${S.blob(t.logo)}" alt="" loading="lazy">` : `<div class="${cls}" aria-hidden="true">${S.esc(S.iniciales(t.nombre))}</div>`),
  tipo: (a, tipos) => (a.oferta ? (tipos || []).find((t) => t.id === (a.tipoOferta || "oferta")) || { id: "oferta", nombre: "Oferta" } : null),
  pill: (a, tipos) => { const t = S.tipo(a, tipos); return t ? `<span class="oferta-pill tipo-${S.esc(t.id)}">${S.esc(t.nombre.toUpperCase())}</span>` : ""; },
  precio: (a) => (a.oferta && Number(a.precioOferta) > 0 ? `<div class="precio">${S.soles(a.precioOferta)}${Number(a.precio) > 0 ? `<s>${S.soles(a.precio)}</s>` : ""}</div>` : Number(a.precio) > 0 ? `<div class="precio">${S.soles(a.precio)}</div>` : `<div class="precio" style="font-size:.9rem;color:var(--texto-3);font-weight:600">Consultar precio</div>`),
  // ---- Compartido por la portada, /ofertas y /tiendas ----
  norm: (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""),
  // Rellena cabecera y pie con los datos del centro (nombre, lema, WhatsApp, dirección).
  cabecera: (sitio) => {
    const $ = (q) => document.querySelector(q);
    if ($("#marca-nombre")) $("#marca-nombre").firstChild.textContent = sitio.nombre.replace(/^Centro Comercial/i, "C.C.");
    if ($("#marca-lema")) $("#marca-lema").textContent = sitio.lema || "";
    if (sitio.whatsapp && $("#wa-centro")) { const a = $("#wa-centro"); a.href = S.wa(sitio.whatsapp.replace(/\D/g, "").replace(/^(\d{9})$/, "51$1"), `Hola, escribo desde la web de ${sitio.nombre}.`); a.hidden = false; a.target = "_blank"; a.rel = "noopener"; }
    if ($("#pie-datos")) $("#pie-datos").textContent = [sitio.direccion, sitio.horario].filter(Boolean).join(" · ") || sitio.lema || "";
    if ($("#pie-nombre")) $("#pie-nombre").textContent = sitio.nombre;
    if ($("#cab-direccion span")) $("#cab-direccion span").textContent = [sitio.direccion, sitio.horario].filter(Boolean).join(" · ");
  },
  descuento: (a) => (Number(a.precio) > 0 && Number(a.precioOferta) > 0 && Number(a.precioOferta) < Number(a.precio) ? Math.round((1 - Number(a.precioOferta) / Number(a.precio)) * 100) : 0),
  // Para ordenar por "mayor descuento": 2 x 1 equivale a 50 % y 3 x 1 a 67 %.
  descuentoEquivalente: (a) => (a.tipoOferta === "dosxuno" ? 50 : a.tipoOferta === "tresxuno" ? 67 : S.descuento(a)),
  precioVigente: (a) => (Number(a.precioOferta) > 0 ? Number(a.precioOferta) : Number(a.precio) > 0 ? Number(a.precio) : Infinity),
  // Orden de ofertas: mayor descuento (destacadas primero), menor/mayor precio o más recientes.
  ordenarOfertas: (lista, orden) => {
    const porFecha = (x, y) => String(y.creadoAt || y.actualizadoAt || "").localeCompare(String(x.creadoAt || x.actualizadoAt || ""));
    return [...lista].sort(orden === "precio-asc" ? (x, y) => S.precioVigente(x) - S.precioVigente(y) : orden === "precio-desc" ? (x, y) => S.precioVigente(y) - S.precioVigente(x) : orden === "reciente" ? porFecha : (x, y) => Number(!!y.destacado) - Number(!!x.destacado) || S.descuentoEquivalente(y) - S.descuentoEquivalente(x) || porFecha(x, y));
  },
  pen: (v, dec = 2) => "S/ " + Number(v).toLocaleString("es-PE", { minimumFractionDigits: dec, maximumFractionDigits: dec }),
  // Afiche de oferta (estilo tienda por departamentos). Tiene dos caras: el frente muestra la oferta y, al
  // tocarlo, se voltea y aparece el perfil de la tienda con "Preguntar por WhatsApp" (mensaje ya escrito con
  // el artículo) y el enlace a su perfil. S.afichesInteractivos(raíz) activa el volteo.
  afiche: (a, { tiendaDe, cat, sitio }) => {
    const t = tiendaDe.get(a.tiendaId) || { id: a.tiendaId, nombre: "" }, d = S.descuento(a), c = cat.get(a.categoriaId), tipo = S.tipo(a, sitio.tiposOferta);
    const promo = tipo?.id === "dosxuno" ? ["2", "1", "lleva 2, paga 1"] : tipo?.id === "tresxuno" ? ["3", "1", "lleva 3, paga 1"] : null;
    const cifra = promo ? `<div class="afiche-cifra promo">${promo[0]}<small>x</small>${promo[1]}</div><div class="afiche-sub">${promo[2]}</div>`
      : d ? `<div class="afiche-cifra">${d}<small>%</small></div><div class="afiche-sub">de descuento</div>`
      : Number(a.precioOferta) > 0 ? `<div class="afiche-cifra precio-cifra">${S.pen(a.precioOferta, 0)}</div><div class="afiche-sub">precio de oferta</div>`
      : `<div class="afiche-cifra precio-cifra">${Number(a.precio) > 0 ? S.pen(a.precio, 0) : "Oferta"}</div><div class="afiche-sub">${Number(a.precio) > 0 ? "precio especial" : "consulta por WhatsApp"}</div>`;
    const precios = d && Number(a.precioOferta) > 0 ? `<b>${S.pen(a.precioOferta)}</b> <s>${S.pen(a.precio)}</s>` : Number(a.precioOferta) > 0 ? `<b>${S.pen(a.precioOferta)}</b>${promo ? " c/u" : ""}` : Number(a.precio) > 0 ? `<b>${S.pen(a.precio)}</b>${promo ? " c/u" : ""}` : " ";
    const precioTxt = Number(a.precioOferta) > 0 ? S.pen(a.precioOferta) + (promo ? " c/u" : "") : Number(a.precio) > 0 ? S.pen(a.precio) : "";
    const mensaje = `Hola ${t.nombre}, vi en la web de ${sitio.nombre} su oferta "${a.nombre}"${tipo ? ` (${tipo.nombre}${precioTxt ? `, ${precioTxt}` : ""})` : ""}. ¿Sigue disponible?`;
    const wa = t.whatsapp ? S.wa(t.whatsapp, mensaje) : "";
    // El botón de perfil solo sale si la tienda cargó su perfil digital externo (contactoUrl); el perfil interno no se enlaza desde aquí.
    const perfil = S.contacto(t);
    const btnPerfil = perfil.externo ? `<a class="btn btn-borde" href="${S.esc(perfil.href)}" target="_blank" rel="noopener" data-visita="${S.esc(t.id || "")}">${S.esc(perfil.texto === "Contactar" ? "Ver perfil digital" : perfil.texto)}</a>` : "";
    const cats = (t.categorias || []).map((id) => cat.get(id)).filter(Boolean).slice(0, 3).map((x) => `<span class="etiqueta">${S.esc(x.nombre)}</span>`).join("");
    return `<article class="afiche tipo-${S.esc(tipo?.id || "oferta")}" data-art="${S.esc(a.id)}" data-tienda="${S.esc(a.tiendaId)}">
      <div class="afiche-caras">
        <div class="afiche-frente" role="button" tabindex="0" aria-expanded="false" aria-label="Ver la tienda que vende ${S.esc(a.nombre)}">
          <div class="afiche-tipo">${S.esc(tipo?.nombre || "Oferta")}</div>
          <div class="afiche-etiqueta">${a.etiquetaOferta ? `<span>${S.esc(a.etiquetaOferta)}</span>` : ""}</div>
          <div class="afiche-eti">${S.esc(c?.nombre || " ")}</div>
          ${cifra}
          <div class="afiche-marca">${S.esc(a.nombre)}</div>
          <div class="afiche-precios">${precios}</div>
          <div class="afiche-foto">${a.foto ? `<img src="${S.blob(a.foto)}" alt="${S.esc(a.nombre)}" loading="lazy">` : `<span class="sin-foto">${S.icono("foto")}</span>`}<span class="afiche-voltear">${S.icono("tienda")} Ver tienda</span></div>
        </div>
        <div class="afiche-dorso">
          <div class="afiche-tipo">${S.esc(tipo?.nombre || "Oferta")}</div>
          <div class="dorso-tienda">${S.logo(t, "dorso-logo")}<div><b>${S.esc(t.nombre)}</b><small>${S.esc([t.stand, t.piso].filter(Boolean).join(" · ") || " ")}</small></div></div>
          ${t.horario ? `<div class="dorso-dato">Horario: ${S.esc(t.horario)}</div>` : ""}
          ${cats ? `<div class="etiquetas dorso-cats">${cats}</div>` : ""}
          <p class="dorso-desc">${S.esc(t.descripcion || "")}</p>
          <div class="dorso-art">Oferta: <b>${S.esc(a.nombre)}</b>${precioTxt ? ` · ${S.esc(precioTxt)}` : ""}</div>
          <div class="dorso-botones">
            ${wa ? `<a class="btn btn-wa" href="${S.esc(wa)}" target="_blank" rel="noopener">${S.icono("whatsapp")} <span class="largo">Preguntar por </span>WhatsApp</a>` : `<span class="dorso-sinwa">Esta tienda aún no registró WhatsApp.</span>`}
            ${btnPerfil}
            <button type="button" class="afiche-volver">Volver a la oferta</button>
          </div>
        </div>
      </div>
    </article>`;
  },
  // Volteo de los afiches dentro de una raíz (carrusel o rejilla). Avisa con el evento "volteo" (detail = cuántos están volteados).
  afichesInteractivos: (raiz) => {
    if (!raiz || raiz.dataset.volteo) return; raiz.dataset.volteo = "1";
    const voltear = (art, abierto) => { art.classList.toggle("volteado", abierto); art.querySelector(".afiche-frente")?.setAttribute("aria-expanded", String(abierto)); raiz.dispatchEvent(new CustomEvent("volteo", { detail: raiz.querySelectorAll(".afiche.volteado").length })); };
    raiz.addEventListener("click", (e) => {
      const art = e.target.closest(".afiche"); if (!art || e.target.closest("a")) return;
      if (e.target.closest(".afiche-frente")) voltear(art, true);
      else if (e.target.closest(".afiche-volver") || e.target.closest(".afiche-dorso")) voltear(art, false);
    });
    raiz.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && e.target.classList?.contains("afiche-frente")) { e.preventDefault(); voltear(e.target.closest(".afiche"), true); } if (e.key === "Escape") { for (const a of raiz.querySelectorAll(".afiche.volteado")) voltear(a, false); } });
  },
  // Tarjeta de tienda: logo, nombre (con sello "Más visitada" si corresponde), descripción con "Ver más", ofertas y botones.
  tarjetaTienda: (t, { cat, sello }) => `<article class="tienda${t.logo ? " con-fondo" : ""}" data-id="${S.esc(t.id)}">
      ${t.logo ? `<div class="tienda-fondo" style="background-image:url('${S.blob(t.logo)}')" aria-hidden="true"></div><div class="tienda-velo" aria-hidden="true"></div>` : ""}
      <div class="tienda-cab">${S.logo(t)}<div><h3>${S.esc(t.nombre)}</h3><div class="stand">${S.esc([t.stand, t.piso].filter(Boolean).join(" · ")) || "&nbsp;"}${sello ? `<span class="sello-top">${S.esc(sello)}</span>` : ""}</div></div></div>
      <p class="tienda-desc">${S.esc(t.descripcion || "") || `<span class="muted">Vende ${S.esc((t.categorias || []).map((id) => cat.get(id)?.nombre).filter(Boolean).join(", ").toLowerCase() || "en el centro comercial")}.</span>`}</p>
      <div class="tienda-meta"><button type="button" class="ver-mas" hidden>Ver más</button><span class="tienda-ofertas ${t.ofertas ? "con" : ""}">${t.ofertas ? `${t.ofertas} oferta${t.ofertas === 1 ? "" : "s"}` : "Sin ofertas por ahora"}</span></div>
      <div class="tienda-acciones"><a class="btn btn-borde btn-sm ver" href="/tienda/${encodeURIComponent(t.id)}">Ver ofertas</a>${S.btnContacto(t)}</div>
    </article>`,
  // Burbuja redonda "Ver más" al final de un carrusel o rejilla.
  burbujaMas: (href, texto, sub) => `<a class="burbuja-mas" href="${S.esc(href)}"><span class="circulo">${S.icono("flecha")}</span><b>${S.esc(texto)}</b>${sub ? `<small>${S.esc(sub)}</small>` : ""}</a>`,
  // "Ver más" de la descripción aparece solo cuando no cabe en sus 3 líneas (medido en pantalla).
  ajustarVerMas: () => { for (const d of document.querySelectorAll(".tienda-desc")) { const b = d.parentElement.querySelector(".ver-mas"); if (b) b.hidden = d.scrollHeight <= d.clientHeight + 1; } },
  // Ventana "Ver ofertas" de una tienda (#modal). Devuelve abrir(tienda).
  modalTienda: ({ tiendaDe, cat, sitio, articulos, lista }) => {
    const $ = (q) => document.querySelector(q), modal = $("#modal");
    if (!modal) return () => {};
    const abrir = (t) => {
      if (!t) return;
      $("#m-logo").outerHTML = S.logo(t).replace('class="logo"', 'class="logo" id="m-logo"');
      $("#m-nombre").textContent = t.nombre; $("#m-stand").textContent = [t.stand, t.piso, t.horario, (t.categorias || []).map((id) => cat.get(id)?.nombre).filter(Boolean).join(", ")].filter(Boolean).join(" · ");
      $("#m-desc").textContent = t.descripcion || "";
      const mios = articulos.filter((a) => a.tiendaId === t.id), of = mios.slice(0, 6);
      $("#m-ofertas-titulo").textContent = mios.length ? `Ofertas (${mios.length})` : "";
      $("#m-ofertas").innerHTML = of.length ? of.map((a) => `<div class="oferta-fila">${a.foto ? `<img src="${S.blob(a.foto)}" alt="">` : `<div class="sin">${S.icono("foto")}</div>`}<div class="nom">${S.esc(a.nombre)} <span class="oferta-pill tipo-${S.esc(a.tipoOferta || "oferta")}">${S.esc(S.tipo(a, sitio.tiposOferta)?.nombre || "Oferta")}</span></div>${S.precio(a)}</div>`).join("") + (mios.length > of.length ? `<div class="vende" style="text-align:center">y ${mios.length - of.length} más en su perfil</div>` : "") : `<div class="vende">Esta tienda aún no publicó ofertas. Contáctala para consultar.</div>`;
      // Con perfil digital externo: "Contactar · ver perfil digital"; si no, el botón lleva a la página de ofertas de la tienda.
      const c = S.contacto(t), mc = $("#m-contactar");
      if (c.externo) { mc.href = c.href; mc.textContent = c.texto === "Contactar" ? "Contactar · ver perfil digital" : c.texto; mc.target = "_blank"; mc.rel = "noopener"; mc.dataset.visita = t.id; }
      else { mc.href = `/tienda/${encodeURIComponent(t.id)}`; mc.textContent = "Ver todas sus ofertas"; mc.removeAttribute("target"); mc.removeAttribute("rel"); delete mc.dataset.visita; }
      modal.showModal();
    };
    (lista || $("#lista-tiendas"))?.addEventListener("click", (e) => { const b = e.target.closest(".ver-mas"); if (!b) return; abrir(tiendaDe.get(b.closest(".tienda").dataset.id)); });
    $("#m-cerrar").onclick = () => modal.close(); modal.onclick = (e) => { if (e.target === modal) modal.close(); };
    return abrir;
  },
  // Visita al perfil digital externo: se avisa al servidor al hacer clic (los perfiles internos las cuenta el servidor al abrirse).
  visita: (id) => { try { navigator.sendBeacon(`/api/publico/visita/${encodeURIComponent(id)}`); } catch {} },
  pedir: async (metodo, ruta, cuerpo, cabeceras = {}) => {
    const r = await fetch(ruta, { method: metodo, headers: { ...(cuerpo !== undefined && !(cuerpo instanceof Blob) ? { "Content-Type": "application/json" } : {}), ...cabeceras }, body: cuerpo instanceof Blob ? cuerpo : cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
    return j;
  },
};
document.addEventListener("click", (e) => { const a = e.target.closest("a[data-visita]"); if (a && a.dataset.visita) S.visita(a.dataset.visita); });
