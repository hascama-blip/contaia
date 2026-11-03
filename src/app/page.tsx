import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser, modulosDelEstudio, esSupremo, esSoloRtp, planDelEstudio } from "@/lib/auth";
import { moduloPorHref, PLAN_LABEL } from "@/lib/modulos";
import RecordatoriosBanner from "@/components/RecordatoriosBanner";
import NotificacionesPanel from "@/components/NotificacionesPanel";
import DescubreMas from "@/components/DescubreMas";

export const dynamic = "force-dynamic";

interface Opcion {
  href: string;
  icono: string;
  titulo: string;
  detalle: string;
  /** Texto del botón de la tarjeta. */
  cta: string;
  /** Qué contiene el módulo (para la ventana "Descubre qué más puedes hacer"). */
  contenido: string[];
  destacado?: boolean;
}

// Módulos principales. El destacado (Reporte analítico) es el botón
// "Recomendado" del héroe; el resto va en tarjetas (activos) o en la ventana
// "Descubre qué más puedes hacer" (bloqueados por plan).
const PRINCIPALES: Opcion[] = [
  {
    href: "/clientes",
    icono: "📑",
    titulo: "Reporte analítico de auditoría",
    detalle: "Consulta el RUC, registra los accesos y ejecuta todos los procedimientos (SIRE, buzón, declaraciones, deudas) hasta el informe de gerencia.",
    cta: "Acceder al Reporte analítico de auditoría",
    contenido: [
      "Estado del RUC en SUNAT: razón social, estado, condición de domicilio y actividad.",
      "Diagnóstico tributario con hallazgos y score de riesgo.",
      "Buzón (peligrosos y urgentes), deudas y declaraciones vs SIRE.",
      "Dashboard e informe de gerencia imprimible.",
    ],
    destacado: true,
  },
  {
    href: "/herramientas/consultas",
    icono: "📨",
    titulo: "Consultas tributarias",
    detalle: "Extrae los mensajes del buzón electrónico SUNAT con sus asuntos y descarga, mensaje por mensaje, el PDF adjunto de cada notificación.",
    cta: "Abrir consultas",
    contenido: [
      "Mensajes y notificaciones del buzón SUNAT por empresa.",
      "Descarga del PDF adjunto de cada notificación.",
      "Seguimiento con plazo de atención y recordatorios.",
    ],
  },
  {
    href: "/herramientas/rtt",
    icono: "📄",
    titulo: "Reporte Tributario para Terceros (RTT)",
    detalle: "Solicita el RTT de SUNAT y recíbelo automáticamente, con trazabilidad de cada estado. Descarga el PDF/XML cuando llega.",
    cta: "Solicitar RTT",
    contenido: [
      "Solicitud del RTT en SUNAT de forma automática.",
      "Llega a la nube por webhook de correo, sin revisar bandejas.",
      "Trazabilidad creado → en proceso → listo, y descarga de PDF/XML.",
    ],
  },
  {
    href: "/herramientas/detalle-sire",
    icono: "📋",
    titulo: "Detalle SIRE",
    detalle: "Extrae el detalle de la propuesta SUNAT (compras RCE y ventas RVIE) comprobante por comprobante desde la API oficial, y descárgalo en Excel.",
    cta: "Abrir detalle",
    contenido: [
      "Compras (RCE) y ventas (RVIE) por periodo, desde la API de SUNAT.",
      "Comprobante por comprobante, con acumulado anual.",
      "Estado presentado / no presentado por mes y descarga en Excel.",
    ],
  },
  {
    href: "/herramientas/visor",
    icono: "🧩",
    titulo: "Visor Tributario",
    detalle: "Extensión del navegador: mientras navegas SUNAT (SIRE, DJ mensual y anual) captura los datos y los trae a Radar para el reporte.",
    cta: "Iniciar extensión",
    contenido: [
      "Extensión para Chrome/Edge con tu token ya incrustado.",
      "Captura SIRE, DJ mensual y anual mientras navegas SUNAT.",
      "Sin bots, captcha ni bloqueo de IP; arma el cuadro año × mes.",
    ],
  },
  {
    href: "/herramientas/comprobantes-xml",
    icono: "📥",
    titulo: "Descarga masiva de comprobantes",
    detalle: "Facturas (XML o PDF oficial en bloque) y recibos por honorarios, directo de SUNAT, con el Excel completo con detracción, ítems y faltantes.",
    cta: "Abrir descarga",
    contenido: [
      "Facturas recibidas en bloque: XML o PDF oficial, desde una relación o el SIRE.",
      "Excel completo: cabecera, importes, detracción, ítems y relación de faltantes.",
      "Recibos por honorarios (RxH) por mes completo: detalle en Excel y plantilla para Contasis/StarSoft.",
    ],
  },
];

// Utilitarios (solo supremo, o cuentas con el utilitario habilitado).
const UTILITARIOS: Opcion[] = [
  { href: "/herramientas/conciliacion", icono: "⚖️", titulo: "Conciliación bancaria", cta: "Abrir",
    detalle: "Cruza el extracto bancario (PDF), el libro banco y la caja virtual por N° de operación y entrega el Excel conciliado.",
    contenido: ["Extracto bancario PDF + libro banco + caja virtual.", "Cruce por N° de operación.", "Excel con lo que falta contabilizar."] },
  { href: "/herramientas/ventas-caja", icono: "🧾", titulo: "Ventas vs Caja Virtual", cta: "Abrir",
    detalle: "Cruza el Libro de Ventas por mes (o ZIP) con la Caja Virtual por N° de comprobante y entrega el Excel con lo conciliado.",
    contenido: ["Libro de ventas mensual o ZIP.", "Cruce por N° de comprobante.", "Excel con lo que falta cobrar/registrar."] },
  { href: "/herramientas/analisis-compras", icono: "📊", titulo: "Análisis para RTP", cta: "Abrir",
    detalle: "Sube el Libro Diario y obtén el análisis de la clase 9 (gastos por función), un dashboard para gerencia y el informe en Excel.",
    contenido: ["Análisis de la cuenta clase 9 por función.", "Dashboard de compras/gastos.", "Informe en Excel."] },
  { href: "/herramientas/banco-word", icono: "📊", titulo: "Estado de cuenta (PDF) → Excel", cta: "Abrir",
    detalle: "Convierte el PDF del estado de cuenta (BCP) en un Excel con la tabla de conciliación lista para llenar.",
    contenido: ["Lectura del PDF del banco.", "Tabla fecha, descripción, N° op, cargo/abono, saldo.", "Excel listo para conciliar."] },
];

// ---------- Tarjetas compactas (fondo blanco, empavonado lento al pasar el mouse) ----------

function TarjetaModulo({ o }: { o: Opcion }) {
  return (
    <Link
      href={o.href}
      className="sheen group flex h-full min-h-0 flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:border-brand-200 hover:shadow-lg"
    >
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand-50 to-brand-100 text-xl ring-1 ring-brand-100">{o.icono}</span>
        <h2 className="text-sm font-bold leading-snug text-slate-800 group-hover:text-brand-700 xl:text-[15px]">{o.titulo}</h2>
      </div>
      {/* Descripción recortada por líneas según la altura de la pantalla (nunca a media línea) */}
      <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-slate-500 [@media(max-height:820px)]:line-clamp-2 2xl:line-clamp-4">{o.detalle}</p>
      <div className="flex-1" />
      <span className="mt-3 inline-flex w-fit items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors duration-500 group-hover:border-brand-500 group-hover:bg-brand-50 group-hover:text-brand-700">
        {o.cta} <span aria-hidden>→</span>
      </span>
    </Link>
  );
}

function ItemUtilitario({ o }: { o: Opcion }) {
  return (
    <Link href={o.href} className="sheen group flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-2.5 hover:border-brand-200 hover:shadow-md">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-brand-50 to-brand-100 text-base ring-1 ring-brand-100">{o.icono}</span>
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-xs font-bold text-slate-800 group-hover:text-brand-700">{o.titulo}</h3>
        <p className="truncate text-[11px] text-slate-500">{o.detalle}</p>
      </div>
      <span className="text-slate-400 transition-colors duration-500 group-hover:text-brand-600" aria-hidden>→</span>
    </Link>
  );
}

// Ilustración del héroe: tablero con barras, línea y dona (sin imágenes externas).
function Ilustracion() {
  return (
    <svg viewBox="0 0 320 260" className="h-full w-auto max-h-[230px] max-w-full drop-shadow-[0_20px_40px_rgba(0,0,0,0.45)]" aria-hidden>
      <defs>
        <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#6f98c9" /><stop offset="1" stopColor="#234d82" /></linearGradient>
        <linearGradient id="g2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#f6db84" /><stop offset="1" stopColor="#dca200" /></linearGradient>
        <linearGradient id="g3" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#ffffff" stopOpacity="0.22" /><stop offset="1" stopColor="#ffffff" stopOpacity="0.06" /></linearGradient>
      </defs>
      <rect x="150" y="18" width="150" height="96" rx="14" fill="url(#g3)" stroke="#ffffff" strokeOpacity="0.25" />
      <polyline points="165,92 190,70 212,80 236,52 262,60 286,36" fill="none" stroke="#f1c945" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="286" cy="36" r="4.5" fill="#f1c945" />
      <rect x="165" y="100" width="40" height="5" rx="2.5" fill="#ffffff" fillOpacity="0.35" />
      <circle cx="78" cy="96" r="42" fill="none" stroke="#ffffff" strokeOpacity="0.15" strokeWidth="18" />
      <circle cx="78" cy="96" r="42" fill="none" stroke="url(#g2)" strokeWidth="18" strokeDasharray="120 400" strokeLinecap="round" transform="rotate(-90 78 96)" />
      <circle cx="78" cy="96" r="42" fill="none" stroke="#6f98c9" strokeWidth="18" strokeDasharray="70 400" strokeDashoffset="-128" strokeLinecap="round" transform="rotate(-90 78 96)" />
      <g>
        <rect x="150" y="190" width="26" height="50" rx="6" fill="url(#g1)" />
        <rect x="186" y="166" width="26" height="74" rx="6" fill="url(#g1)" />
        <rect x="222" y="178" width="26" height="62" rx="6" fill="url(#g2)" />
        <rect x="258" y="138" width="26" height="102" rx="6" fill="url(#g1)" />
        <rect x="140" y="242" width="156" height="4" rx="2" fill="#ffffff" fillOpacity="0.3" />
      </g>
      <path d="M30 236 C 70 200, 100 214, 130 170" fill="none" stroke="#ffffff" strokeOpacity="0.8" strokeWidth="4" strokeLinecap="round" />
      <path d="M118 166 L 134 164 L 128 180 Z" fill="#ffffff" fillOpacity="0.85" />
    </svg>
  );
}

export default async function MenuPage() {
  // Visitante sin sesión → directo al login (la portada pública vive en /conoce).
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  // Usuario restringido "solo RTP": va directo a su hub, sin ver el menú.
  if (esSoloRtp(user)) redirect("/rtputilitarios");
  const mods = await modulosDelEstudio(user);
  const supremo = esSupremo(user);
  const plan = await planDelEstudio(user);

  const bloqueado = (o: Opcion) => { const m = moduloPorHref(o.href); return m ? !mods.has(m.key) : false; };
  const destacado = PRINCIPALES.find((o) => o.destacado)!;
  const activos = PRINCIPALES.filter((o) => !o.destacado && !bloqueado(o));
  const premium = PRINCIPALES.filter((o) => !o.destacado && bloqueado(o));
  // Utilitarios: se muestran si es supremo o si la cuenta tiene alguno habilitado.
  const verUtilitarios = supremo || UTILITARIOS.some((o) => !bloqueado(o));
  const utilActivos = verUtilitarios ? UTILITARIOS.filter((o) => !bloqueado(o)) : [];
  const utilBloqueados = verUtilitarios ? UTILITARIOS.filter((o) => bloqueado(o)) : [];

  const etiqueta = (o: Opcion) => {
    const m = moduloPorHref(o.href);
    if (m?.soloSupremo) return { badge: "Bloqueado (de pago)", boton: "Saber más", planMin: "Utilitario" };
    if (m?.planMin === "premium") return { badge: "Bloqueado (de pago)", boton: "Ver planes", planMin: "Premium" };
    return { badge: "Bloqueado", boton: "Desbloquear acceso", planMin: PLAN_LABEL[m?.planMin ?? "regular"].replace(/\s*\(.*\)/, "") };
  };
  const resumen = (o: Opcion) => ({ titulo: o.titulo, detalle: o.detalle, icono: o.icono, contenido: o.contenido });
  const bloqueadosDescubre = [...premium, ...utilBloqueados].map((o) => ({ ...resumen(o), ...etiqueta(o) }));
  const activosDescubre = [destacado, ...activos, ...utilActivos].map(resumen);

  return (
    // En escritorio: TODO cabe en una pantalla (sin desplazamiento de página).
    <div className="flex flex-col gap-4 lg:h-full lg:min-h-0">
      {/* Fuente oficial de los datos (siempre visible) */}
      <div className="flex shrink-0 flex-wrap items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-2 shadow-sm">
        <span className="text-sm font-medium text-slate-500">Información extraída de:</span>
        <img src="/logo-sunat.png" alt="SUNAT" className="h-7 w-auto" />
        <span className="hidden text-xs text-slate-400 sm:inline">
          · Fuentes oficiales SUNAT (SIRE, buzón electrónico, RUC y reportes) en tiempo real.
        </span>
      </div>

      {/* Recordatorios de buzón (plazos de atención vencidos / por vencer) */}
      <div className="shrink-0 empty:hidden"><RecordatoriosBanner /></div>

      <div className="grid gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-12">
        {/* Héroe */}
        <section className="sheen sheen-dark relative flex flex-col overflow-hidden rounded-3xl bg-gradient-to-br from-brand-500 via-brand-700 to-brand-900 p-6 text-white shadow-xl lg:col-span-4 lg:min-h-0">
          <div className="absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/10" />
          <div className="absolute -bottom-20 -left-10 h-56 w-56 rounded-full bg-accent-400/10" />
          <div className="relative flex min-h-0 flex-1 flex-col">
            <h1 className="text-3xl font-black leading-[1.05] tracking-tight xl:text-4xl 2xl:text-5xl">¿Qué quieres hacer hoy?</h1>
            <p className="mt-3 text-base text-brand-100 xl:text-lg">Selecciona una herramienta para comenzar a trabajar</p>
            <p className="mt-3 text-sm text-white/85">Conexión activa con fuentes oficiales de SUNAT en tiempo real</p>
            <span className="mt-2 inline-flex w-fit items-center gap-1.5 rounded-full bg-emerald-500/20 px-2.5 py-1 text-xs font-semibold text-emerald-300 ring-1 ring-emerald-400/40">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> En línea
            </span>
            {/* Ilustración: ocupa el espacio sobrante; se oculta en pantallas bajas */}
            <div className="my-3 hidden min-h-0 flex-1 items-center justify-center lg:flex [@media(max-height:720px)]:hidden">
              <Ilustracion />
            </div>
            <div className="relative mt-auto w-fit pt-4">
              <span className="absolute right-3 top-1 z-10 rounded-md bg-accent-300 px-2 py-0.5 text-[10px] font-bold text-brand-900 shadow">Recomendado</span>
              <Link
                href={destacado.href}
                className="sheen inline-flex max-w-xs items-center gap-3 rounded-2xl bg-accent-400 px-5 py-3 text-sm font-bold leading-snug text-brand-900 shadow-lg hover:bg-accent-300"
              >
                <span>{destacado.cta}</span>
                <span className="text-lg" aria-hidden>→</span>
              </Link>
            </div>
          </div>
        </section>

        {/* Módulos activos (llenan la altura; si no caben, se desplazan dentro sin barra) */}
        <div className="sin-barra lg:col-span-5 lg:min-h-0 lg:overflow-y-auto">
          {activos.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
              Tu plan incluye el Reporte analítico de auditoría. Pulsa <strong className="text-slate-700">Descubre qué más puedes hacer</strong> para ver los demás módulos.
            </div>
          ) : (
            <div className={`grid gap-4 ${activos.length > 2 ? "sm:grid-cols-2 lg:h-full lg:auto-rows-fr" : "sm:grid-cols-2 lg:auto-rows-min"}`}>
              {activos.map((o) => <TarjetaModulo key={o.href} o={o} />)}
            </div>
          )}
        </div>

        {/* Columna derecha: Notificaciones (o Utilitarios) + Descubre */}
        <aside className="flex flex-col gap-4 lg:col-span-3 lg:min-h-0">
          {!supremo && <NotificacionesPanel />}
          {utilActivos.length > 0 && (
            <section className="sin-barra min-h-0 flex-1 overflow-y-auto rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="flex items-center gap-2 text-base font-bold text-slate-800">🧰 Utilitarios</h2>
              <div className="mt-3 space-y-2">
                {utilActivos.map((o) => <ItemUtilitario key={o.href} o={o} />)}
              </div>
            </section>
          )}
          <div className="shrink-0">
            <DescubreMas bloqueados={bloqueadosDescubre} activos={activosDescubre} planNombre={PLAN_LABEL[plan].replace(/\s*\(.*\)/, "")} />
          </div>
        </aside>
      </div>
    </div>
  );
}
