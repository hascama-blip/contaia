import { requireSupremo, ensureSupremo } from "@/lib/auth";
import SupremoPanel from "@/components/SupremoPanel";

export const dynamic = "force-dynamic";

// Panel del usuario supremo (dueño de la plataforma): aprueba o rechaza las
// solicitudes de acceso de los estudios.
export default async function SupremoPage() {
  await ensureSupremo();
  await requireSupremo();

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Solicitudes de acceso</h1>
        <p className="text-sm text-slate-500">
          Personas que pidieron usar la plataforma. <b>Aprueba</b> para habilitar su ingreso
          o <b>rechaza</b> para denegarlo. Cada estudio aprobado gestiona sus propias empresas y su equipo.
        </p>
      </div>
      <SupremoPanel />
    </div>
  );
}
