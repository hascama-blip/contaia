"use client";

import { useEffect, useState, useCallback, Fragment } from "react";

interface Solicitud {
  id: string;
  nombre: string;
  email: string;
  createdAt: string;
  estado?: "pendiente" | "aprobado" | "rechazado";
  decididoAt?: string;
  modulos?: string[];
  operadores?: number;
}

const MODULOS = [
  { key: "m2", label: "Mód. 2 · Comparativo SIRE" },
  { key: "m3", label: "Mód. 3 · Masivo Contasis" },
  { key: "m4", label: "Mód. 4 · Consultas tributarias" },
];

type Filtro = "pendiente" | "aprobado" | "rechazado" | "todas";

const BADGE: Record<string, { txt: string; cls: string }> = {
  pendiente: { txt: "⏳ Pendiente", cls: "bg-amber-100 text-amber-700" },
  aprobado: { txt: "✅ Aprobado", cls: "bg-emerald-100 text-emerald-700" },
  rechazado: { txt: "⛔ Rechazado", cls: "bg-red-100 text-red-700" },
};

function fmt(iso?: string) {
  if (!iso) return "";
  try { return new Date(iso).toLocaleString("es-PE", { dateStyle: "short", timeStyle: "short" }); } catch { return iso; }
}

export default function SupremoPanel() {
  const [filtro, setFiltro] = useState<Filtro>("pendiente");
  const [lista, setLista] = useState<Solicitud[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reseteando, setReseteando] = useState(false);
  // Detalle de operadores por cuenta (expandible).
  const [expandido, setExpandido] = useState<string | null>(null);
  const [opsDetalle, setOpsDetalle] = useState<Record<string, { id: string; nombre: string; email: string; createdAt: string }[]>>({});
  // Diagnóstico del navegador (Browserless).
  const [diag, setDiag] = useState<any>(null);
  const [diagBusy, setDiagBusy] = useState(false);
  const [wsUrl, setWsUrl] = useState("");
  // URL de Browserless guardada en la app (alternativa a la variable de Render).
  const [urlGuardada, setUrlGuardada] = useState<{ configurada: boolean; preview: string } | null>(null);
  const [guardarBusy, setGuardarBusy] = useState(false);
  const [guardarMsg, setGuardarMsg] = useState<string | null>(null);

  async function toggleOperadores(s: Solicitud) {
    if (expandido === s.id) { setExpandido(null); return; }
    setExpandido(s.id);
    if (!opsDetalle[s.id]) {
      try {
        const res = await fetch(`/api/supremo/operadores?adminId=${encodeURIComponent(s.id)}`);
        const data = await res.json().catch(() => ({}));
        if (res.ok) setOpsDetalle((p) => ({ ...p, [s.id]: data.operadores ?? [] }));
      } catch { /* */ }
    }
  }

  const cargar = useCallback(async () => {
    setCargando(true); setError(null);
    try {
      const qs = filtro === "todas" ? "" : `?estado=${filtro}`;
      const res = await fetch(`/api/supremo/solicitudes${qs}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? "No se pudo cargar."); return; }
      setLista(data.solicitudes ?? []);
    } catch {
      setError("Se cortó la conexión.");
    } finally { setCargando(false); }
  }, [filtro]);

  useEffect(() => { cargar(); }, [cargar]);

  // Carga si ya hay una URL de Browserless guardada en la app.
  useEffect(() => {
    fetch("/api/supremo/navegador-url")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setUrlGuardada({ configurada: d.configurada, preview: d.preview }))
      .catch(() => {});
  }, []);

  async function guardarUrl(valor?: string) {
    setGuardarBusy(true);
    setGuardarMsg(null);
    try {
      const res = await fetch("/api/supremo/navegador-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ws: valor !== undefined ? valor : wsUrl.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setGuardarMsg(data.error ?? "No se pudo guardar."); return; }
      setUrlGuardada({ configurada: data.configurada, preview: data.preview });
      setGuardarMsg(
        data.configurada
          ? "✅ URL guardada. Ahora prueba la conexión."
          : "🗑️ URL borrada: el buzón/F36 volverán a usar el navegador local (Render), que sí entra a SUNAT."
      );
      if (!data.configurada) setWsUrl("");
    } catch {
      setGuardarMsg("Error de red al guardar.");
    } finally {
      setGuardarBusy(false);
    }
  }

  async function decidir(s: Solicitud, estado: "aprobado" | "rechazado") {
    setBusy(s.id); setError(null);
    try {
      const res = await fetch("/api/supremo/solicitudes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: s.id, estado }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? "No se pudo actualizar."); return; }
      await cargar();
    } finally { setBusy(null); }
  }

  async function toggleModulo(s: Solicitud, key: string) {
    const actuales = new Set(s.modulos ?? []);
    if (actuales.has(key)) actuales.delete(key); else actuales.add(key);
    setBusy(s.id); setError(null);
    try {
      const res = await fetch("/api/supremo/solicitudes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: s.id, modulos: Array.from(actuales) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? "No se pudo actualizar los módulos."); return; }
      await cargar();
    } finally { setBusy(null); }
  }

  async function cambiarPassword(s: Solicitud) {
    const nueva = window.prompt(`Nueva contraseña para ${s.nombre} (${s.email}):`);
    if (nueva == null) return;
    if (nueva.length < 6) { setError("La contraseña debe tener al menos 6 caracteres."); return; }
    setBusy(s.id); setError(null);
    try {
      const res = await fetch("/api/supremo/solicitudes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: s.id, password: nueva }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? "No se pudo cambiar la contraseña."); return; }
      window.alert("Contraseña actualizada.");
    } finally { setBusy(null); }
  }

  async function probarNavegador(n: number) {
    setDiagBusy(true);
    setDiag(null);
    try {
      const res = await fetch(`/api/diagnostico/navegador?n=${n}`);
      const data = await res.json().catch(() => ({}));
      setDiag(res.ok ? data : { error: data.error ?? "No se pudo ejecutar la prueba." });
    } catch {
      setDiag({ error: "Error de red al ejecutar la prueba." });
    } finally {
      setDiagBusy(false);
    }
  }

  // Prueba una URL de Browserless pegada a mano (aísla si el problema es Render o Browserless).
  async function probarUrl() {
    if (!wsUrl.trim()) return;
    setDiagBusy(true);
    setDiag(null);
    try {
      const res = await fetch(`/api/diagnostico/navegador`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ws: wsUrl.trim(), n: 1 }),
      });
      const data = await res.json().catch(() => ({}));
      setDiag(res.ok ? data : { error: data.error ?? "No se pudo ejecutar la prueba." });
    } catch {
      setDiag({ error: "Error de red al ejecutar la prueba." });
    } finally {
      setDiagBusy(false);
    }
  }

  async function resetTodo() {
    if (!window.confirm("¿Eliminar TODAS las cuentas registradas? Esta acción no se puede deshacer. El usuario supremo se recreará y tendrás que iniciar sesión de nuevo.")) return;
    const txt = window.prompt('Para confirmar, escribe ELIMINAR (en mayúsculas):');
    if (txt !== "ELIMINAR") { setError("Confirmación incorrecta. No se eliminó nada."); return; }
    setReseteando(true); setError(null);
    try {
      const res = await fetch("/api/supremo/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmar: "ELIMINAR" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? "No se pudo reiniciar."); return; }
      // La sesión se cerró en el servidor: volvemos al login.
      window.location.href = "/login";
    } finally { setReseteando(false); }
  }

  const FILTROS: { k: Filtro; t: string }[] = [
    { k: "pendiente", t: "Pendientes" },
    { k: "aprobado", t: "Aprobados" },
    { k: "rechazado", t: "Rechazados" },
    { k: "todas", t: "Todas" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {FILTROS.map((f) => (
          <button
            key={f.k}
            onClick={() => setFiltro(f.k)}
            className={`rounded-lg px-3 py-1.5 text-sm ${filtro === f.k ? "bg-brand-600 text-white" : "border border-slate-200 text-slate-600 hover:bg-slate-50"}`}
          >
            {f.t}
          </button>
        ))}
        <button onClick={cargar} className="ml-auto text-xs text-brand-600 hover:underline" disabled={cargando}>
          {cargando ? "Actualizando…" : "↻ Actualizar"}
        </button>
      </div>

      {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}

      {lista.length === 0 ? (
        <div className="card p-6 text-sm text-slate-500">
          {cargando ? "Cargando…" : "No hay solicitudes en esta vista."}
        </div>
      ) : (
        <div className="card overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-400">
                <tr>
                  <th className="px-4 py-2">Solicitante</th>
                  <th className="px-4 py-2">Correo</th>
                  <th className="px-4 py-2">Estado</th>
                  <th className="px-4 py-2">Módulos de paga</th>
                  <th className="px-4 py-2 text-right">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lista.map((s) => {
                  const est = s.estado ?? "aprobado";
                  const b = BADGE[est] ?? BADGE.aprobado;
                  return (
                    <Fragment key={s.id}>
                    <tr>
                      <td className="px-4 py-2 font-medium text-slate-700">
                        {s.nombre}
                        <p className="text-[11px] font-normal text-slate-400">{fmt(s.createdAt)}</p>
                        <button
                          onClick={() => toggleOperadores(s)}
                          className="mt-0.5 text-[11px] font-normal text-brand-600 hover:underline"
                          title="Ver operadores"
                        >
                          {expandido === s.id ? "▼" : "▶"} 👥 {s.operadores ?? 0} operador{(s.operadores ?? 0) === 1 ? "" : "es"}
                        </button>
                      </td>
                      <td className="px-4 py-2 text-slate-600">{s.email}</td>
                      <td className="px-4 py-2">
                        <span className={`badge ${b.cls}`}>{b.txt}</span>
                        {s.decididoAt && <span className="ml-1 text-[10px] text-slate-400">{fmt(s.decididoAt)}</span>}
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex flex-col gap-1">
                          {MODULOS.map((m) => {
                            const on = (s.modulos ?? []).includes(m.key);
                            return (
                              <label key={m.key} className="flex items-center gap-1.5 text-xs text-slate-600">
                                <input
                                  type="checkbox"
                                  checked={on}
                                  disabled={busy !== null}
                                  onChange={() => toggleModulo(s, m.key)}
                                />
                                <span className={on ? "font-semibold text-emerald-700" : ""}>{m.label}</span>
                              </label>
                            );
                          })}
                        </div>
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex justify-end gap-2">
                          {est !== "aprobado" && (
                            <button
                              onClick={() => decidir(s, "aprobado")}
                              disabled={busy !== null}
                              className="rounded-lg border border-emerald-200 px-2.5 py-1 text-xs text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                            >
                              {busy === s.id ? "…" : "Aprobar"}
                            </button>
                          )}
                          {est !== "rechazado" && (
                            <button
                              onClick={() => decidir(s, "rechazado")}
                              disabled={busy !== null}
                              className="rounded-lg border border-red-200 px-2.5 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
                            >
                              {busy === s.id ? "…" : "Rechazar"}
                            </button>
                          )}
                          <button
                            onClick={() => cambiarPassword(s)}
                            disabled={busy !== null}
                            className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                            title="Cambiar la contraseña de esta cuenta"
                          >
                            🔑 Contraseña
                          </button>
                        </div>
                      </td>
                    </tr>
                    {expandido === s.id && (
                      <tr className="bg-slate-50">
                        <td colSpan={5} className="px-6 py-3">
                          {!opsDetalle[s.id] ? (
                            <p className="text-xs text-slate-400">Cargando operadores…</p>
                          ) : opsDetalle[s.id].length === 0 ? (
                            <p className="text-xs text-slate-500">Esta cuenta no tiene operadores.</p>
                          ) : (
                            <ul className="space-y-1">
                              {opsDetalle[s.id].map((o) => (
                                <li key={o.id} className="flex flex-wrap items-center gap-x-3 text-xs text-slate-600">
                                  <span className="font-medium text-slate-700">{o.nombre}</span>
                                  <span className="text-slate-500">{o.email}</span>
                                  <span className="text-slate-400">· desde {fmt(o.createdAt)}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Diagnóstico del navegador remoto (Browserless) */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-800">Prueba de navegador (Browserless)</h3>
        <p className="mt-1 text-xs text-slate-500">
          Abre varios navegadores a la vez para verificar la conexión y la concurrencia. Consume
          unidades de Browserless.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={() => probarNavegador(1)}
            disabled={diagBusy}
            className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {diagBusy ? "Probando…" : "Probar conexión (1)"}
          </button>
          <button
            onClick={() => probarNavegador(2)}
            disabled={diagBusy}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Probar multiuso (2)
          </button>
          <button
            onClick={() => probarNavegador(5)}
            disabled={diagBusy}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Probar multiuso (5)
          </button>
        </div>

        {/* Configurar la URL de Browserless DENTRO de la app (sin depender de Render) */}
        <div className="mt-3 rounded-lg border border-brand-200 bg-brand-50/40 p-3">
          <p className="mb-1 text-xs font-semibold text-brand-800">
            URL de Browserless (guardada en la app)
          </p>
          <p className="mb-2 text-[11px] text-slate-500">
            Pega tu URL de Browserless. Se guarda aquí y se usa aunque el hosting no cargue la variable
            de entorno. {urlGuardada?.configurada && (
              <span className="font-semibold text-emerald-700">Actual: {urlGuardada.preview}</span>
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              value={wsUrl}
              onChange={(e) => setWsUrl(e.target.value)}
              placeholder="wss://production-sfo.browserless.io?token=..."
              className="min-w-[260px] flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-xs outline-none focus:border-brand-500"
            />
            <button
              onClick={() => guardarUrl()}
              disabled={guardarBusy || !wsUrl.trim()}
              className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {guardarBusy ? "Guardando…" : "💾 Guardar URL"}
            </button>
            <button
              onClick={probarUrl}
              disabled={diagBusy || !wsUrl.trim()}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              title="Prueba la URL sin guardarla"
            >
              Solo probar
            </button>
            {urlGuardada?.configurada && (
              <button
                onClick={() => guardarUrl("")}
                disabled={guardarBusy}
                className="rounded-lg border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
                title="Quita la URL guardada y vuelve al navegador local (Render), que sí entra a SUNAT"
              >
                🗑️ Quitar URL (usar local)
              </button>
            )}
          </div>
          {guardarMsg && <p className="mt-1 text-[11px] text-slate-600">{guardarMsg}</p>}
          <p className="mt-1 text-[10px] text-slate-400">
            Nota: en el plan Free (sin disco) esto puede borrarse al redesplegar; si pasa, vuelve a
            guardarla aquí. Tras confirmar, conviene rotar el token en Browserless.
          </p>
        </div>

        {diag && (
          <div className="mt-3 space-y-2 text-sm">
            {diag.error ? (
              <div className="rounded-lg bg-red-50 px-3 py-2 text-red-600">{diag.error}</div>
            ) : (
              <>
                <div
                  className={`rounded-lg px-3 py-2 font-semibold ${
                    diag.destinoReal?.includes("remoto")
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-amber-50 text-amber-700"
                  }`}
                >
                  {diag.destinoReal}
                </div>
                <p className="text-xs text-slate-600">{diag.aviso}</p>
                {diag.envDebug && (
                  <div className="rounded-md bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
                    {diag.fuente && diag.fuente !== "—" && (
                      <p>Fuente de la conexión: <b className="text-emerald-700">{diag.fuente}</b></p>
                    )}
                    <p>Variable de entorno (Render): <b>{diag.envDebug.variableEntorno}</b></p>
                    <p>URL guardada en la app: <b>{diag.envDebug.urlGuardadaEnApp}</b></p>
                  </div>
                )}
                <div className="flex flex-wrap gap-4 text-xs text-slate-600">
                  <span>Solicitadas: <b>{diag.solicitadas}</b></span>
                  <span className="text-emerald-600">Exitosas: <b>{diag.exitosas}</b></span>
                  <span className="text-red-600">Fallidas: <b>{diag.fallidas}</b></span>
                  <span>Tiempo: <b>{diag.msTotal} ms</b></span>
                  <span>
                    Concurrencia:{" "}
                    <b className={diag.concurrenciaOk ? "text-emerald-600" : "text-red-600"}>
                      {diag.concurrenciaOk ? "OK ✅" : "con fallos ⚠️"}
                    </b>
                  </span>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-red-200 bg-red-50 p-4">
        <h3 className="text-sm font-semibold text-red-700">Zona de peligro</h3>
        <p className="mt-1 text-xs text-red-600">
          Elimina <b>todas las cuentas registradas</b> (estudios y operadores) y recrea el
          usuario supremo desde cero. No se puede deshacer.
        </p>
        <button
          onClick={resetTodo}
          disabled={reseteando}
          className="mt-3 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
        >
          {reseteando ? "Eliminando…" : "Eliminar todas las cuentas y recrear supremo"}
        </button>
      </div>
    </div>
  );
}
