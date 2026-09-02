import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser, modulosDelEstudio, esSupremo, esSoloRtp } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Utilitarios RTP — Radar Tributario" };

// Página-hub que agrupa los utilitarios usados en el trabajo de RTP.
interface Util { key: string; href: string; icono: string; titulo: string; detalle: string }

const UTILES: Util[] = [
  {
    key: "analisis-rtp",
    href: "/herramientas/analisis-compras",
    icono: "📊",
    titulo: "Análisis para RTP",
    detalle: "Sube el Libro Diario y obtén el análisis de la cuenta clase 9 (gastos por función), un dashboard para gerencia y el informe en Excel.",
  },
  {
    key: "banco-word",
    href: "/herramientas/banco-word",
    icono: "📄",
    titulo: "Estado de cuenta (PDF) → Excel",
    detalle: "Convierte el PDF del estado de cuenta del banco en un Excel con la tabla de conciliación lista para llenar.",
  },
  {
    key: "honorarios",
    href: "/herramientas/honorarios",
    icono: "🧾",
    titulo: "Subida masiva de honorarios (RxH)",
    detalle: "Extrae de SUNAT los Recibos por Honorarios recibidos (Consulta Receptor) por mes(es) completo(s) y arma la plantilla de importación a Contasis.",
  },
  {
    key: "conciliacion",
    href: "/herramientas/conciliacion",
    icono: "⚖️",
    titulo: "Conciliación bancaria",
    detalle: "Cruza el extracto bancario (PDF), el libro banco y la caja virtual por N° de operación y entrega el Excel conciliado.",
  },
];

function Card({ u, bloqueado }: { u: Util; bloqueado: boolean }) {
  if (bloqueado) {
    return (
      <div className="flex flex-col rounded-2xl border border-slate-200 bg-slate-50 p-5 opacity-90" title="Pídelo al administrador">
        <div className="flex items-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-xl bg-slate-200 text-2xl grayscale">{u.icono}</span>
          <h2 className="text-base font-bold text-slate-500">{u.titulo}</h2>
        </div>
        <p className="mt-3 text-sm text-slate-400">{u.detalle}</p>
        <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-slate-400">🔒 Bloqueado</span>
      </div>
    );
  }
  return (
    <Link href={u.href} className="group flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-md">
      <div className="flex items-center gap-3">
        <span className="grid h-12 w-12 place-items-center rounded-xl bg-brand-50 text-2xl">{u.icono}</span>
        <h2 className="text-base font-bold text-slate-800 group-hover:text-brand-700">{u.titulo}</h2>
      </div>
      <p className="mt-3 text-sm text-slate-500">{u.detalle}</p>
      <span className="mt-4 text-sm font-semibold text-brand-600 group-hover:underline">Entrar →</span>
    </Link>
  );
}

export default async function Page() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/rtputilitarios");
  const mods = await modulosDelEstudio(user);
  const supremo = esSupremo(user);
  const soloRtp = esSoloRtp(user);

  return (
    <div className="space-y-6">
      <div>
        {!soloRtp && <Link href="/" className="text-sm text-brand-600 hover:underline">← Menú</Link>}
        <h1 className="mt-1 text-2xl font-bold text-slate-800">Utilitarios RTP</h1>
        <p className="text-sm text-slate-500">
          Herramientas de apoyo para el trabajo de RTP, agrupadas en un solo lugar.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {UTILES.map((u) => (
          <Card key={u.key} u={u} bloqueado={!supremo && !mods.has(u.key)} />
        ))}
      </div>
    </div>
  );
}
