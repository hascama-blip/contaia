import IssosomaDashboard from "@/components/IssosomaDashboard";

export const dynamic = "force-dynamic";
export const metadata = { title: "ISSOSOMA" };

// Página INDEPENDIENTE (pantalla completa, sin el chrome de Radar). Requiere
// sesión (lo protege el middleware). El dashboard lee /api/issosoma.
export default function Page() {
  return <IssosomaDashboard />;
}
