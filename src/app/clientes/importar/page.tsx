import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser, esAdmin } from "@/lib/auth";
import ImportarClientes from "@/components/ImportarClientes";

export const dynamic = "force-dynamic";

export default async function ImportarPage() {
  const user = await requireUser();
  if (!esAdmin(user)) redirect("/clientes");

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/clientes" className="text-sm text-brand-600 hover:underline">← Clientes</Link>
          <h1 className="mt-1 text-2xl font-bold text-slate-800">Importar empresas</h1>
        </div>
      </div>
      <ImportarClientes />
    </div>
  );
}
