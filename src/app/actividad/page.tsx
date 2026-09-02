import { redirect } from "next/navigation";
import Link from "next/link";
import { requireUser, esAdmin, esSupremo, studioId, planDelEstudio , bloquearSiSoloRtp} from "@/lib/auth";
import { listarAcciones } from "@/lib/db";
import ActividadView from "@/components/ActividadView";

export const dynamic = "force-dynamic";

// Bitácora del estudio: quién hizo qué, cuándo y en qué sección. Solo el líder.
export default async function ActividadPage() {
  const user = await requireUser();
  bloquearSiSoloRtp(user);
  if (!esAdmin(user)) redirect("/");

  // La actividad del equipo es exclusiva del Plan de Equipo (como el módulo Equipo).
  if (!esSupremo(user) && (await planDelEstudio(user)) !== "equipo") {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <h1 className="text-2xl font-bold text-slate-800">Historial de actividad</h1>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
          <p className="font-semibold">🔒 Disponible en el Plan de Equipo</p>
          <p className="mt-1">
            El historial de actividad del equipo (quién hizo qué y cuándo) se habilita con el
            <b> Plan de Equipo</b>, junto con la gestión de operarios.
          </p>
          <Link href="/planes" className="btn-primary mt-4 inline-flex">Ver Plan de Equipo →</Link>
        </div>
      </div>
    );
  }

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
