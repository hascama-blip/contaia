import Link from "next/link";
import MasivoFlow from "@/components/MasivoFlow";

export const metadata = { title: "Masivo SIRE → Contabilidad — Radar Tributario" };

export default function Page() {
  return (
    <div className="space-y-5">
      <div>
        <Link href="/" className="text-sm text-brand-600 hover:underline">← Menú</Link>
        <h1 className="mt-1 text-2xl font-bold text-slate-800">Masivo SIRE → Contabilidad (Contasis)</h1>
        <p className="text-sm text-slate-500">
          1) Sube el SIRE de compras y ventas. 2) Agrega los XML para la glosa (opcional).
          3) Reclasifica las cuentas si hace falta. Luego genera el masivo para Contasis.
        </p>
      </div>
      <MasivoFlow />
    </div>
  );
}
