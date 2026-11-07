import Link from "next/link";
import ClasificacionPanel from "@/components/ClasificacionPanel";
import { exigirModuloPagina } from "@/lib/acceso";

export const dynamic = "force-dynamic";

export const metadata = { title: "Clasificación de compras — Radar Tributario" };

export default async function Page() {
  await exigirModuloPagina("procesar-compras");
  return (
    <div className="space-y-4">
      <div>
        <Link href="/" className="text-sm text-brand-600 hover:underline">← Menú</Link>
        <h1 className="mt-1 text-2xl font-bold text-slate-800">Clasificación automática de compras</h1>
        <p className="text-sm text-slate-500">
          Sube el SIRE de compras y la cuenta contable de cada proveedor sale sola (por rubro). Solo confirmas los nuevos.
        </p>
      </div>
      <ClasificacionPanel />
    </div>
  );
}
