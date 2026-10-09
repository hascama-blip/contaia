// Web pública del centro comercial: qué se muestra sin sesión y qué archivos
// (fotos del carrusel, logos, PDF de ofertas, QR de pago) pueden verse sin entrar.
// Las colecciones son "sitio" (un solo documento "config"), "tiendas" y "articulos";
// se editan desde /editar-sitio con los mismos /api/db de siempre.

export const CATEGORIAS_INICIALES = [
  { id: "mochilas", nombre: "Mochilas", icono: "🎒" },
  { id: "carteras", nombre: "Carteras", icono: "👜" },
  { id: "cartucheras", nombre: "Cartucheras", icono: "✏️" },
  { id: "billeteras", nombre: "Billeteras", icono: "👛" },
  { id: "maletas", nombre: "Maletas", icono: "🧳" },
  { id: "loncheras", nombre: "Loncheras", icono: "🍱" },
  { id: "utiles", nombre: "Útiles escolares", icono: "📚" },
  { id: "accesorios", nombre: "Accesorios", icono: "🧢" },
];

/** Tipos de oferta que puede llevar un artículo (filtros de "Las mejores ofertas"). */
export const TIPOS_OFERTA = [
  { id: "oferta", nombre: "Oferta", icono: "🔥" },
  { id: "liquidacion", nombre: "Liquidación", icono: "🏷️" },
  { id: "campana", nombre: "Campaña", icono: "🎒" },
  { id: "combo", nombre: "Combo / 2x1", icono: "🎁" },
  { id: "mayorista", nombre: "Precio por mayor", icono: "📦" },
  { id: "nuevo", nombre: "Lanzamiento", icono: "✨" },
];

export const SITIO_INICIAL = {
  nombre: "Centro Comercial Inmaculada Concepción",
  lema: "Mochilas, carteras, cartucheras y más, directo de los fabricantes",
  descripcion: "Más de 250 tiendas de productores y comerciantes. Compra al por mayor y menor.",
  direccion: "",
  horario: "",
  whatsapp: "",
  carrusel: [],
  categorias: CATEGORIAS_INICIALES,
};

const CAMPOS_PRIVADOS_TIENDA = new Set(["propietarioId", "notas", "actualizadoPor", "creadoPor"]);

/** Solo enlaces http(s), mailto, tel o relativos (/, ?, #). Devuelve "" si no es seguro. */
export function urlSegura(u) {
  const s = String(u || "").trim();
  if (!s) return "";
  if (/^(https?:\/\/|mailto:|tel:)/i.test(s)) return s;
  if (/^[/?#]/.test(s) && !/^\/\//.test(s)) return s;
  if (/^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(s)) return "https://" + s;
  return "";
}
const texto = (v, max) => v === undefined || v === null || (typeof v === "string" && v.length <= max);
const numeroOk = (v, max = 1e7) => v === undefined || v === null || v === "" || (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max);
const whatsappOk = (v) => { const s = String(v || "").trim(); if (!s) return true; if (/[^\d\s()+-]/.test(s)) return false; const d = s.replace(/\D/g, ""); return /^9\d{8}$/.test(d) || /^519\d{8}$/.test(d); };
const enlaceOk = (v) => !String(v || "").trim() || !!urlSegura(v);

/**
 * Valida un documento de la web pública antes de guardarlo (PUT o PATCH ya fusionado).
 * Devuelve el mensaje de error o null si está bien.
 */
export const MAX_OFERTAS_POR_TIENDA = 15;
export const MAX_IMAGEN_BYTES = 2.5 * 1048576;

/**
 * @param {object} [ctx] { tamanoArchivo(id) → bytes|undefined, ofertasDeTienda(tiendaId, excluirId) → n, id }
 */
export function validarPublico(col, d, ctx = {}) {
  const imagenOk = (id, nombre) => { const t = ctx.tamanoArchivo?.(id); return !id || t === undefined || t <= MAX_IMAGEN_BYTES ? null : `La imagen del ${nombre} pesa ${(t / 1048576).toFixed(1)} MB (máximo 2,5 MB). Súbela desde el editor para que se reduzca sola.`; };
  if (!d || typeof d !== "object" || Array.isArray(d)) return "Datos no válidos.";
  if (col === "tiendas") {
    if (!String(d.nombre || "").trim()) return "La tienda necesita un nombre.";
    if (!texto(d.nombre, 80)) return "El nombre de la tienda es muy largo (máximo 80 caracteres).";
    if (!whatsappOk(d.whatsapp)) return "El WhatsApp debe tener 9 dígitos y empezar con 9 (por ejemplo 987654321).";
    if (!texto(d.descripcion, 600)) return "La descripción es muy larga (máximo 600 caracteres).";
    for (const [k, nombre] of [["catalogoUrl", "de catálogo en línea"], ["ubicacionUrl", "de ubicación"], ["contactoUrl", "del botón Contactar (perfil digital)"]]) if (!enlaceOk(d[k])) return `El enlace ${nombre} no es válido: debe empezar con https://.`;
    if (!texto(d.contactoTexto, 30)) return "El texto del botón Contactar es muy largo (máximo 30 caracteres).";
    if (d.enlaces !== undefined && (!Array.isArray(d.enlaces) || d.enlaces.length > 10)) return "Máximo 10 enlaces adicionales.";
    for (const e of d.enlaces || []) if (!e || !enlaceOk(e.url) || !String(e.url || "").trim()) return `El enlace "${e?.titulo || ""}" no es válido: debe empezar con https://.`;
    for (const k of ["facebook", "instagram", "tiktok"]) if (d.redes && !texto(d.redes[k], 120)) return `El dato de ${k} es muy largo.`;
    if (d.categorias !== undefined && (!Array.isArray(d.categorias) || d.categorias.some((c) => typeof c !== "string"))) return "Categorías no válidas.";
    if (d.orden !== undefined && d.orden !== null && !(typeof d.orden === "number" && d.orden >= 0)) return "El orden debe ser un número desde 0.";
    return imagenOk(d.logo, "logo") || imagenOk(d.qrPago, "QR de pago");
  }
  if (col === "articulos") {
    if (!String(d.nombre || "").trim()) return "El artículo necesita un nombre.";
    if (!texto(d.nombre, 80)) return "El nombre del artículo es muy largo (máximo 80 caracteres).";
    if (!String(d.tiendaId || "").trim()) return "Elige la tienda que vende el artículo.";
    if (!numeroOk(d.precio)) return "El precio debe ser un número desde 0.";
    if (!numeroOk(d.precioOferta)) return "El precio de oferta debe ser un número desde 0.";
    if (d.oferta && Number(d.precio) > 0 && Number(d.precioOferta) > 0 && Number(d.precioOferta) >= Number(d.precio)) return "El precio de oferta debe ser menor que el precio normal.";
    if (d.tipoOferta && !TIPOS_OFERTA.some((t) => t.id === d.tipoOferta)) return "Tipo de oferta desconocido.";
    if (!texto(d.etiquetaOferta, 40)) return "La etiqueta de la oferta es muy larga (máximo 40 caracteres).";
    if (!texto(d.descripcion, 140)) return "La descripción corta es muy larga (máximo 140 caracteres).";
    const esOferta = !!d.oferta || (Number(d.precioOferta) > 0 && Number(d.precioOferta) < Number(d.precio || Infinity));
    if (esOferta && d.visible !== false && ctx.ofertasDeTienda && ctx.ofertasDeTienda(d.tiendaId, ctx.id) >= MAX_OFERTAS_POR_TIENDA) return `Esta tienda ya tiene ${MAX_OFERTAS_POR_TIENDA} artículos en oferta (el máximo). Quita una oferta antes de agregar otra.`;
    return imagenOk(d.foto, "artículo");
  }
  if (col === "sitio") {
    if (!String(d.nombre || "").trim()) return "El centro comercial necesita un nombre.";
    if (!texto(d.nombre, 100) || !texto(d.lema, 160) || !texto(d.descripcion, 400) || !texto(d.direccion, 200) || !texto(d.horario, 120)) return "Alguno de los textos del centro es demasiado largo.";
    if (!whatsappOk(d.whatsapp)) return "El WhatsApp del centro debe tener 9 dígitos y empezar con 9.";
    if (d.carrusel !== undefined && (!Array.isArray(d.carrusel) || d.carrusel.length > 12)) return "El carrusel admite hasta 12 fotos.";
    for (const f of d.carrusel || []) { if (!f || typeof f.archivo !== "string") return "Foto del carrusel no válida."; if (!enlaceOk(f.enlace)) return `El enlace del botón "${f.titulo || "foto"}" no es válido.`; if (!texto(f.titulo, 80) || !texto(f.texto, 160)) return "El título o texto de una foto es muy largo."; }
    if (d.categorias !== undefined && (!Array.isArray(d.categorias) || d.categorias.length > 30)) return "Máximo 30 categorías.";
    for (const c of d.categorias || []) if (!c || !String(c.id || "").trim() || !String(c.nombre || "").trim() || !texto(c.nombre, 40)) return "Cada categoría necesita nombre (máximo 40 caracteres).";
    for (const f of d.carrusel || []) { const e = imagenOk(f.archivo, "carrusel") || imagenOk(f.archivoMovil, "carrusel (celular)"); if (e) return e; }
    for (const c of d.categorias || []) { const e = imagenOk(c.imagen, `ícono de ${c.nombre}`); if (e) return e; }
    return null;
  }
  return null;
}

/** Número de WhatsApp en formato wa.me: solo dígitos; 9 dígitos peruanos → 51. */
export function waNumero(v) {
  const d = String(v || "").replace(/\D/g, "");
  if (!d) return "";
  return d.length === 9 ? "51" + d : d;
}

export class SitioPublico {
  #almacen; #existeArchivo; #cache = { en: 0, ids: null };
  constructor({ almacen, existeArchivo }) {
    this.#almacen = almacen; this.#existeArchivo = existeArchivo;
    almacen.on("cambio", (col) => { if (["sitio", "tiendas", "articulos"].includes(col)) this.#cache.ids = null; });
  }
  config() {
    const c = this.#almacen.obtener("sitio", "config")?.data || {};
    const cfg = { ...SITIO_INICIAL, ...c, tiposOferta: TIPOS_OFERTA, maxOfertasPorTienda: MAX_OFERTAS_POR_TIENDA };
    if (!Array.isArray(cfg.categorias) || !cfg.categorias.length) cfg.categorias = CATEGORIAS_INICIALES;
    if (!Array.isArray(cfg.carrusel)) cfg.carrusel = [];
    return cfg;
  }
  #tiendas() {
    return this.#almacen.listar("tiendas").filter((d) => d.data && d.data.visible !== false && d.data.nombre)
      .map(({ id, data }) => ({ id, ...Object.fromEntries(Object.entries(data).filter(([k]) => !CAMPOS_PRIVADOS_TIENDA.has(k))), whatsapp: waNumero(data.whatsapp), contactoUrl: urlSegura(data.contactoUrl) }))
      .sort((a, b) => (a.orden ?? 999) - (b.orden ?? 999) || String(a.nombre).localeCompare(String(b.nombre), "es"));
  }
  #articulos(tiendasVisibles) {
    return this.#almacen.listar("articulos").filter((d) => d.data && d.data.visible !== false && d.data.nombre && tiendasVisibles.has(d.data.tiendaId))
      .map(({ id, data }) => { const oferta = !!data.oferta || (Number(data.precioOferta) > 0 && Number(data.precioOferta) < Number(data.precio || Infinity)); return { id, ...data, oferta, tipoOferta: oferta ? (TIPOS_OFERTA.some((t) => t.id === data.tipoOferta) ? data.tipoOferta : "oferta") : "" }; })
      .sort((a, b) => Number(b.oferta) - Number(a.oferta) || String(b.actualizadoAt || "").localeCompare(String(a.actualizadoAt || "")));
  }
  /** Lo que ve cualquiera en la portada. */
  portada() {
    const tiendas = this.#tiendas();
    const visibles = new Set(tiendas.map((t) => t.id));
    const articulos = this.#articulos(visibles);
    const ofertasPorTienda = new Map();
    for (const a of articulos) if (a.oferta) ofertasPorTienda.set(a.tiendaId, (ofertasPorTienda.get(a.tiendaId) || 0) + 1);
    return {
      sitio: this.config(),
      tiendas: tiendas.map((t) => ({ ...t, ofertas: ofertasPorTienda.get(t.id) || 0, articulos: articulos.filter((a) => a.tiendaId === t.id).length })),
      articulos,
    };
  }
  /** Perfil digital de una tienda con sus artículos. */
  tienda(id) {
    const t = this.#tiendas().find((x) => x.id === id);
    if (!t) return null;
    return { sitio: this.config(), tienda: t, articulos: this.#articulos(new Set([id])) };
  }
  /** Un archivo es público si alguna tienda, artículo o el carrusel lo referencia. */
  esArchivoPublico(id) {
    if (!this.#cache.ids || Date.now() - this.#cache.en > 10_000) {
      const ids = new Set();
      const recorrer = (v) => { if (typeof v === "string") { if (/^[A-Za-z0-9]{8,}$/.test(v) && this.#existeArchivo(v)) ids.add(v); } else if (Array.isArray(v)) v.forEach(recorrer); else if (v && typeof v === "object") Object.values(v).forEach(recorrer); };
      recorrer(this.config());
      for (const col of ["tiendas", "articulos"]) for (const d of this.#almacen.listar(col)) if (d.data?.visible !== false) recorrer(d.data);
      this.#cache = { en: Date.now(), ids };
    }
    return this.#cache.ids.has(id);
  }
}
