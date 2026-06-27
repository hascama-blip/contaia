import Link from "next/link";
import { listClientes } from "@/lib/db";
import { requireUser, studioId } from "@/lib/auth";
import ConsultasFlow from "@/components/ConsultasFlow";
import DeudasF36Flow from "@/components/DeudasF36Flow";

export const dynamic = "force-dynamic";
export const metadata = { title: "Consultas tributarias — Radar Tributario" };

export default async function Page() {
  const user = await requireUser();
  const clientes = await listClientes(studioId(user));
  const lista = clientes.map((c) => ({
    id: c.id,
    razonSocial: c.razonSocial,
    ruc: c.ruc,
    solUser: c.credSire?.solUser ?? "",
  }));

  return (
    <div className="space-y-5">
      <div>
        <Link href="/" className="text-sm text-brand-600 hover:underline">← Menú</Link>
        <h1 className="mt-1 text-2xl font-bold text-slate-800">Consultas tributarias</h1>
        <p className="text-sm text-slate-500">
          Extrae los mensajes del buzón electrónico SUNAT (asuntos) y descarga, mensaje por
          mensaje, el PDF adjunto de cada notificación.
        </p>
      </div>
      <ConsultasFlow clientes={lista} />
      <hr className="border-slate-200" />
      <DeudasF36Flow clientes={lista} />
    </div>
  );
}
