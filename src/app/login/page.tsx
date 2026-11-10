"use client";

import { rutaInterna } from "@/lib/rutaInterna";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LogoAsenco } from "@/components/Logo";
import CasillasPoliticas from "@/components/CasillasPoliticas";
import { anunciarSesion } from "@/components/SesionGuard";

type Modo = "login" | "registro" | "verificar" | "olvido" | "olvido-codigo" | "acceso";

// Login / registro con verificación de correo por código de 6 dígitos /
// recuperación de contraseña autoservicio (código + nueva clave).
export default function LoginPage() {
  const router = useRouter();
  const params = useSearchParams();
  // Solo se vuelve a rutas INTERNAS ("/algo"). Un enlace con ?next=https://otro-sitio
  // o //otro-sitio llevaría a la persona fuera de Radar tras iniciar sesión (phishing).
  const next = rutaInterna(params.get("next"));
  const [modo, setModo] = useState<Modo>("login");
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [codigo, setCodigo] = useState("");
  const [aceptaSeguridad, setAceptaSeguridad] = useState(false);
  const [aceptaResponsabilidad, setAceptaResponsabilidad] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const cambiar = (m: Modo) => { setModo(m); setError(null); setAviso(null); setCodigo(""); };
  const post = async (url: string, body: any) => {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    return { res, data };
  };
  // Navegación COMPLETA (no la del router): así no queda en memoria ninguna página
  // de la cuenta anterior; y se avisa a las demás pestañas que la sesión cambió.
  const entrar = (uid?: string) => { anunciarSesion(uid ?? "nuevo"); window.location.assign(next); };

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setAviso(null);
    try {
      if (modo === "login" || modo === "acceso") {
        const { res, data } = await post("/api/auth/login", modo === "acceso" ? { email, password, codigo } : { email, password });
        if (res.status === 403 && data.noVerificado) { setModo("verificar"); setAviso(data.error); return; }
        if (data.requiereCodigo && !res.ok) {
          if (modo === "login") { setModo("acceso"); setCodigo(""); setAviso(data.mensaje ?? "Te enviamos un código de acceso."); return; }
          setError(data.error ?? data.mensaje ?? "Código incorrecto."); return;
        }
        if (!res.ok) { setError(data.error ?? "No se pudo ingresar."); return; }
        try { localStorage.setItem("mostrar_planes", "1"); } catch { /* */ }
        entrar(data.user?.id);
        return;
      }
      if (modo === "registro") {
        if (!aceptaSeguridad || !aceptaResponsabilidad) { setError("Para crear la cuenta debes aceptar ambas políticas."); return; }
        const { res, data } = await post("/api/auth/register", { nombre, email, password, aceptaSeguridad, aceptaResponsabilidad });
        if (!res.ok) { setError(data.error ?? "No se pudo crear la cuenta."); return; }
        if (data.verificar) { setModo("verificar"); setAviso(data.mensaje ?? "Te enviamos un código a tu correo."); return; }
        entrar(data.user?.id);
        return;
      }
      if (modo === "verificar") {
        const { res, data } = await post("/api/auth/verificar", { email, codigo, password });
        if (!res.ok) { setError(data.error ?? "Código incorrecto."); return; }
        if (data.yaVerificado) { cambiar("login"); setAviso(data.mensaje); return; }
        try { localStorage.setItem("mostrar_planes", "1"); } catch { /* */ }
        entrar(data.user?.id);
        return;
      }
      if (modo === "olvido") {
        const { res, data } = await post("/api/auth/forgot", { email });
        if (!res.ok) { setError(data.error ?? "No se pudo enviar el código."); return; }
        setModo("olvido-codigo"); setPassword(""); setAviso(data.mensaje ?? "Te enviamos un código a tu correo.");
        return;
      }
      if (modo === "olvido-codigo") {
        const { res, data } = await post("/api/auth/reset", { email, codigo, password });
        if (!res.ok) { setError(data.error ?? "No se pudo cambiar la contraseña."); return; }
        cambiar("login"); setPassword(""); setAviso(data.mensaje ?? "Contraseña actualizada. Ya puedes iniciar sesión.");
        return;
      }
    } catch {
      setError("Error de red. Intenta de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  async function reenviar() {
    setBusy(true); setError(null); setAviso(null);
    try {
      if (modo === "acceso") {
        const { data } = await post("/api/auth/login", { email, password });
        if (data.requiereCodigo) setAviso(data.mensaje ?? "Te enviamos un nuevo código.");
        else if (data.error) setError(data.error);
        return;
      }
      const url = modo === "verificar" ? "/api/auth/reenviar" : "/api/auth/forgot";
      const { res, data } = await post(url, { email });
      if (!res.ok) { setError(data.error ?? "No se pudo reenviar."); return; }
      setAviso(data.mensaje ?? "Te enviamos un nuevo código.");
    } finally { setBusy(false); }
  }

  const titulo: Record<Modo, string> = {
    login: "Iniciar sesión", registro: "Crear cuenta", verificar: "Verifica tu correo",
    olvido: "Recuperar contraseña", "olvido-codigo": "Nueva contraseña", acceso: "Código de acceso",
  };
  const subtitulo: Record<Modo, string> = {
    login: "Entra a tu espacio de trabajo.",
    registro: "Crea tu cuenta; te enviaremos un código a tu correo para activarla.",
    verificar: `Ingresa el código de 6 dígitos que enviamos a ${email || "tu correo"}.`,
    olvido: "Pon tu correo y te enviaremos un código de 6 dígitos.",
    "olvido-codigo": `Ingresa el código que enviamos a ${email || "tu correo"} y tu nueva contraseña.`,
    acceso: `Por seguridad, ingresa el código de 6 dígitos que enviamos a ${email || "tu correo"}.`,
  };
  const input = "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500";

  return (
    <div className="mx-auto mt-10 max-w-sm">
      <div className="mb-6 flex justify-center"><LogoAsenco /></div>
      <div className="card p-6">
        <h1 className="text-xl font-bold text-slate-800">{titulo[modo]}</h1>
        <p className="mt-1 text-sm text-slate-500">{subtitulo[modo]}</p>

        {aviso && <div className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{aviso}</div>}
        {error && <div className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}

        <form onSubmit={enviar} className="mt-4 space-y-3">
          {modo === "registro" && (
            <div><label className="text-xs font-semibold text-slate-600">Nombre</label>
              <input className={input} value={nombre} onChange={(e) => setNombre(e.target.value)} autoComplete="name" required /></div>
          )}
          {(modo === "login" || modo === "registro" || modo === "olvido") && (
            <div><label className="text-xs font-semibold text-slate-600">Correo</label>
              <input type="email" className={input} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required /></div>
          )}
          {(modo === "verificar" || modo === "olvido-codigo" || modo === "acceso") && (
            <div><label className="text-xs font-semibold text-slate-600">Código de 6 dígitos</label>
              <input inputMode="numeric" pattern="[0-9]*" maxLength={6} className={`${input} text-center text-2xl tracking-[0.5em]`} value={codigo}
                onChange={(e) => setCodigo(e.target.value.replace(/\D/g, "").slice(0, 6))} autoComplete="one-time-code" autoFocus required /></div>
          )}
          {(modo === "login" || modo === "registro") && (
            <div><label className="text-xs font-semibold text-slate-600">Contraseña</label>
              <input type="password" className={input} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={modo === "login" ? "current-password" : "new-password"} required /></div>
          )}
          {modo === "registro" && (
            <CasillasPoliticas seguridad={aceptaSeguridad} responsabilidad={aceptaResponsabilidad}
              onSeguridad={setAceptaSeguridad} onResponsabilidad={setAceptaResponsabilidad} />
          )}
          {modo === "olvido-codigo" && (
            <div><label className="text-xs font-semibold text-slate-600">Nueva contraseña</label>
              <input type="password" className={input} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={8} required /></div>
          )}
          <button type="submit" className="btn-primary w-full" disabled={busy || (modo === "registro" && (!aceptaSeguridad || !aceptaResponsabilidad))}>
            {busy ? "Un momento…" : modo === "login" ? "Entrar" : modo === "registro" ? "Crear cuenta" : modo === "verificar" || modo === "acceso" ? "Verificar y entrar" : modo === "olvido" ? "Enviar código" : "Cambiar contraseña"}
          </button>
        </form>

        {(modo === "verificar" || modo === "olvido-codigo" || modo === "acceso") && (
          <div className="mt-3 text-center text-sm text-slate-500">
            ¿No llegó? Revisa spam o{" "}
            <button className="font-semibold text-brand-600 hover:underline" onClick={reenviar} disabled={busy}>reenviar código</button>
          </div>
        )}
        {modo === "login" && (
          <div className="mt-3 text-center">
            <button className="text-sm text-brand-600 hover:underline" onClick={() => cambiar("olvido")}>¿Olvidaste tu contraseña?</button>
          </div>
        )}

        <div className="mt-4 text-center text-sm text-slate-500">
          {modo === "login" ? (
            <>¿No tienes cuenta?{" "}<button className="font-semibold text-brand-600 hover:underline" onClick={() => cambiar("registro")}>Crear cuenta</button></>
          ) : (
            <>¿Ya tienes cuenta?{" "}<button className="font-semibold text-brand-600 hover:underline" onClick={() => cambiar("login")}>Iniciar sesión</button></>
          )}
        </div>
      </div>
    </div>
  );
}
