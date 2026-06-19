import Link from "next/link";
import { listClientes } from "@/lib/db";

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
    icono: "🏢",
    titulo: "Clientes",
    detalle: "RUC, estado SUNAT, SIRE, buzón, declaraciones y deudas de cada cliente.",
  },
  {
    href: "/clientes",
    icono: "📑",
    titulo: "Reporte de auditoría",
    detalle: "Genera el informe de gerencia de un cliente. Entra al cliente y pulsa “Generar informe”.",
    destacado: true,
  },
  {
    href: "/herramientas/cruce-sire",
    icono: "🔀",
    titulo: "Comparativo SIRE vs Contabilidad",
    detalle: "Cruza el SIRE con Contasis comprobante por comprobante y baja las diferencias en Excel.",
    destacado: true,
  },
  {
    href: "/herramientas/clasificacion",
    icono: "🏷️",
    titulo: "Clasificación de compras",
    detalle: "Sube el SIRE de compras y asigna la cuenta contable por rubro del proveedor (aprende).",
  },
  {
    href: "/herramientas/facturas-xml",
    icono: "📄",
    titulo: "Facturas XML → detalle + cuenta",
    detalle: "Lee los XML: descripción (glosa), montos y cuenta automática, listo para Contasis.",
  },
  {
    href: "/dashboard",
    icono: "📊",
    titulo: "Dashboard",
    detalle: "Panorama de tu cartera: riesgos, estado SUNAT y clientes que requieren atención.",
  },
];

export default async function MenuPage() {
  const clientes = await listClientes();

  return (
    <div className="space-y-6">
      {/* Héroe */}
      <section className="hero-gradient relative overflow-hidden rounded-3xl p-7 text-white shadow-lg">
        <div className="absolute -right-12 -top-12 h-48 w-48 rounded-full bg-white/10" />
        <div className="absolute -bottom-16 left-1/3 h-48 w-48 rounded-full bg-white/10" />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold backdrop-blur">
              Radar Tributario · by ASENCO
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

      {/* Menú de tarjetas */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {OPCIONES.map((o) => (
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
        ))}
      </div>

      <p className="text-center text-xs text-slate-400">
        {clientes.length} cliente(s) registrado(s) · selecciona una sección para empezar.
      </p>
    </div>
  );
}
