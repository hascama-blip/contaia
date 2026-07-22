import Link from "next/link";
import { listClientes } from "@/lib/db";
import { requireUser, studioId } from "@/lib/auth";
import ComprobantesXmlTool from "@/components/ComprobantesXmlTool";

export const dynamic = "force-dynamic";
export const metadata = { title: "Comprobantes XML (SUNAT) — Radar Tributario" };

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
        <h1 className="mt-1 text-2xl font-bold text-slate-800">Comprobantes XML (SUNAT)</h1>
        <p className="text-sm text-slate-500">
          Elige la empresa, sube la relación de comprobantes (o el periodo) y descarga sus XML de compras
          directo de SUNAT, con el detalle en Excel.
        </p>
      </div>
      <ComprobantesXmlTool clientes={min} />
    </div>
  );
}
