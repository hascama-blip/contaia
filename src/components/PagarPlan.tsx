"use client";

import { useRouter } from "next/navigation";
import CheckoutModal from "./CheckoutModal";

// Página /pagar?plan=…: abre directamente la ventana flotante de pago (llegan
// aquí los enlaces de "Renovar" de las alertas y notificaciones). Al cerrarla,
// vuelve a la página de planes.
export default function PagarPlan({ plan, whatsapp }: { plan: "regular" | "premium"; whatsapp: string }) {
  const router = useRouter();
  return <CheckoutModal plan={plan} abierto onCerrar={() => router.push("/planes")} whatsapp={whatsapp} />;
}
