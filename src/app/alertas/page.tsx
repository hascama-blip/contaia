import Link from "next/link";
import { requireUser } from "@/lib/auth";
import AlertasConfig from "@/components/AlertasConfig";

export const dynamic = "force-dynamic";
export const metadata = { title: "Alertas — Radar Tributario" };

export default async function Page() {
  await requireUser();
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <Link href="/" className="text-sm text-brand-600 hover:underline">← Menú</Link>
        <h1 className="mt-1 text-2xl font-bold text-slate-800">Alertas al celular</h1>
        <p className="text-sm text-slate-500">
          Recibe en Telegram o por correo las notificaciones SUNAT de tus empresas, los vencimientos
          de declaración y los avisos de tu plan.
        </p>
      </div>
      <AlertasConfig />
    </div>
  );
}
