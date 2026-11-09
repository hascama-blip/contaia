import { redirect } from "next/navigation";
import { requireUser, esSupremo, esAdmin } from "@/lib/auth";
import DemoSupremo from "@/components/DemoSupremo";

export const dynamic = "force-dynamic";
export const metadata = { title: "Modo simulación — Radar Tributario" };

// Modo simulación para las cuentas a las que el supremo se lo habilitó: empresas
// de simulación (datos ficticios en todos los módulos) + modo grabación.
export default async function SimulacionPage() {
  const u = await requireUser();
  if (esSupremo(u)) redirect("/supremo");
  if (!u.permisoDemo || !esAdmin(u)) redirect("/");
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Modo simulación</h1>
        <p className="text-sm text-slate-500">Empresas ficticias con información en todos los módulos, para demostraciones y videos.</p>
      </div>
      <DemoSupremo supremo={false} />
    </div>
  );
}
