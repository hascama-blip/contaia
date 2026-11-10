"use client";

import { useEffect, useState } from "react";
import { borrarClavesSol } from "@/lib/solSession";

// Todas las pestañas del navegador comparten UNA sola sesión. Si en otra pestaña
// se inicia sesión con otra cuenta (p. ej. Utilitarios RTP) o se cierra la sesión,
// esta pestaña seguiría mostrando la pantalla de la cuenta anterior mientras sus
// acciones ya van con la otra cuenta (cruce de usuarios). Este guardián lo detecta
// —al instante por localStorage y, por si acaso, al volver a la pestaña— y bloquea
// la pantalla hasta recargar con la cuenta actual.

export const CLAVE_SESION = "radar:sesion";

/** Avisar a las demás pestañas que la sesión cambió (login / logout). */
export function anunciarSesion(uid: string | null) {
  try { localStorage.setItem(CLAVE_SESION, JSON.stringify({ uid, at: Date.now() })); } catch { /* sin storage */ }
}

export default function SesionGuard({ uid }: { uid: string }) {
  const [cambio, setCambio] = useState<{ nombre: string | null } | null>(null);

  useEffect(() => {
    let vivo = true;
    const revisar = async () => {
      try {
        const r = await fetch("/api/auth/sesion", { cache: "no-store" });
        const d = await r.json();
        // La sesión ya es de otra cuenta (o se cerró): las Claves SOL de esta pestaña se borran.
        if (d.uid !== uid) borrarClavesSol();
        if (vivo && d.uid !== uid) setCambio({ nombre: d.nombre });
      } catch { /* sin red: no bloquea */ }
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key !== CLAVE_SESION || !e.newValue) return;
      try { const v = JSON.parse(e.newValue); if (v.uid !== uid) revisar(); } catch { revisar(); }
    };
    const onVisible = () => { if (document.visibilityState === "visible") revisar(); };
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      vivo = false;
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [uid]);

  if (!cambio) return null;
  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-slate-900/70 p-4 backdrop-blur-sm" role="alertdialog" aria-modal="true">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <h2 className="text-lg font-bold text-slate-800">La sesión cambió en otra pestaña</h2>
        <p className="mt-2 text-sm text-slate-600">
          {cambio.nombre
            ? <>En otra pestaña se inició sesión como <b>{cambio.nombre}</b>. </>
            : <>En otra pestaña se cerró la sesión. </>}
          Esta pantalla era de otra cuenta y ya no es válida: el navegador usa una sola sesión para todas las pestañas.
        </p>
        <p className="mt-2 text-xs text-slate-500">
          Para trabajar con dos cuentas a la vez, usa otro perfil del navegador o una ventana de incógnito para la segunda cuenta.
        </p>
        <button className="btn-primary mt-4 w-full" onClick={() => window.location.replace(cambio.nombre ? "/" : "/login")}>
          {cambio.nombre ? `Continuar como ${cambio.nombre}` : "Ir al inicio de sesión"}
        </button>
      </div>
    </div>
  );
}
