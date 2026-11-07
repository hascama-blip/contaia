"use client";

import { useState } from "react";
import CheckoutModal from "./CheckoutModal";

// Botón de los planes: abre la ventana flotante de pago ahí mismo (sin cambiar
// de página).
export default function BotonPagar({
  plan, texto, className, whatsapp,
}: { plan: "regular" | "premium"; texto: string; className: string; whatsapp?: string }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setAbierto(true)}>{texto}</button>
      {abierto && <CheckoutModal plan={plan} abierto={abierto} onCerrar={() => setAbierto(false)} whatsapp={whatsapp} />}
    </>
  );
}
