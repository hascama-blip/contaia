import Link from "next/link";
import { listClientes } from "@/lib/db";
import { requireUser, studioId, modulosDelEstudio } from "@/lib/auth";
import { moduloPorHref } from "@/lib/modulos";
import RecordatoriosBanner from "@/components/RecordatoriosBanner";

export const dynamic = "force-dynamic";

interface Opcion {
  href: string;
  icono: string;
  titulo: string;
  detalle: string;
  destacado?: boolean;
}

// Módulos principales (arriba).
const PRINCIPALES: Opcion[] = [
  {
    href: "/clientes",
    icono: "📑",
    titulo: "Reporte analítico de auditoría",
    detalle:
      "Consulta el RUC, registra los accesos a la API y ejecuta todos los procedimientos (SIRE, buzón, declaraciones, deudas) hasta el informe de gerencia.",
    destacado: true,
  },
  {
    href: "/herramientas/consultas",
    icono: "📨",
    titulo: "Consultas tributarias",
    detalle:
      "Extrae los mensajes del buzón electrónico SUNAT con sus asuntos y descarga, mensaje por mensaje, el PDF adjunto de cada notificación.",
  },
  {
    href: "/herramientas/rtt",
    icono: "📄",
    titulo: "Reporte Tributario para Terceros (RTT)",
    detalle:
      "Solicita el RTT de SUNAT y recíbelo automáticamente por webhook de correo, con trazabilidad de cada estado (creado → en proceso → listo). Descarga el PDF/XML cuando llega.",
  },
  {
    href: "/herramientas/detalle-sire",
    icono: "📋",
    titulo: "Detalle SIRE",
    detalle:
      "Extrae el detalle de la propuesta SUNAT (compras RCE y ventas RVIE, cada uno por separado) comprobante por comprobante desde la API oficial, y descárgalo en Excel.",
  },
];

// Utilitarios (abajo).
const UTILITARIOS: Opcion[] = [
  {
    href: "/herramientas/conciliacion",
    icono: "⚖️",
    titulo: "Conciliación bancaria",
    detalle:
      "Sube el extracto bancario (PDF), el libro banco contable y la caja virtual (Excel): el sistema cruza por N° de operación y entrega el Excel conciliado con lo que falta contabilizar.",
  },
  {
    href: "/herramientas/analisis-compras",
    icono: "📊",
    titulo: "Análisis para RTP",
    detalle:
      "Sube el Libro Diario y obtén el análisis de la cuenta clase 9 (gastos por función: administración, ventas, financieros), un dashboard de compras/gastos para gerencia y el informe en Excel.",
  },
  {
    href: "/herramientas/comprobantes-xml",
    icono: "📥",
    titulo: "Comprobante XML SUNAT",
    detalle:
      "Descarga los XML de las compras (comprobantes recibidos) directo de SUNAT por Clave SOL. Sube una relación de comprobantes (con su plantilla) o un periodo, y arma el Excel con el detalle.",
  },
];

function Tarjeta({ o, bloqueado }: { o: Opcion; bloqueado: boolean }) {
  if (bloqueado) {
    return (
      <div
        className="flex flex-col rounded-2xl border border-slate-200 bg-slate-50 p-5 opacity-90"
        title="Módulo de paga — pídelo al administrador"
      >
        <div className="flex items-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-xl bg-slate-200 text-2xl grayscale">
            {o.icono}
          </span>
          <h2 className="text-base font-bold text-slate-500">{o.titulo}</h2>
        </div>
        <p className="mt-3 text-sm text-slate-400">{o.detalle}</p>
        <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-slate-400">
          🔒 Bloqueado (de paga)
        </span>
      </div>
    );
  }
  return (
    <Link
      href={o.href}
      className={`group flex flex-col rounded-2xl border bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${
        o.destacado ? "border-accent-300" : "border-slate-200 hover:border-brand-200"
      }`}
    >
      <div className="flex items-center gap-3">
        <span className="grid h-12 w-12 place-items-center rounded-xl bg-brand-50 text-2xl">
          {o.icono}
        </span>
        <h2 className="text-base font-bold text-slate-800 group-hover:text-brand-700">
          {o.titulo}
        </h2>
      </div>
      <p className="mt-3 text-sm text-slate-500">{o.detalle}</p>
      <span className="mt-4 text-sm font-semibold text-brand-600 group-hover:underline">
        Entrar →
      </span>
    </Link>
  );
}

export default async function MenuPage() {
  const user = await requireUser();
  const clientes = await listClientes(studioId(user));
  const mods = await modulosDelEstudio(user);

  return (
    <div className="space-y-6">
      {/* Héroe */}
      <section className="hero-gradient relative overflow-hidden rounded-3xl p-7 text-white shadow-lg">
        <div className="absolute -right-12 -top-12 h-48 w-48 rounded-full bg-white/10" />
        <div className="absolute -bottom-16 left-1/3 h-48 w-48 rounded-full bg-white/10" />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div>
            <span translate="no" className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold backdrop-blur">
              RADAR TRIBUTAR<span className="rounded bg-accent-400 px-1 text-brand-900">IA</span>
            </span>
            <h1 className="mt-3 text-3xl font-bold leading-tight">¿Qué quieres hacer hoy?</h1>
            <p className="mt-2 max-w-xl text-sm text-white/85">
              Elige una sección. Cada herramienta tiene su propia pantalla para no mezclar nada.
            </p>
          </div>
          <Link
            href="/clientes/nuevo"
            className="rounded-xl bg-white px-5 py-3 text-sm font-bold text-brand-700 shadow-md transition hover:bg-brand-50"
          >
            + Nuevo cliente
          </Link>
        </div>
      </section>

      {/* Recordatorios de buzón (plazos de atención vencidos / por vencer) */}
      <RecordatoriosBanner />

      {/* Módulos principales */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {PRINCIPALES.map((o) => {
          const mod = moduloPorHref(o.href);
          const bloqueado = mod ? !mods.has(mod.key) : false;
          return <Tarjeta key={o.titulo} o={o} bloqueado={bloqueado} />;
        })}
      </div>

      {/* Utilitarios */}
      <div className="pt-2">
        <div className="mb-3 flex items-center gap-3">
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">🧰 Utilitarios</h2>
          <div className="h-px flex-1 bg-slate-200" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {UTILITARIOS.map((o) => {
            const mod = moduloPorHref(o.href);
            const bloqueado = mod ? !mods.has(mod.key) : false;
            return <Tarjeta key={o.titulo} o={o} bloqueado={bloqueado} />;
          })}
        </div>
      </div>

      <p className="text-center text-xs text-slate-400">
        {clientes.length} cliente(s) registrado(s) · selecciona una sección para empezar.
      </p>
    </div>
  );
}
