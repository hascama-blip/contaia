"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LogoAsenco } from "@/components/Logo";

export default function LoginPage() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/";
  const [modo, setModo] = useState<"login" | "registro" | "olvido">("login");
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setAviso(null);
    try {
      // "Olvidé mi contraseña": pide el enlace por correo.
      if (modo === "olvido") {
        const res = await fetch("/api/auth/forgot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { setError(data.error ?? "No se pudo enviar el enlace."); return; }
        setModo("login");
        setAviso(data.mensaje ?? "Si el correo está registrado, te enviamos un enlace para cambiar la contraseña.");
        return;
      }
      const url = modo === "login" ? "/api/auth/login" : "/api/auth/register";
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre, email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "No se pudo continuar.");
        return;
      }
      // El registro NO inicia sesión: queda pendiente de aprobación del supremo.
      if (modo === "registro" && data.pendiente) {
        setModo("login");
        setPassword("");
        setAviso(data.mensaje ?? "Tu solicitud de acceso fue enviada. Espera la aprobación.");
        return;
      }
      router.replace(next);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto mt-10 max-w-sm">
      <div className="mb-6 flex justify-center">
        <LogoAsenco />
      </div>
      <div className="card p-6">
        <h1 className="text-xl font-bold text-slate-800">
          {modo === "login" ? "Iniciar sesión" : modo === "registro" ? "Solicitar acceso" : "Recuperar contraseña"}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {modo === "login"
            ? "Entra a tu espacio de trabajo."
            : modo === "registro"
              ? "Solicita acceso: un administrador revisará tu pedido y te habilitará el ingreso."
              : "Pon tu correo y te enviaremos un enlace para crear una nueva contraseña."}
        </p>

        {aviso && (
          <div className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{aviso}</div>
        )}
        {error && (
          <div className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>
        )}

        <form onSubmit={enviar} className="mt-4 space-y-3">
          {modo === "registro" && (
            <div>
              <label className="text-xs font-semibold text-slate-600">Nombre</label>
              <input
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                autoComplete="name"
                required
              />
            </div>
          )}
          <div>
            <label className="text-xs font-semibold text-slate-600">Correo</label>
            <input
              type="email"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </div>
          {modo !== "olvido" && (
            <div>
              <label className="text-xs font-semibold text-slate-600">Contraseña</label>
              <input
                type="password"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={modo === "login" ? "current-password" : "new-password"}
                required
              />
            </div>
          )}
          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy ? "Un momento…" : modo === "login" ? "Entrar" : modo === "registro" ? "Solicitar acceso" : "Enviar enlace"}
          </button>
        </form>

        {modo === "login" && (
          <div className="mt-3 text-center">
            <button className="text-sm text-brand-600 hover:underline" onClick={() => { setModo("olvido"); setError(null); setAviso(null); }}>
              ¿Olvidaste tu contraseña?
            </button>
          </div>
        )}

        <div className="mt-4 text-center text-sm text-slate-500">
          {modo === "login" ? (
            <>
              ¿No tienes cuenta?{" "}
              <button className="font-semibold text-brand-600 hover:underline" onClick={() => { setModo("registro"); setError(null); setAviso(null); }}>
                Solicitar acceso
              </button>
            </>
          ) : (
            <>
              ¿Ya tienes cuenta?{" "}
              <button className="font-semibold text-brand-600 hover:underline" onClick={() => { setModo("login"); setError(null); setAviso(null); }}>
                Iniciar sesión
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
