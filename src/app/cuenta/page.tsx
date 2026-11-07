"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Cambio de contraseña del usuario logueado (exige la clave actual).
export default function CuentaPage() {
  const router = useRouter();
  const [actual, setActual] = useState("");
  const [nueva, setNueva] = useState("");
  const [repetir, setRepetir] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setOk(null);
    if (nueva !== repetir) { setError("La nueva contraseña y su repetición no coinciden."); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/auth/cambiar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ actual, nueva }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? "No se pudo cambiar la contraseña."); return; }
      setOk(data.mensaje ?? "Contraseña actualizada.");
      setActual(""); setNueva(""); setRepetir("");
      setTimeout(() => router.push("/"), 1500);
    } catch { setError("Error de red."); }
    finally { setBusy(false); }
  }

  const input = "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500";
  return (
    <div className="mx-auto mt-6 max-w-sm">
      <div className="card p-6">
        <h1 className="text-xl font-bold text-slate-800">Cambiar contraseña</h1>
        <p className="mt-1 text-sm text-slate-500">Por seguridad, confirma tu contraseña actual.</p>
        {ok && <div className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{ok}</div>}
        {error && <div className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
        <form onSubmit={enviar} className="mt-4 space-y-3">
          <div><label className="text-xs font-semibold text-slate-600">Contraseña actual</label>
            <input type="password" className={input} value={actual} onChange={(e) => setActual(e.target.value)} autoComplete="current-password" required /></div>
          <div><label className="text-xs font-semibold text-slate-600">Nueva contraseña</label>
            <input type="password" className={input} value={nueva} onChange={(e) => setNueva(e.target.value)} autoComplete="new-password" minLength={8} required /></div>
          <div><label className="text-xs font-semibold text-slate-600">Repetir nueva contraseña</label>
            <input type="password" className={input} value={repetir} onChange={(e) => setRepetir(e.target.value)} autoComplete="new-password" minLength={8} required /></div>
          <button type="submit" className="btn-primary w-full" disabled={busy}>{busy ? "Guardando…" : "Guardar nueva contraseña"}</button>
        </form>
      </div>
    </div>
  );
}
