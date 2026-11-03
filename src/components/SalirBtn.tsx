"use client";

import { useState } from "react";

// Botón de cerrar sesión (para el header mínimo del usuario "solo RTP").
export default function SalirBtn() {
  const [busy, setBusy] = useState(false);
  async function salir() {
    setBusy(true);
    try { await fetch("/api/auth/logout", { method: "POST" }); } catch { /* */ }
    try { localStorage.removeItem("mostrar_planes"); } catch { /* */ }
    // Navegación COMPLETA (no suave): así el layout del servidor relee las
    // cookies y no queda el header de la sesión anterior sobre el login.
    window.location.replace("/login");
  }
  return (
    <button onClick={salir} disabled={busy} className="rounded-lg px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100" title="Cerrar sesión">
      {busy ? "…" : "Salir"}
    </button>
  );
}
