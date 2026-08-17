import Link from "next/link";
import { listClientes } from "@/lib/db";
import { requireUser, studioId, modulosDelEstudio } from "@/lib/auth";
import ConsultasFlow from "@/components/ConsultasFlow";
import DeudasF36Flow from "@/components/DeudasF36Flow";
import CuartaCategoriaFlow from "@/components/CuartaCategoriaFlow";
import { ModuloBloqueado } from "@/components/ModuloBloqueado";
import { esPersonaNatural } from "@/lib/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "Consultas tributarias — Radar Tributario" };

export default async function Page() {
  const user = await requireUser();
  const mods = await modulosDelEstudio(user);
  if (!mods.has("consultas")) return <ModuloBloqueado nombre="Consultas tributarias" />;
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
      {/* Cuarta Categoría (consulta mensual): solo persona natural (RUC 10/15). */}
      {lista.some((c) => esPersonaNatural(c.ruc)) && (
        <>
          <hr className="border-slate-200" />
          <CuartaCategoriaFlow clientes={lista.filter((c) => esPersonaNatural(c.ruc))} />
        </>
      )}
    </div>
  );
}
