import Link from "next/link";
import FacturasXmlPanel from "@/components/FacturasXmlPanel";

export const metadata = { title: "Facturas XML — Radar Tributario" };

export default function Page() {
  return (
    <div className="space-y-4">
      <div>
        <Link href="/" className="text-sm text-brand-600 hover:underline">← Menú</Link>
        <h1 className="mt-1 text-2xl font-bold text-slate-800">Detalle completo de facturas (XML)</h1>
        <p className="text-sm text-slate-500">
          Sube los XML de los comprobantes y obtén toda la información: emisor, receptor, montos por
          afectación y el detalle de cada ítem. Descárgalo en Excel.
        </p>
      </div>
      <FacturasXmlPanel />
    </div>
  );
}
