import Link from "next/link";
import { listClientes } from "@/lib/db";
import { redirect } from "next/navigation";
import { getCurrentUser, studioId, modulosDelEstudio, esSupremo, esSoloRtp } from "@/lib/auth";
import { moduloPorHref } from "@/lib/modulos";
import RecordatoriosBanner from "@/components/RecordatoriosBanner";
import NotificacionesPanel from "@/components/NotificacionesPanel";
import DescubreMas from "@/components/DescubreMas";
import Landing from "@/components/Landing";

export const dynamic = "force-dynamic";

interface Opcion {
  href: string;
  icono: string;
  titulo: string;
  detalle: string;
  /** Texto del botón de la tarjeta ("Abrir detalle →", "Iniciar extensión →"…). */
  cta: string;
  destacado?: boolean;
}

// Módulos principales. El destacado (Reporte analítico) es el botón
// "Recomendado" del héroe; el resto va en tarjetas (activos) o en el panel
// "Servicios Premium" (bloqueados por plan).
const PRINCIPALES: Opcion[] = [
  {
    href: "/clientes",
    icono: "📑",
    titulo: "Reporte analítico de auditoría",
    detalle:
      "Consulta el RUC, registra los accesos a la API y ejecuta todos los procedimientos (SIRE, buzón, declaraciones, deudas) hasta el informe de gerencia.",
    cta: "Acceder al Reporte analítico de auditoría",
    destacado: true,
  },
  {
    href: "/herramientas/consultas",
    icono: "📨",
    titulo: "Consultas tributarias",
    detalle:
      "Extrae los mensajes del buzón electrónico SUNAT con sus asuntos y descarga, mensaje por mensaje, el PDF adjunto de cada notificación.",
    cta: "Abrir consultas",
  },
  {
    href: "/herramientas/rtt",
    icono: "📄",
    titulo: "Reporte Tributario para Terceros (RTT)",
    detalle:
      "Solicita el RTT de SUNAT y recíbelo automáticamente por webhook de correo, con trazabilidad de cada estado (creado → en proceso → listo). Descarga el PDF/XML cuando llega.",
    cta: "Solicitar RTT",
  },
  {
    href: "/herramientas/detalle-sire",
    icono: "📋",
    titulo: "Detalle SIRE",
    detalle:
      "Extrae el detalle de la propuesta SUNAT (compras RCE y ventas RVIE, cada uno por separado) comprobante por comprobante desde la API oficial, y descárgalo en Excel.",
    cta: "Abrir detalle",
  },
  {
    href: "/herramientas/visor",
    icono: "🧩",
    titulo: "Visor Tributario",
    detalle:
      "Extensión del navegador: mientras navegas SUNAT (SIRE, DJ mensual y anual) captura los datos y los trae a Radar para el reporte — sin bots, captcha ni bloqueo de IP.",
    cta: "Iniciar extensión",
  },
  {
    href: "/herramientas/comprobantes-xml",
    icono: "📥",
    titulo: "Descarga masiva de comprobantes",
    detalle:
      "Facturas y recibos por honorarios recibidos, directo de SUNAT por Clave SOL. Facturas: XML o PDF oficial en bloque (desde una relación o el SIRE) y el Excel completo con detracción, ítems y faltantes. Honorarios (RxH): por mes(es) completo(s), con la plantilla para Contasis/StarSoft.",
    cta: "Abrir descarga",
  },
];

// Utilitarios (solo supremo, o cuentas con el utilitario habilitado).
const UTILITARIOS: Opcion[] = [
  {
    href: "/herramientas/conciliacion",
    icono: "⚖️",
    titulo: "Conciliación bancaria",
    detalle:
      "Sube el extracto bancario (PDF), el libro banco contable y la caja virtual (Excel): el sistema cruza por N° de operación y entrega el Excel conciliado con lo que falta contabilizar.",
    cta: "Abrir",
  },
  {
    href: "/herramientas/ventas-caja",
    icono: "🧾",
    titulo: "Ventas vs Caja Virtual",
    detalle:
      "Sube el Libro de Ventas por mes (o un ZIP) y la Caja Virtual: cruza por N° de comprobante y entrega el Excel con lo conciliado y lo que falta cobrar/registrar.",
    cta: "Abrir",
  },
  {
    href: "/herramientas/analisis-compras",
    icono: "📊",
    titulo: "Análisis para RTP",
    detalle:
      "Sube el Libro Diario y obtén el análisis de la cuenta clase 9 (gastos por función: administración, ventas, financieros), un dashboard de compras/gastos para gerencia y el informe en Excel.",
    cta: "Abrir",
  },
  {
    href: "/herramientas/banco-word",
    icono: "📊",
    titulo: "Estado de cuenta (PDF) → Excel",
    detalle:
      "Convierte el PDF del estado de cuenta del banco (BCP) en un Excel con la tabla de conciliación (fecha, descripción, N° op, hora, cargo/abono, saldo) lista para llenar.",
    cta: "Abrir",
  },
];

// ---------- Tarjetas (fondo blanco, con empavonado en movimiento al pasar el mouse) ----------

function TarjetaModulo({ o }: { o: Opcion }) {
  return (
    <Link
      href={o.href}
      className="sheen group flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm hover:border-brand-200 hover:shadow-lg"
    >
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-brand-50 to-brand-100 text-2xl ring-1 ring-brand-100">
        {o.icono}
      </span>
      <h2 className="mt-4 text-lg font-bold text-slate-800 group-hover:text-brand-700">{o.titulo}</h2>
      <p className="mt-1.5 flex-1 text-sm leading-relaxed text-slate-500">{o.detalle}</p>
      <span className="mt-4 inline-flex w-fit items-center gap-2 rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition-colors duration-500 group-hover:border-brand-500 group-hover:bg-brand-50 group-hover:text-brand-700">
        {o.cta} <span aria-hidden>→</span>
      </span>
    </Link>
  );
}

function ItemUtilitario({ o }: { o: Opcion }) {
  return (
    <Link href={o.href} className="sheen group flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3.5 hover:border-brand-200 hover:shadow-md">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand-50 to-brand-100 text-lg ring-1 ring-brand-100">{o.icono}</span>
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-sm font-bold text-slate-800 group-hover:text-brand-700">{o.titulo}</h3>
        <p className="line-clamp-2 text-[11px] leading-snug text-slate-500">{o.detalle}</p>
      </div>
      <span className="text-slate-400 transition-colors duration-500 group-hover:text-brand-600" aria-hidden>→</span>
    </Link>
  );
}

// Ilustración del héroe: tablero con barras, línea y dona (sin imágenes externas).
function Ilustracion() {
  return (
    <svg viewBox="0 0 320 260" className="h-auto w-full max-w-[300px] drop-shadow-[0_20px_40px_rgba(0,0,0,0.45)]" aria-hidden>
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
  // Visitante sin sesión → landing pública (el login interno queda en /login,
  // sin enlazar, para que no entre gente que no debe).
  const user = await getCurrentUser();
  if (!user) return <Landing />;
  // Usuario restringido "solo RTP": va directo a su hub, sin ver el menú.
  if (esSoloRtp(user)) redirect("/rtputilitarios");
  const clientes = await listClientes(studioId(user));
  const mods = await modulosDelEstudio(user);
  const supremo = esSupremo(user);

  const bloqueado = (o: Opcion) => { const m = moduloPorHref(o.href); return m ? !mods.has(m.key) : false; };
  const destacado = PRINCIPALES.find((o) => o.destacado)!;
  const activos = PRINCIPALES.filter((o) => !o.destacado && !bloqueado(o));
  const premium = PRINCIPALES.filter((o) => !o.destacado && bloqueado(o));
  // Utilitarios: se muestran si es supremo o si la cuenta tiene alguno habilitado.
  const verUtilitarios = supremo || UTILITARIOS.some((o) => !bloqueado(o));
  const utilActivos = verUtilitarios ? UTILITARIOS.filter((o) => !bloqueado(o)) : [];
  const utilBloqueados = verUtilitarios ? UTILITARIOS.filter((o) => bloqueado(o)) : [];
  // Las cuentas que no son supremo ven el panel de Notificaciones (plan, buzones,
  // próximos a declarar, avisos) en la columna derecha, en lugar de Utilitarios.
  const verNotificaciones = !supremo;
  const hayPanelDerecho = true; // Notificaciones (o Utilitarios) + "Descubre qué más puedes hacer"

  const etiqueta = (o: Opcion) => {
    const m = moduloPorHref(o.href);
    if (m?.soloSupremo) return { badge: "Bloqueado (de pago)", boton: "Saber más" };
    if (m?.planMin === "premium") return { badge: "Bloqueado (de pago)", boton: "Ver planes" };
    return { badge: "Bloqueado", boton: "Desbloquear acceso" };
  };
  // Módulos que el plan NO incluye → botón "Descubre qué más puedes hacer".
  const bloqueadosDescubre = [...premium, ...utilBloqueados].map((o) => {
    const e = etiqueta(o);
    return { titulo: o.titulo, detalle: o.detalle, icono: o.icono, badge: e.badge, boton: e.boton, href: "/planes" };
  });

  return (
    <div className="space-y-5">
      {/* Fuente oficial de los datos (siempre visible) */}
      <div className="flex flex-wrap items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-3 shadow-sm">
        <span className="text-sm font-medium text-slate-500">Información extraída de:</span>
        <img src="/logo-sunat.png" alt="SUNAT" className="h-8 w-auto" />
        <span className="hidden text-xs text-slate-400 sm:inline">
          · Fuentes oficiales SUNAT (SIRE, buzón electrónico, RUC y reportes) en tiempo real.
        </span>
      </div>

      {/* Recordatorios de buzón (plazos de atención vencidos / por vencer) */}
      <RecordatoriosBanner />

      <div className="grid items-start gap-5 lg:grid-cols-12">
        {/* Héroe */}
        <section className="sheen sheen-dark relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-500 via-brand-700 to-brand-900 p-7 text-white shadow-xl lg:col-span-4 lg:sticky lg:top-20">
          <div className="absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/10" />
          <div className="absolute -bottom-20 -left-10 h-56 w-56 rounded-full bg-accent-400/10" />
          <div className="relative">
            <div className="grid gap-6 sm:grid-cols-[1.1fr_1fr] sm:items-center lg:grid-cols-1 2xl:grid-cols-[1.1fr_1fr]">
              <div>
                <h1 className="text-4xl font-black leading-[1.05] tracking-tight xl:text-5xl">¿Qué quieres hacer hoy?</h1>
                <p className="mt-4 text-lg text-brand-100">Selecciona una herramienta para comenzar a trabajar</p>
                <p className="mt-5 text-sm text-white/85">Conexión activa con fuentes oficiales de SUNAT en tiempo real</p>
                <span className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-emerald-500/20 px-2.5 py-1 text-xs font-semibold text-emerald-300 ring-1 ring-emerald-400/40">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> En línea
                </span>
              </div>
              <div className="hidden sm:block lg:mx-auto lg:max-w-[240px] 2xl:max-w-none"><Ilustracion /></div>
            </div>
            <div className="relative mt-8 w-fit">
              <span className="absolute -top-3 right-3 z-10 rounded-md bg-accent-300 px-2 py-0.5 text-[10px] font-bold text-brand-900 shadow">Recomendado</span>
              <Link
                href={destacado.href}
                className="sheen inline-flex max-w-xs items-center gap-3 rounded-2xl bg-accent-400 px-5 py-3.5 text-sm font-bold leading-snug text-brand-900 shadow-lg hover:bg-accent-300"
              >
                <span>{destacado.cta}</span>
                <span className="text-lg" aria-hidden>→</span>
              </Link>
            </div>
          </div>
        </section>

        {/* Módulos activos */}
        <div className={hayPanelDerecho ? "lg:col-span-5" : "lg:col-span-8"}>
          {activos.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
              Tu plan incluye el Reporte analítico de auditoría. Los demás módulos están en <strong className="text-slate-700">Servicios Premium</strong>.
            </div>
          ) : (
            <div className={`grid gap-5 ${activos.length > 2 ? "sm:grid-cols-2" : ""}`}>
              {activos.map((o) => <TarjetaModulo key={o.href} o={o} />)}
            </div>
          )}
        </div>

        {/* Servicios Premium / Utilitarios */}
        {hayPanelDerecho && (
          // Fija al hacer scroll (igual que el héroe), sin barra de desplazamiento
          // propia: el contenido es compacto y los módulos bloqueados viven en el
          // botón "Descubre qué más puedes hacer".
          <aside className="space-y-5 lg:sticky lg:top-20 lg:col-span-3">
            {verNotificaciones && <NotificacionesPanel />}
            <DescubreMas bloqueados={bloqueadosDescubre} />
            {utilActivos.length > 0 && (
              <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="flex items-center gap-2 text-xl font-bold text-slate-800">🧰 Utilitarios</h2>
                <div className="mt-4 space-y-3">
                  {utilActivos.map((o) => <ItemUtilitario key={o.href} o={o} />)}
                </div>
              </section>
            )}
          </aside>
        )}
      </div>

      <p className="text-center text-xs text-slate-400">
        {clientes.length} cliente(s) registrado(s) · selecciona una sección para empezar.
      </p>
    </div>
  );
}
