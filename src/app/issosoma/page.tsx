import { redirect } from "next/navigation";
import IssosomaDashboard from "@/components/IssosomaDashboard";
import { getCurrentUser } from "@/lib/auth";
import { puedeVerIssosoma } from "@/lib/acceso";

export const dynamic = "force-dynamic";
export const metadata = { title: "ISSOSOMA" };

// Página INDEPENDIENTE (pantalla completa, sin el chrome de Radar). Requiere
// sesión (lo protege el middleware). El dashboard lee /api/issosoma.
// Solo el supremo y los correos listados en ISSOSOMA_EMAILS.
export default async function Page() {
  if (!puedeVerIssosoma(await getCurrentUser())) redirect("/");
  return <IssosomaDashboard />;
}
