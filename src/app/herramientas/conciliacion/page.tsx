import Link from "next/link";
import { requireUser } from "@/lib/auth";
import ConciliacionPanel from "@/components/ConciliacionPanel";
import ConciliacionStarsoftPanel from "@/components/ConciliacionStarsoftPanel";

export const dynamic = "force-dynamic";
export const metadata = { title: "Conciliación bancaria — Radar Tributario" };

export default async function Page() {
  await requireUser();
  return (
    <div className="space-y-4">
      <div>
        <Link href="/" className="text-sm text-brand-600 hover:underline">← Menú</Link>
        <h1 className="mt-1 text-2xl font-bold text-slate-800">Conciliación bancaria</h1>
        <p className="text-sm text-slate-500">
          Sube el <b>extracto bancario</b> (PDF), el <b>libro banco</b> de tu contabilidad (Excel) y,
          opcionalmente, la <b>caja virtual</b> (Excel). El sistema cruza movimiento por movimiento
          usando el <b>N° de operación</b> del banco (con respaldo por fecha y monto) y te entrega el
          Excel conciliado: qué cuadra, qué está en el banco sin contabilizar y qué está en el libro
          sin respaldo bancario.
        </p>
      </div>
      <ConciliacionPanel />

      <div className="flex items-center gap-3 pt-2">
        <div className="h-px flex-1 bg-slate-200" />
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">o desde el sistema StarSoft</span>
        <div className="h-px flex-1 bg-slate-200" />
      </div>

      <ConciliacionStarsoftPanel />
    </div>
  );
}
