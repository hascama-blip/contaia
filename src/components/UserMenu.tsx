"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function UserMenu({ nombre }: { nombre: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function salir() {
    setBusy(true);
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  const iniciales = nombre
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="ml-2 flex items-center gap-2 border-l border-slate-200 pl-3">
      <span className="grid h-7 w-7 place-items-center rounded-full bg-brand-100 text-xs font-bold text-brand-700">
        {iniciales || "U"}
      </span>
      <span className="hidden text-sm text-slate-600 sm:inline">{nombre}</span>
      <button
        onClick={salir}
        disabled={busy}
        className="rounded-lg px-2 py-1 text-sm text-slate-500 hover:bg-slate-100"
        title="Cerrar sesión"
      >
        {busy ? "…" : "Salir"}
      </button>
    </div>
  );
}
