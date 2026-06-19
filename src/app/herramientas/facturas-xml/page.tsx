import Link from "next/link";
import FacturasXmlPanel from "@/components/FacturasXmlPanel";

export const metadata = { title: "Facturas XML — Radar Tributario" };

export default function Page() {
  return (
    <div className="space-y-4">
      <div>
        <Link href="/" className="text-sm text-brand-600 hover:underline">← Menú</Link>
        <h1 className="mt-1 text-2xl font-bold text-slate-800">Facturas XML → detalle + cuenta</h1>
        <p className="text-sm text-slate-500">
          Sube los XML de las facturas y obtén la descripción (glosa), montos y la cuenta automática.
        </p>
      </div>
      <FacturasXmlPanel />
    </div>
  );
}
