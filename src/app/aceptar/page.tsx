import { rutaInterna } from "@/lib/rutaInterna";
import { redirect } from "next/navigation";
import { getCurrentUser, versionTerminos } from "@/lib/auth";
import { TERMINOS_VERSION } from "@/lib/legal";
import AceptarPoliticas from "@/components/AceptarPoliticas";

export const dynamic = "force-dynamic";

// Pantalla obligatoria para usuarios que aún no aceptaron la versión vigente
// de las políticas (el middleware los trae aquí).
export default async function AceptarPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const sp = await searchParams;
  const nextOk = rutaInterna(sp.next);
  const next = nextOk.startsWith("/aceptar") ? "/" : nextOk;
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);
  // Ya la aceptó (en otro equipo) o está exento: solo renueva la sesión.
  if (versionTerminos(user) === TERMINOS_VERSION) redirect(`/api/legal/sesion?next=${encodeURIComponent(next)}`);
  const anterior = (user.aceptaciones ?? []).length > 0;
  return <AceptarPoliticas nombre={user.nombre} next={next} actualizacion={anterior} />;
}
