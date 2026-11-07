import Link from "next/link";
import { requireUser } from "@/lib/auth";
import AlertasConfig from "@/components/AlertasConfig";

export const dynamic = "force-dynamic";
export const metadata = { title: "Alertas — Radar Tributario" };

export default async function Page() {
  await requireUser();
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <Link href="/" className="text-sm text-slate-500 hover:text-brand-700">← Menú</Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">Alertas</h1>
        <p className="mt-1 text-sm text-slate-500">
          Elige por dónde recibir las notificaciones SUNAT de tus empresas, los vencimientos de
          declaración y los avisos de tu plan.
        </p>
      </div>
      <AlertasConfig />
    </div>
  );
}
