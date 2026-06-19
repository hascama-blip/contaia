import { notFound } from "next/navigation";
import { getClienteDeUsuario } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import ClienteDetail from "@/components/ClienteDetail";

export const dynamic = "force-dynamic";

export default async function ClientePage({ params }: { params: { id: string } }) {
  const user = await requireUser();
  const cliente = await getClienteDeUsuario(params.id, user.id);
  if (!cliente) notFound();
  return <ClienteDetail inicial={cliente} />;
}
