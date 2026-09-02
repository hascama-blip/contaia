import { redirect } from "next/navigation";
import Link from "next/link";
import { requireUser, esAdmin, esSupremo, planDelEstudio , bloquearSiSoloRtp} from "@/lib/auth";
import { listSubUsuarios } from "@/lib/db";
import { publicUser } from "@/lib/auth";
import EquipoManager from "@/components/EquipoManager";

export const dynamic = "force-dynamic";

export default async function EquipoPage() {
  const user = await requireUser();
  bloquearSiSoloRtp(user);
  if (!esAdmin(user)) redirect("/");

  // El equipo (operarios) es exclusivo del Plan de Equipo.
  const plan = await planDelEstudio(user);
  const subs = (await listSubUsuarios(user.id)).map(publicUser);
  if (!esSupremo(user) && plan !== "equipo") {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <h1 className="text-2xl font-bold text-slate-800">Equipo del estudio</h1>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
          <p className="font-semibold">🔒 Disponible en el Plan de Equipo</p>
          <p className="mt-1">
            Con el <b>Plan de Equipo</b> agregas usuarios para tus trabajadores (jefe + operarios) y
            gestionan juntos todas las empresas a su cargo.
          </p>
          {subs.length > 0 && (
            <p className="mt-2 text-xs text-amber-700">
              Tienes {subs.length} operario(s) ya creado(s); se conservan y podrás gestionarlos al activar el plan.
            </p>
          )}
          <Link href="/planes" className="btn-primary mt-4 inline-flex">Ver Plan de Equipo →</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Equipo del estudio</h1>
        <p className="text-sm text-slate-500">
          Crea cuentas para tus trabajadores (hasta <b>4</b>). Ellos verán las mismas empresas, podrán
          extraer de SUNAT, subir declaraciones y poner plazos/comentarios — pero{" "}
          <b>no pueden crear/eliminar empresas ni editar el API</b>.
        </p>
      </div>
      <EquipoManager inicial={subs} adminNombre={user.nombre} limite={esSupremo(user) ? null : 4} />
    </div>
  );
}
