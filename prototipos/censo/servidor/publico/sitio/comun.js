// Utilidades compartidas por la portada, el perfil de tienda y el editor.
window.S = {
  esc: (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),
  blob: (id) => (id ? `/_blob/${encodeURIComponent(id)}` : ""),
  soles: (v) => { const n = Number(v); return n > 0 ? "S/ " + n.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ""; },
  iniciales: (n) => String(n || "?").split(/\s+/).slice(0, 2).map((p) => p[0] || "").join("").toUpperCase(),
  wa: (num, texto) => (num ? `https://wa.me/${num}${texto ? "?text=" + encodeURIComponent(texto) : ""}` : ""),
  logo: (t, cls = "logo") => (t.logo ? `<img class="${cls}" src="${S.blob(t.logo)}" alt="" loading="lazy">` : `<div class="${cls}" aria-hidden="true">${S.esc(S.iniciales(t.nombre))}</div>`),
  tipo: (a, tipos) => (a.oferta ? (tipos || []).find((t) => t.id === (a.tipoOferta || "oferta")) || { id: "oferta", nombre: "Oferta", icono: "🔥" } : null),
  pill: (a, tipos) => { const t = S.tipo(a, tipos); return t ? `<span class="oferta-pill tipo-${S.esc(t.id)}">${S.esc(t.nombre.toUpperCase())}</span>` : ""; },
  precio: (a) => (a.oferta && Number(a.precioOferta) > 0 ? `<div class="precio">${S.soles(a.precioOferta)}${Number(a.precio) > 0 ? `<s>${S.soles(a.precio)}</s>` : ""}</div>` : Number(a.precio) > 0 ? `<div class="precio">${S.soles(a.precio)}</div>` : `<div class="precio" style="font-size:.9rem;color:var(--texto-3);font-weight:600">Consultar precio</div>`),
  pedir: async (metodo, ruta, cuerpo, cabeceras = {}) => {
    const r = await fetch(ruta, { method: metodo, headers: { ...(cuerpo !== undefined && !(cuerpo instanceof Blob) ? { "Content-Type": "application/json" } : {}), ...cabeceras }, body: cuerpo instanceof Blob ? cuerpo : cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
    return j;
  },
};
