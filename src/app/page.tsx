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

const OPCIONES: Opcion[] = [
  {
    href: "/clientes",
    icono: "📑",
    titulo: "Reporte analítico de auditoría",
    detalle:
      "Consulta el RUC, registra los accesos a la API y ejecuta todos los procedimientos (SIRE, buzón, declaraciones, deudas) hasta el informe de gerencia.",
    destacado: true,
  },
  {
    href: "/herramientas/cruce-sire",
    icono: "🔀",
    titulo: "Comparativo SIRE vs sistema contable",
    detalle:
      "Cruza el SIRE con Contasis comprobante por comprobante y descarga el reporte de diferencias en Excel.",
    destacado: true,
  },
  {
    href: "/herramientas/procesar-compras",
    icono: "📥",
    titulo: "Masivo SIRE → Contabilidad (Contasis)",
    detalle:
      "Sube el SIRE de compras y ventas, agrega los XML (glosa, opcional), reclasifica las cuentas y genera el masivo para importar a Contasis.",
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
    href: "/herramientas/facturas-xml",
    icono: "🧾",
    titulo: "Detalle completo de facturas (XML)",
    detalle:
      "Sube los XML de los comprobantes (en bloque o en ZIP) y extrae toda la información: emisor, receptor, montos por afectación (gravado, IGV, ISC…) y el detalle de cada ítem. Descárgalo en Excel.",
  },
];

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
              RADAR TRIBUTAR<span className="rounded bg-accent-400 px-1 text-brand-900">IA</span> · by <span className="font-bold">ASENCO</span>
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

      {/* Menú de tarjetas */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {OPCIONES.map((o) => {
          const mod = moduloPorHref(o.href);
          const bloqueado = mod ? !mods.has(mod.key) : false;
          if (bloqueado) {
            return (
              <div
                key={o.titulo}
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
              key={o.titulo}
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
        })}
      </div>

      <p className="text-center text-xs text-slate-400">
        {clientes.length} cliente(s) registrado(s) · selecciona una sección para empezar.
      </p>
    </div>
  );
}
