import Link from "next/link";
import { requireUser } from "@/lib/auth";
import AnalisisComprasPanel from "@/components/AnalisisComprasPanel";

export const dynamic = "force-dynamic";
export const metadata = { title: "Análisis de compras para RTP — Radar Tributario" };

export default async function Page() {
  await requireUser();
  return (
    <div className="space-y-4">
      <div>
        <Link href="/" className="text-sm text-brand-600 hover:underline">← Menú</Link>
        <h1 className="mt-1 text-2xl font-bold text-slate-800">Análisis de compras para RTP</h1>
        <p className="text-sm text-slate-500">
          Sube el Libro Diario, obtén el análisis de la cuenta clase 9 (por función) y un dashboard de
          compras/gastos para gerencia, con informe descargable en Excel.
        </p>
      </div>
      <AnalisisComprasPanel />
    </div>
  );
}
