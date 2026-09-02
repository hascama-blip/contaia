"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// Botón de cerrar sesión (para el header mínimo del usuario "solo RTP").
export default function SalirBtn() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function salir() {
    setBusy(true);
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }
  return (
    <button onClick={salir} disabled={busy} className="rounded-lg px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100" title="Cerrar sesión">
      {busy ? "…" : "Salir"}
    </button>
  );
}
