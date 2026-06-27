import { notFound } from "next/navigation";
import { getClienteDeUsuario } from "@/lib/db";
import { requireUser, studioId, esAdmin, esSupremo } from "@/lib/auth";
import ClienteDetail from "@/components/ClienteDetail";

export const dynamic = "force-dynamic";

export default async function ClientePage({ params }: { params: { id: string } }) {
  const user = await requireUser();
  const cliente = await getClienteDeUsuario(params.id, studioId(user));
  if (!cliente) notFound();
  // Eliminar empresa: solo el líder del estudio (admin) o el supremo.
  const puedeEliminar = esAdmin(user) || esSupremo(user);
  return <ClienteDetail inicial={cliente} puedeApi={esAdmin(user)} puedeEliminar={puedeEliminar} />;
}
