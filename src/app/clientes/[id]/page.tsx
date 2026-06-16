import { notFound } from "next/navigation";
import { getCliente } from "@/lib/db";
import ClienteDetail from "@/components/ClienteDetail";

export const dynamic = "force-dynamic";

export default async function ClientePage({ params }: { params: { id: string } }) {
  const cliente = await getCliente(params.id);
  if (!cliente) notFound();
  return <ClienteDetail inicial={cliente} />;
}
