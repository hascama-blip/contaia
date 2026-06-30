import Link from "next/link";
import MasivoFlow from "@/components/MasivoFlow";
import { requireUser, modulosDelEstudio } from "@/lib/auth";
import { ModuloBloqueado } from "@/components/ModuloBloqueado";

export const dynamic = "force-dynamic";
export const metadata = { title: "Masivo SIRE → Contabilidad — Radar Tributario" };

export default async function Page() {
  const user = await requireUser();
  const mods = await modulosDelEstudio(user);
  if (!mods.has("m3")) return <ModuloBloqueado nombre="Masivo SIRE → Contabilidad (Contasis)" />;
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
