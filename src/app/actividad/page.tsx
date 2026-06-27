import { redirect } from "next/navigation";
import { requireUser, esAdmin, studioId } from "@/lib/auth";
import { listarAcciones } from "@/lib/db";
import ActividadView from "@/components/ActividadView";

export const dynamic = "force-dynamic";

// Bitácora del estudio: quién hizo qué, cuándo y en qué sección. Solo el líder.
export default async function ActividadPage() {
  const user = await requireUser();
  if (!esAdmin(user)) redirect("/");
  const acciones = await listarAcciones(studioId(user), { limite: 1000 });

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Historial de actividad</h1>
        <p className="text-sm text-slate-500">
          Todas las acciones de tu equipo: <b>quién</b>, <b>cuándo</b> y en <b>qué sección</b>.
          Filtra por trabajador o sección. Se muestran las 1000 más recientes.
        </p>
      </div>
      <ActividadView acciones={acciones} />
    </div>
  );
}
