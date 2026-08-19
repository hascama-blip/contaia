import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser, esSupremo, modulosDelEstudio } from "@/lib/auth";
import BancoPdfWordPanel from "@/components/BancoPdfWordPanel";

export const dynamic = "force-dynamic";
export const metadata = { title: "Estado de cuenta (PDF) → Word — Radar Tributario" };

export default async function Page() {
  const user = await requireUser();
  const mods = await modulosDelEstudio(user);
  if (!esSupremo(user) && !mods.has("banco-word")) redirect("/");

  return (
    <div className="space-y-4">
      <div>
        <Link href="/" className="text-sm text-brand-600 hover:underline">← Menú</Link>
        <h1 className="mt-1 text-2xl font-bold text-slate-800">Estado de cuenta (PDF) → Word</h1>
        <p className="text-sm text-slate-500">
          Convierte el PDF del estado de cuenta del banco a un Word con la estructura de conciliación,
          listo para agregar la columna de conciliación a mano.
        </p>
      </div>
      <BancoPdfWordPanel />
    </div>
  );
}
