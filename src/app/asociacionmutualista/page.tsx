import { getAsociacion } from "@/lib/db";
import { edicionHabilitada } from "@/lib/asociacion";
import AsociacionSitio from "@/components/AsociacionSitio";

export const dynamic = "force-dynamic";
export const metadata = { title: "Asociación Mutualista" };

export default async function Page() {
  const contenido = await getAsociacion();
  return <AsociacionSitio inicial={contenido} habilitada={edicionHabilitada()} />;
}
