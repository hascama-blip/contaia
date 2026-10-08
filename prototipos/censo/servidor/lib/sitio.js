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
    const cfg = { ...SITIO_INICIAL, ...c, tiposOferta: TIPOS_OFERTA };
    if (!Array.isArray(cfg.categorias) || !cfg.categorias.length) cfg.categorias = CATEGORIAS_INICIALES;
    if (!Array.isArray(cfg.carrusel)) cfg.carrusel = [];
    return cfg;
  }
  #tiendas() {
    return this.#almacen.listar("tiendas").filter((d) => d.data && d.data.visible !== false && d.data.nombre)
      .map(({ id, data }) => ({ id, ...Object.fromEntries(Object.entries(data).filter(([k]) => !CAMPOS_PRIVADOS_TIENDA.has(k))), whatsapp: waNumero(data.whatsapp) }))
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
