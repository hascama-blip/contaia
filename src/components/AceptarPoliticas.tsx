"use client";

import { useState } from "react";
import { LogoAsenco } from "@/components/Logo";
import CasillasPoliticas from "@/components/CasillasPoliticas";

export default function AceptarPoliticas({ nombre, next, actualizacion }: { nombre: string; next: string; actualizacion: boolean }) {
  const [seguridad, setSeguridad] = useState(false);
  const [responsabilidad, setResponsabilidad] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function aceptar(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/legal/aceptar", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aceptaSeguridad: seguridad, aceptaResponsabilidad: responsabilidad }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? "No se pudo registrar la aceptación."); return; }
      window.location.assign(next); // carga completa: el layout lee la sesión nueva
    } catch {
      setError("Sin conexión. Inténtalo de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  async function salir() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    window.location.assign("/login");
  }

  return (
    <div className="mx-auto mt-10 max-w-md">
      <div className="mb-6 flex justify-center"><LogoAsenco /></div>
      <form onSubmit={aceptar} className="card space-y-4 p-6">
        <div>
          <h1 className="text-xl font-bold text-slate-800">{actualizacion ? "Actualizamos nuestras políticas" : "Antes de continuar"}</h1>
          <p className="mt-1 text-sm text-slate-500">
            Hola, {nombre}. Para seguir usando la plataforma necesitamos que leas y aceptes la Política de seguridad y la
            Declaración de responsabilidad. Quedará constancia de tu aceptación con fecha, hora e IP.
          </p>
        </div>
        <CasillasPoliticas seguridad={seguridad} responsabilidad={responsabilidad} onSeguridad={setSeguridad} onResponsabilidad={setResponsabilidad} />
        {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
        <button type="submit" className="btn-primary w-full" disabled={busy || !seguridad || !responsabilidad}>
          {busy ? "Un momento…" : "Aceptar y continuar"}
        </button>
        <button type="button" onClick={salir} className="w-full text-center text-sm text-slate-500 hover:text-slate-700">No acepto · cerrar sesión</button>
      </form>
    </div>
  );
}
