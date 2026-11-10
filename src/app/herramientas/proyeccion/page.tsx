import Link from "next/link";
import { redirect } from "next/navigation";
import { listClientes } from "@/lib/db";
import { requireUser, esSupremo, modulosDelEstudio, studioId } from "@/lib/auth";
import ProyeccionPanel from "@/components/ProyeccionPanel";

export const dynamic = "force-dynamic";
export const metadata = { title: "Proyección tributaria — Radar Tributario" };

export default async function Page({ searchParams }: { searchParams: Promise<{ cliente?: string; periodo?: string }> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const mods = await modulosDelEstudio(user);
  if (!esSupremo(user) && !mods.has("proyeccion")) redirect("/"); // utilitario: supremo o habilitado
  const clientes = (await listClientes(studioId(user))).map((c) => ({ id: c.id, razonSocial: c.razonSocial, ruc: c.ruc }));

  return (
    <div className="space-y-4">
      <div>
        <Link href="/" className="text-sm text-brand-600 hover:underline">← Menú</Link>
        <h1 className="mt-1 text-2xl font-bold text-slate-800">Proyección tributaria</h1>
        <p className="text-sm text-slate-500">
          Cuánto se pagará de <b>IGV y renta</b> este mes. Primero genera el <b>SIRE del mes</b> en el Reporte analítico de
          auditoría y el <b>Detalle SIRE</b> (ventas y compras); aquí se arma el informe con ambos y pones a mano si hay
          <b> crédito a favor</b> de la DJ mensual anterior.
        </p>
      </div>
      <ProyeccionPanel
        clientes={clientes}
        inicialId={clientes.some((c) => c.id === sp.cliente) ? sp.cliente : undefined}
        inicialPeriodo={/^\d{6}$/.test(sp.periodo ?? "") ? sp.periodo : undefined}
      />
    </div>
  );
}
