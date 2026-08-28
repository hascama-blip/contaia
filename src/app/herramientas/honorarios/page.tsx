import Link from "next/link";
import { redirect } from "next/navigation";
import { listClientes } from "@/lib/db";
import { requireUser, esSupremo, modulosDelEstudio, studioId } from "@/lib/auth";
import HonorariosPanel from "@/components/HonorariosPanel";

export const dynamic = "force-dynamic";
export const metadata = { title: "Subida masiva de honorarios (RxH) — Radar Tributario" };

export default async function Page() {
  const user = await requireUser();
  const mods = await modulosDelEstudio(user);
  if (!esSupremo(user) && !mods.has("honorarios")) redirect("/");

  const clientes = await listClientes(studioId(user));
  const min = clientes.map((c) => ({ id: c.id, razonSocial: c.razonSocial, ruc: c.ruc, solUser: c.credSire?.solUser ?? "" }));

  return (
    <div className="space-y-4">
      <div>
        <Link href="/" className="text-sm text-brand-600 hover:underline">← Menú</Link>
        <h1 className="mt-1 text-2xl font-bold text-slate-800">Subida masiva de honorarios (RxH)</h1>
        <p className="text-sm text-slate-500">
          Extrae de SUNAT los Recibos por Honorarios recibidos (Consulta Receptor) por mes(es) completo(s) y
          arma la plantilla de importación a Contasis.
        </p>
      </div>
      <HonorariosPanel clientes={min} />
    </div>
  );
}
