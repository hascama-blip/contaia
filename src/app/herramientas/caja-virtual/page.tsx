import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser, esSupremo, modulosDelEstudio } from "@/lib/auth";
import CajaVirtualPanel from "@/components/CajaVirtualPanel";

export const dynamic = "force-dynamic";
export const metadata = { title: "Caja virtual: reportes por sede — Radar Tributario" };

export default async function Page() {
  const user = await requireUser();
  const mods = await modulosDelEstudio(user);
  if (!esSupremo(user) && !mods.has("caja-virtual")) redirect("/"); // utilitario: supremo o habilitado

  return (
    <div className="space-y-4">
      <div>
        <Link href="/" className="text-sm text-brand-600 hover:underline">← Menú</Link>
        <h1 className="mt-1 text-2xl font-bold text-slate-800">Caja virtual · reportes por sede</h1>
        <p className="text-sm text-slate-500">
          Entra una sola vez a la caja virtual y descarga, de <b>cada sede</b> y <b>cada día</b> del periodo, el <b>PDF</b> y el
          <b> Excel</b> del reporte de ingresos y lo que hay en su carpeta de <b>Google Drive</b> (reporte, depósito, Yape…).
        </p>
      </div>
      <CajaVirtualPanel />
    </div>
  );
}
