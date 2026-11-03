import Link from "next/link";
import { redirect } from "next/navigation";
import { listClientes } from "@/lib/db";
import { requireUser, esSupremo, studioId, modulosDelEstudio } from "@/lib/auth";
import ComprobantesXmlTool from "@/components/ComprobantesXmlTool";

export const dynamic = "force-dynamic";
export const metadata = { title: "Descarga masiva de comprobantes — Radar Tributario" };

// Descarga masiva de comprobantes: en UNA pantalla, las FACTURAS (XML / PDF
// oficial, desde una relación o el SIRE) y los RECIBOS POR HONORARIOS (RxH, por
// mes completo). Cada pestaña usa el mecanismo que ya existía en la web.
export default async function Page() {
  const user = await requireUser();
  const mods = await modulosDelEstudio(user);
  if (!esSupremo(user) && !mods.has("comprobantes-xml") && !mods.has("honorarios")) redirect("/");
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
        <h1 className="mt-1 text-2xl font-bold text-slate-800">Descarga masiva de comprobantes</h1>
        <p className="text-sm text-slate-500">
          Elige la empresa y carga su Clave SOL una sola vez. Luego descarga en bloque las{" "}
          <strong>facturas</strong> recibidas (XML o PDF oficial, con el Excel de detalle) o los{" "}
          <strong>recibos por honorarios</strong> (RxH) por mes completo.
        </p>
      </div>
      <ComprobantesXmlTool clientes={min} />
    </div>
  );
}
