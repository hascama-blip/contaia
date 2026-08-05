import Link from "next/link";
import { listClientes } from "@/lib/db";
import { requireUser, studioId } from "@/lib/auth";
import DetalleSireTool from "@/components/DetalleSireTool";

export const dynamic = "force-dynamic";
export const metadata = { title: "Detalle SIRE — Radar Tributario" };

export default async function Page() {
  const user = await requireUser();
  const clientes = await listClientes(studioId(user));
  const min = clientes.map((c) => ({
    id: c.id,
    razonSocial: c.razonSocial,
    ruc: c.ruc,
    solUser: c.credSire?.solUser ?? "",
  }));

  return (
    <div className="space-y-4">
      <div>
        <Link href="/" className="text-sm text-brand-600 hover:underline">← Menú</Link>
        <h1 className="mt-1 text-2xl font-bold text-slate-800">Detalle SIRE</h1>
        <p className="text-sm text-slate-500">
          Extrae el detalle de la propuesta SUNAT (RVIE ventas / RCE compras) comprobante por
          comprobante, vía la API oficial, y descárgalo en Excel.
        </p>
      </div>
      <DetalleSireTool clientes={min} />
    </div>
  );
}
