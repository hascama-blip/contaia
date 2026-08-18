import Link from "next/link";
import { requireUser, esSupremo, modulosDelEstudio } from "@/lib/auth";
import { redirect } from "next/navigation";
import VentasCajaPanel from "@/components/VentasCajaPanel";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ventas vs Caja Virtual — Radar Tributario" };

export default async function Page() {
  const user = await requireUser();
  const mods = await modulosDelEstudio(user);
  if (!esSupremo(user) && !mods.has("ventas-caja")) redirect("/"); // utilitario: supremo o habilitado

  return (
    <div className="space-y-4">
      <div>
        <Link href="/" className="text-sm text-brand-600 hover:underline">← Menú</Link>
        <h1 className="mt-1 text-2xl font-bold text-slate-800">Ventas vs Caja Virtual</h1>
        <p className="text-sm text-slate-500">
          Sube el <b>Libro de Ventas</b> por mes (o un ZIP con todos) y la <b>Caja Virtual</b>. Cruza por
          N° de comprobante y te entrega qué se cobró, qué <b>falta en caja</b> (ventas sin cobro) y qué
          hay en caja sin venta en el libro.
        </p>
      </div>
      <VentasCajaPanel />
    </div>
  );
}
