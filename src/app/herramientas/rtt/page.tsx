import Link from "next/link";
import { listClientes } from "@/lib/db";
import { requireUser, studioId } from "@/lib/auth";
import RttPanel from "@/components/RttPanel";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reporte Tributario para Terceros (RTT) — Radar Tributario" };

export default async function Page() {
  const user = await requireUser();
  const clientes = await listClientes(studioId(user));
  const min = clientes.map((c) => ({ id: c.id, razonSocial: c.razonSocial, ruc: c.ruc, solUser: c.credSire?.solUser ?? "" }));

  return (
    <div className="space-y-4">
      <div>
        <Link href="/" className="text-sm text-brand-600 hover:underline">← Menú</Link>
        <h1 className="mt-1 text-2xl font-bold text-slate-800">Reporte Tributario para Terceros (RTT)</h1>
        <p className="text-sm text-slate-500">
          Solicita el RTT de SUNAT y recíbelo automáticamente por webhook de correo, con trazabilidad de
          cada estado — sin revisar el correo a mano.
        </p>
      </div>
      <RttPanel clientes={min} />
    </div>
  );
}
