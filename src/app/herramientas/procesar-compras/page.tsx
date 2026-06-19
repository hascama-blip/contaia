import Link from "next/link";
import ProcesarComprasFlow from "@/components/ProcesarComprasFlow";

export const metadata = { title: "Compras: SIRE + Glosa + Cuenta → Contasis — Radar Tributario" };

export default function Page() {
  return (
    <div className="space-y-5">
      <div>
        <Link href="/" className="text-sm text-brand-600 hover:underline">← Menú</Link>
        <h1 className="mt-1 text-2xl font-bold text-slate-800">
          Compras: SIRE → Glosa (XML) → Cuenta → Contasis
        </h1>
        <p className="text-sm text-slate-500">
          Paso 1: sube el SIRE (obligatorio). Paso 2: sube los XML, que se vinculan al SIRE para
          la glosa y la validación. Al final descargas el masivo para Contasis.
        </p>
      </div>
      <ProcesarComprasFlow />
    </div>
  );
}
