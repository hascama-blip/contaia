import Landing from "@/components/Landing";

export const dynamic = "force-dynamic";
export const metadata = { title: "Conoce Radar Tributar IA" };

// Portada pública (presentación de la plataforma). La raíz del dominio abre
// directo en el login; esta página queda para compartirla cuando se quiera.
export default function Page() {
  return <Landing />;
}
