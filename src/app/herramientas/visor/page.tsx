import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser, esSupremo, modulosDelEstudio } from "@/lib/auth";
import VisorPanel from "@/components/VisorPanel";

export const dynamic = "force-dynamic";
export const metadata = { title: "Visor Tributario — Radar Tributario" };

export default async function Page() {
  const user = await requireUser();
  const mods = await modulosDelEstudio(user);
  if (!esSupremo(user) && !mods.has("visor")) redirect("/");

  return (
    <div className="space-y-4">
      <div>
        <Link href="/" className="text-sm text-brand-600 hover:underline">← Menú</Link>
        <h1 className="mt-1 text-2xl font-bold text-slate-800">Visor Tributario</h1>
        <p className="text-sm text-slate-500">
          Lee lo que ves en SUNAT mientras navegas (SIRE, DJ mensual, DJ anual) mediante una extensión
          del navegador y lo trae aquí para armar el reporte — sin bots, sin captcha y sin bloqueo de IP.
        </p>
      </div>
      <VisorPanel />
    </div>
  );
}
