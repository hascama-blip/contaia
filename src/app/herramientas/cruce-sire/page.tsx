import Link from "next/link";
import CruceSirePanel from "@/components/CruceSirePanel";

export const metadata = { title: "Comparativo SIRE vs Contabilidad — Radar Tributario" };

export default function Page() {
  return (
    <div className="space-y-4">
      <div>
        <Link href="/" className="text-sm text-brand-600 hover:underline">← Menú</Link>
        <h1 className="mt-1 text-2xl font-bold text-slate-800">Comparativo SIRE vs Contabilidad</h1>
        <p className="text-sm text-slate-500">
          Sube los Excel del SIRE (RCE/RVIE) y de Contasis y compáralos comprobante por comprobante.
        </p>
      </div>
      <CruceSirePanel />
    </div>
  );
}
