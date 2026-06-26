"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSolPass, setSolPass } from "@/lib/solSession";

// Barra ÚNICA de accesos SOL para todo el cliente. El Usuario SOL se guarda
// (queda bloqueado); la Clave SOL se guarda solo en la SESIÓN del navegador
// (nunca en BD) y los módulos la toman de ahí. Así no se pide en cada módulo.
export default function AccesosSol({
  clienteId,
  solUserGuardado,
}: {
  clienteId: string;
  solUserGuardado: string;
}) {
  const router = useRouter();
  const [solUser, setSolUser] = useState(solUserGuardado);
  const [solPass, setSolPassState] = useState("");
  const [cargada, setCargada] = useState(false); // ¿la clave ya está en sesión?
  const [editar, setEditar] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const p = getSolPass(clienteId);
    setSolPassState(p);
    setCargada(Boolean(p));
  }, [clienteId]);

  const usuarioGuardado = Boolean(solUserGuardado);
  const todoListo = usuarioGuardado && cargada && !editar;

  async function guardar() {
    setError(null);
    if (!solUser.trim()) { setError("Ingresa el Usuario SOL."); return; }
    if (!solPass.trim()) { setError("Ingresa la Clave SOL."); return; }
    setBusy(true);
    try {
      // Guarda el Usuario SOL (la API se mantiene). La Clave NO va a la BD.
      if (solUser.trim() !== solUserGuardado) {
        const res = await fetch(`/api/clientes/${clienteId}/credenciales`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ solUser }),
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          setError(d.error ?? "No se pudo guardar el usuario.");
          return;
        }
      }
      setSolPass(clienteId, solPass); // clave -> solo sesión
      setCargada(true);
      setEditar(false);
      router.refresh();
    } catch {
      setError("Error de red al guardar los accesos.");
    } finally {
      setBusy(false);
    }
  }

  function cambiar() {
    setEditar(true);
    setCargada(false);
  }

  if (todoListo) {
    return (
      <section className="card flex flex-wrap items-center justify-between gap-2 border-emerald-200 bg-emerald-50/60 p-4">
        <div className="text-sm text-emerald-800">
          🔒 <b>Accesos SOL cargados</b> — Usuario <b>{solUserGuardado}</b> · Clave <b>••••••</b> (en sesión).
          Los módulos los usan automáticamente, no se piden de nuevo.
        </div>
        <button className="btn-ghost" onClick={cambiar}>Cambiar</button>
      </section>
    );
  }

  return (
    <section className="card border-brand-200 bg-brand-50/40 p-4">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="font-semibold text-slate-800">Accesos SOL del cliente</h2>
        <span className="badge bg-slate-100 text-slate-500">se piden 1 vez</span>
      </div>
      <p className="mb-3 text-xs text-slate-500">
        Coloca el <b>Usuario</b> y la <b>Clave SOL</b> una sola vez. Quedan cargados para
        <b> todos los módulos</b> (buzón, SIRE, deudas) sin volver a pedirlos.
        La Clave SOL <b>no se guarda</b>: vive solo en esta sesión del navegador.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">
            Usuario SOL {usuarioGuardado && <span className="ml-1 text-xs font-normal text-emerald-600">🔒 guardado</span>}
          </label>
          <input
            className={`input ${usuarioGuardado && !editar ? "cursor-not-allowed bg-slate-100 text-slate-500" : ""}`}
            value={solUser}
            onChange={(e) => setSolUser(e.target.value)}
            readOnly={usuarioGuardado && !editar}
            autoComplete="off"
          />
        </div>
        <div>
          <label className="label">Clave SOL</label>
          <input
            className="input"
            type="password"
            value={solPass}
            onChange={(e) => setSolPassState(e.target.value)}
            placeholder="No se guarda (solo esta sesión)"
            autoComplete="new-password"
          />
        </div>
      </div>
      {error && <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
      <div className="mt-3">
        <button className="btn-primary" onClick={guardar} disabled={busy}>
          {busy ? "Guardando…" : "Cargar accesos"}
        </button>
      </div>
    </section>
  );
}
