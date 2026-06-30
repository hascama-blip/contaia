"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LogoAsenco } from "@/components/Logo";

export default function ResetPage() {
  const router = useRouter();
  const params = useSearchParams();
  const uid = params.get("uid") ?? "";
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== password2) { setError("Las contraseñas no coinciden."); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/auth/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid, token, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? "No se pudo cambiar la contraseña."); return; }
      setOk(true);
      setTimeout(() => router.replace("/login"), 1800);
    } finally { setBusy(false); }
  }

  return (
    <div className="mx-auto mt-10 max-w-sm">
      <div className="mb-6 flex justify-center"><LogoAsenco /></div>
      <div className="card p-6">
        <h1 className="text-xl font-bold text-slate-800">Cambiar contraseña</h1>
        {!uid || !token ? (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
            Enlace inválido o incompleto. Solicita uno nuevo desde “Olvidé mi contraseña”.
          </p>
        ) : ok ? (
          <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            ✅ Contraseña actualizada. Redirigiendo al inicio de sesión…
          </p>
        ) : (
          <>
            <p className="mt-1 text-sm text-slate-500">Escribe tu nueva contraseña.</p>
            {error && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
            <form onSubmit={enviar} className="mt-4 space-y-3">
              <div>
                <label className="text-xs font-semibold text-slate-600">Nueva contraseña</label>
                <input type="password" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
                  value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-600">Repetir contraseña</label>
                <input type="password" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
                  value={password2} onChange={(e) => setPassword2(e.target.value)} autoComplete="new-password" required />
              </div>
              <button type="submit" className="btn-primary w-full" disabled={busy}>
                {busy ? "Guardando…" : "Cambiar contraseña"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
