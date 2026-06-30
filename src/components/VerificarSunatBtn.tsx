"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Verifica en SUNAT todos los clientes "por verificar". Llama al endpoint por
// lotes hasta terminar y refresca la lista.
export default function VerificarSunatBtn({ pendientes }: { pendientes: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [progreso, setProgreso] = useState<string | null>(null);

  if (pendientes <= 0) return null;

  async function verificar() {
    setBusy(true);
    setProgreso("Verificando en SUNAT…");
    let hechos = 0;
    let errores = 0;
    try {
      // Repite hasta que no queden o un lote no avance (todo error).
      for (let i = 0; i < 50; i++) {
        const res = await fetch("/api/clientes/verificar", { method: "POST" });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) { setProgreso(d.error ?? "No se pudo verificar."); break; }
        hechos += d.verificados ?? 0;
        errores += d.errores ?? 0;
        setProgreso(`Verificando… ${hechos} listas${(d.restantes ?? 0) > 0 ? `, faltan ${d.restantes}` : ""}`);
        router.refresh();
        if ((d.restantes ?? 0) <= 0) break;
        if ((d.verificados ?? 0) === 0) { setProgreso(`Quedaron ${d.restantes} sin verificar (reintenta en unos minutos).`); break; }
      }
      if (errores === 0 && hechos > 0) setProgreso(`✅ ${hechos} empresa(s) verificada(s).`);
      else if (hechos > 0) setProgreso(`✅ ${hechos} verificada(s) · ⚠ ${errores} con error.`);
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button className="btn-ghost" onClick={verificar} disabled={busy}>
        {busy ? "Verificando…" : `🔄 Verificar SUNAT (${pendientes})`}
      </button>
      {progreso && <span className="text-xs text-slate-500">{progreso}</span>}
    </div>
  );
}
