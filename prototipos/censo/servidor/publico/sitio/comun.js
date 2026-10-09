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
  btnContacto: (t, cls = "btn btn-primario btn-sm", interno) => { const c = S.contacto(t, interno); return `<a class="${cls}" href="${S.esc(c.href)}"${c.externo ? ' target="_blank" rel="noopener"' : ""}>${S.esc(c.texto)}</a>`; },
  logo: (t, cls = "logo") => (t.logo ? `<img class="${cls}" src="${S.blob(t.logo)}" alt="" loading="lazy">` : `<div class="${cls}" aria-hidden="true">${S.esc(S.iniciales(t.nombre))}</div>`),
  tipo: (a, tipos) => (a.oferta ? (tipos || []).find((t) => t.id === (a.tipoOferta || "oferta")) || { id: "oferta", nombre: "Oferta" } : null),
  pill: (a, tipos) => { const t = S.tipo(a, tipos); return t ? `<span class="oferta-pill tipo-${S.esc(t.id)}">${S.esc(t.nombre.toUpperCase())}</span>` : ""; },
  precio: (a) => (a.oferta && Number(a.precioOferta) > 0 ? `<div class="precio">${S.soles(a.precioOferta)}${Number(a.precio) > 0 ? `<s>${S.soles(a.precio)}</s>` : ""}</div>` : Number(a.precio) > 0 ? `<div class="precio">${S.soles(a.precio)}</div>` : `<div class="precio" style="font-size:.9rem;color:var(--texto-3);font-weight:600">Consultar precio</div>`),
  pedir: async (metodo, ruta, cuerpo, cabeceras = {}) => {
    const r = await fetch(ruta, { method: metodo, headers: { ...(cuerpo !== undefined && !(cuerpo instanceof Blob) ? { "Content-Type": "application/json" } : {}), ...cabeceras }, body: cuerpo instanceof Blob ? cuerpo : cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
    return j;
  },
};
