import { redirect } from "next/navigation";
import { requireUser, esAdmin } from "@/lib/auth";
import { listSubUsuarios } from "@/lib/db";
import { publicUser } from "@/lib/auth";
import EquipoManager from "@/components/EquipoManager";

export const dynamic = "force-dynamic";

export default async function EquipoPage() {
  const user = await requireUser();
  if (!esAdmin(user)) redirect("/");
  const subs = (await listSubUsuarios(user.id)).map(publicUser);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Equipo del estudio</h1>
        <p className="text-sm text-slate-500">
          Crea cuentas para tus trabajadores. Ellos verán las mismas empresas, podrán
          extraer de SUNAT, subir declaraciones y poner plazos/comentarios — pero{" "}
          <b>no pueden crear/eliminar empresas ni editar el API</b>.
        </p>
      </div>
      <EquipoManager inicial={subs} adminNombre={user.nombre} />
    </div>
  );
}
