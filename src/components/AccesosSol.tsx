"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSolPass, setSolPass } from "@/lib/solSession";

// Barra ÚNICA de accesos del cliente. El Usuario SOL y (para clientes con SIRE)
// el API client_id/secret se guardan (quedan bloqueados); la Clave SOL se guarda
// solo en la SESIÓN del navegador (nunca en BD) y los módulos la toman de ahí.
export default function AccesosSol({
  clienteId,
  solUserGuardado,
  llevaSire,
  inicialCred,
}: {
  clienteId: string;
  solUserGuardado: string;
  llevaSire?: boolean;
  inicialCred?: { clientId: string; clientSecret: string } | null;
}) {
  const router = useRouter();
  const [solUser, setSolUser] = useState(solUserGuardado);
  const [solPass, setSolPassState] = useState("");
  const [cid, setCid] = useState(inicialCred?.clientId ?? "");
  const [csec, setCsec] = useState(inicialCred?.clientSecret ?? "");
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
  const apiGuardada = Boolean(inicialCred?.clientId && inicialCred?.clientSecret);
  // Para clientes con SIRE, "todo listo" incluye tener el API guardado.
  const todoListo = usuarioGuardado && cargada && !editar && (!llevaSire || apiGuardada);

  async function guardar() {
    setError(null);
    if (!solUser.trim()) { setError("Ingresa el Usuario SOL."); return; }
    if (!solPass.trim()) { setError("Ingresa la Clave SOL."); return; }
    setBusy(true);
    try {
      // Guarda Usuario SOL + (si aplica) API client_id/secret. La Clave NO va a BD.
      const body: Record<string, string> = {};
      if (solUser.trim() !== solUserGuardado) body.solUser = solUser.trim();
      if (llevaSire && cid.trim() && csec.trim()) { body.clientId = cid.trim(); body.clientSecret = csec.trim(); }
      if (Object.keys(body).length) {
        const res = await fetch(`/api/clientes/${clienteId}/credenciales`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          setError(d.error ?? "No se pudieron guardar los accesos.");
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
          🔒 <b>Accesos cargados</b> — Usuario <b>{solUserGuardado}</b> · Clave <b>••••••</b> (en sesión)
          {llevaSire && <> · API SIRE <b>✓</b></>}. Los módulos los usan automáticamente.
        </div>
        <button className="btn-ghost" onClick={cambiar}>Cambiar</button>
      </section>
    );
  }

  return (
    <section className="card border-brand-200 bg-brand-50/40 p-4">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="font-semibold text-slate-800">Accesos del cliente</h2>
        <span className="badge bg-slate-100 text-slate-500">se piden 1 vez</span>
      </div>
      <p className="mb-3 text-xs text-slate-500">
        Coloca el <b>Usuario</b> y la <b>Clave SOL</b> una sola vez. Quedan cargados para
        <b> todos los módulos</b> (buzón, deudas{llevaSire ? ", SIRE" : ""}) sin volver a pedirlos.
        La Clave SOL <b>no se guarda</b>: vive solo en esta sesión del navegador.
        {llevaSire && <> El <b>API SIRE</b> (client_id/secret) sí se guarda para extraer compras/ventas y el estado.</>}
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
        {llevaSire && (
          <>
            <div>
              <label className="label">
                API SIRE · client_id {apiGuardada && <span className="ml-1 text-xs font-normal text-emerald-600">🔒 guardado</span>}
              </label>
              <input
                className="input"
                value={cid}
                onChange={(e) => setCid(e.target.value)}
                placeholder="client_id de la app SIRE"
                autoComplete="off"
              />
            </div>
            <div>
              <label className="label">API SIRE · client_secret</label>
              <input
                className="input"
                type="password"
                value={csec}
                onChange={(e) => setCsec(e.target.value)}
                placeholder="client_secret"
                autoComplete="new-password"
              />
            </div>
          </>
        )}
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
