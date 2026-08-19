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
  plan?: "basico" | "regular" | "premium" | "equipo";
  operadores?: number;
}

// Planes que el supremo asigna (cada uno desbloquea sus módulos).
const PLANES_OPC: { key: "basico" | "regular" | "premium" | "equipo"; label: string; desc: string }[] = [
  { key: "basico", label: "Básico (gratis)", desc: "Reporte analítico de auditoría" },
  { key: "regular", label: "Regular", desc: "+ Consultas tributarias" },
  { key: "premium", label: "Premium", desc: "+ Detalle SIRE y RTT" },
  { key: "equipo", label: "Plan de Equipo", desc: "Premium + operarios (equipo)" },
];

// Utilitarios que el supremo puede habilitar por cuenta.
const UTILITARIOS_OPC: { key: string; label: string }[] = [
  { key: "conciliacion", label: "Conciliación bancaria" },
  { key: "ventas-caja", label: "Ventas vs Caja Virtual" },
  { key: "banco-word", label: "Estado de cuenta → Word" },
  { key: "analisis-rtp", label: "Análisis para RTP" },
  { key: "comprobantes-xml", label: "Comprobante XML SUNAT" },
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
  // Si se entró por /supremo?u=<id> (link de un solicitante), mostrar TODAS y resaltarlo.
  const destacadoId = typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("u")
    : null;
  const [filtro, setFiltro] = useState<Filtro>(destacadoId ? "todas" : "pendiente");
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
  // Copia de seguridad (backup/restauración de la base de datos).
  const [bkBusy, setBkBusy] = useState<string | null>(null);
  const [bkMsg, setBkMsg] = useState<string | null>(null);
  // Integraciones antibloqueo (captcha + proxy).
  const [integ, setInteg] = useState<any>(null);
  const [capKey, setCapKey] = useState("");
  const [pxServer, setPxServer] = useState("");
  const [pxUser, setPxUser] = useState("");
  const [pxPass, setPxPass] = useState("");
  const [integBusy, setIntegBusy] = useState<string | null>(null);
  const [integMsg, setIntegMsg] = useState<string | null>(null);

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

  const cargarInteg = useCallback(() => {
    fetch("/api/supremo/integraciones")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setInteg(d);
        setPxServer(d.proxy?.server ?? "");
      })
      .catch(() => {});
  }, []);
  useEffect(() => { cargarInteg(); }, [cargarInteg]);

  async function guardarInteg(patch: Record<string, string>, etiqueta: string) {
    setIntegBusy(etiqueta); setIntegMsg(null);
    try {
      const res = await fetch("/api/supremo/integraciones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setIntegMsg(d.error ?? "No se pudo guardar."); return; }
      setIntegMsg("✅ Guardado.");
      setCapKey(""); setPxUser(""); setPxPass("");
      cargarInteg();
    } catch {
      setIntegMsg("Error de red al guardar.");
    } finally { setIntegBusy(null); }
  }

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

  async function cambiarPlan(s: Solicitud, plan: string) {
    setBusy(s.id); setError(null);
    try {
      const res = await fetch("/api/supremo/solicitudes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: s.id, plan }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? "No se pudo asignar el plan."); return; }
      await cargar();
    } finally { setBusy(null); }
  }

  async function toggleUtilitario(s: Solicitud, key: string) {
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
      if (!res.ok) { setError(data.error ?? "No se pudo actualizar los utilitarios."); return; }
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

  async function descargarBackup(soloDatos: boolean) {
    setBkBusy(soloDatos ? "datos" : "zip");
    setBkMsg(null);
    try {
      const res = await fetch(`/api/supremo/backup${soloDatos ? "?solo=datos" : ""}`);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setBkMsg(d.error ?? "No se pudo generar el backup.");
        return;
      }
      const blob = await res.blob();
      const cd = res.headers.get("content-disposition") ?? "";
      const nombre = /filename="([^"]+)"/.exec(cd)?.[1] ?? (soloDatos ? "radar-datos.json" : "radar-backup.zip");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = nombre;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setBkMsg(`✅ Backup descargado (${nombre}). Guárdalo en un lugar seguro.`);
    } catch {
      setBkMsg("Error de red al descargar el backup.");
    } finally {
      setBkBusy(null);
    }
  }

  async function restaurarBackup(file: File) {
    const txt = window.prompt(
      `Vas a RESTAURAR la base de datos desde "${file.name}". Esto REEMPLAZA los datos actuales (se guarda una copia del estado actual antes). Escribe RESTAURAR para confirmar:`
    );
    if (txt !== "RESTAURAR") {
      setBkMsg("Restauración cancelada.");
      return;
    }
    setBkBusy("restaurar");
    setBkMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("confirmar", "RESTAURAR");
      const res = await fetch("/api/supremo/backup", { method: "POST", body: fd });
      const d = await res.json().catch(() => ({}));
      setBkMsg(res.ok ? `✅ ${d.mensaje}` : (d.error ?? "No se pudo restaurar."));
      if (res.ok) cargar();
    } catch {
      setBkMsg("Error de red al restaurar.");
    } finally {
      setBkBusy(null);
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
                  <th className="px-4 py-2">Plan</th>
                  <th className="px-4 py-2 text-right">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lista.map((s) => {
                  const est = s.estado ?? "aprobado";
                  const b = BADGE[est] ?? BADGE.aprobado;
                  return (
                    <Fragment key={s.id}>
                    <tr className={destacadoId === s.id ? "bg-amber-50 ring-2 ring-amber-300" : ""}>
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
                          {PLANES_OPC.map((pl) => {
                            const on = (s.plan ?? "basico") === pl.key;
                            return (
                              <label key={pl.key} className="flex items-center gap-1.5 text-xs text-slate-600" title={pl.desc}>
                                <input
                                  type="checkbox"
                                  checked={on}
                                  disabled={busy !== null}
                                  onChange={() => cambiarPlan(s, pl.key)}
                                />
                                <span className={on ? "font-semibold text-emerald-700" : ""}>{pl.label}</span>
                              </label>
                            );
                          })}
                          <div className="mt-1 border-t border-slate-100 pt-1">
                            <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Utilitarios</p>
                            {UTILITARIOS_OPC.map((u) => {
                              const on = (s.modulos ?? []).includes(u.key);
                              return (
                                <label key={u.key} className="flex items-center gap-1.5 text-xs text-slate-600">
                                  <input
                                    type="checkbox"
                                    checked={on}
                                    disabled={busy !== null}
                                    onChange={() => toggleUtilitario(s, u.key)}
                                  />
                                  <span className={on ? "font-semibold text-brand-700" : ""}>{u.label}</span>
                                </label>
                              );
                            })}
                          </div>
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

      {/* Integraciones antibloqueo SUNAT (captcha + proxy) */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-800">🛡️ Antibloqueo SUNAT (captcha + proxy)</h3>
        <p className="mt-1 text-xs text-slate-500">
          Para que las extracciones funcionen aunque SUNAT muestre captcha (Cloudflare Turnstile) o
          bloquee la IP del servidor. Se guardan aquí (cifrado en la base) o por variables de entorno
          (estas tienen prioridad). Los secretos no se muestran completos.
        </p>

        {/* CapSolver (captcha) */}
        <div className="mt-3 rounded-lg border border-slate-200 p-3">
          <div className="mb-1 flex items-center justify-between">
            <p className="text-xs font-semibold text-slate-700">CapSolver — resolución de captcha</p>
            {integ?.capsolver && (
              <span className={`text-[11px] ${integ.capsolver.configurada ? "text-emerald-600" : "text-slate-400"}`}>
                {integ.capsolver.configurada
                  ? `✓ configurada (${integ.capsolver.fuente}) ${integ.capsolver.preview}`
                  : "no configurada"}
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              value={capKey}
              onChange={(e) => setCapKey(e.target.value)}
              placeholder="CAPSOLVER_KEY (clientKey de capsolver.com)"
              className="min-w-[260px] flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-xs outline-none focus:border-brand-500"
              type="password"
              autoComplete="off"
            />
            <button
              onClick={() => guardarInteg({ capsolverKey: capKey.trim() }, "cap")}
              disabled={integBusy !== null || !capKey.trim()}
              className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {integBusy === "cap" ? "Guardando…" : "💾 Guardar key"}
            </button>
            {integ?.capsolver?.configurada && integ.capsolver.fuente === "app" && (
              <button
                onClick={() => guardarInteg({ capsolverKey: "" }, "cap")}
                disabled={integBusy !== null}
                className="rounded-lg border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                🗑️ Quitar
              </button>
            )}
          </div>
        </div>

        {/* Proxy residencial */}
        <div className="mt-3 rounded-lg border border-slate-200 p-3">
          <div className="mb-1 flex items-center justify-between">
            <p className="text-xs font-semibold text-slate-700">Proxy residencial — evita bloqueo por IP</p>
            {integ?.proxy && (
              <span className={`text-[11px] ${integ.proxy.configurado ? "text-emerald-600" : "text-slate-400"}`}>
                {integ.proxy.configurado ? `✓ activo (${integ.proxy.fuente})` : "no configurado"}
              </span>
            )}
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <input
              value={pxServer}
              onChange={(e) => setPxServer(e.target.value)}
              placeholder="http://host:puerto (o socks5://)"
              className="rounded-md border border-slate-300 px-2 py-1.5 text-xs outline-none focus:border-brand-500 sm:col-span-3"
              autoComplete="off"
            />
            <input
              value={pxUser}
              onChange={(e) => setPxUser(e.target.value)}
              placeholder="usuario del proxy"
              className="rounded-md border border-slate-300 px-2 py-1.5 text-xs outline-none focus:border-brand-500"
              autoComplete="off"
            />
            <input
              value={pxPass}
              onChange={(e) => setPxPass(e.target.value)}
              placeholder="clave del proxy"
              type="password"
              className="rounded-md border border-slate-300 px-2 py-1.5 text-xs outline-none focus:border-brand-500"
              autoComplete="new-password"
            />
            <button
              onClick={() => guardarInteg({ proxyServer: pxServer.trim(), proxyUser: pxUser.trim(), proxyPass: pxPass.trim() }, "px")}
              disabled={integBusy !== null}
              className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {integBusy === "px" ? "Guardando…" : "💾 Guardar proxy"}
            </button>
          </div>
          {integ?.proxy?.configurado && integ.proxy.fuente === "app" && (
            <button
              onClick={() => guardarInteg({ proxyServer: "", proxyUser: "", proxyPass: "" }, "px")}
              disabled={integBusy !== null}
              className="mt-2 rounded-lg border border-red-300 px-3 py-1.5 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              🗑️ Quitar proxy
            </button>
          )}
        </div>
        {integMsg && <p className="mt-2 text-xs text-slate-600">{integMsg}</p>}
      </div>

      {/* Copia de seguridad (backup / restauración) */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-800">💾 Copia de seguridad</h3>
        <p className="mt-1 text-xs text-slate-500">
          La base de datos es <b>store.json</b> (clientes, usuarios, configuración) + los archivos
          subidos. Además, el sistema guarda solo un <b>snapshot automático diario</b> (últimos 14) en el
          disco. Descarga una copia periódicamente y guárdala fuera del servidor.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            onClick={() => descargarBackup(false)}
            disabled={bkBusy !== null}
            className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {bkBusy === "zip" ? "Generando…" : "⬇ Backup completo (ZIP)"}
          </button>
          <button
            onClick={() => descargarBackup(true)}
            disabled={bkBusy !== null}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {bkBusy === "datos" ? "Generando…" : "⬇ Solo datos (JSON)"}
          </button>
          <label className={`rounded-lg border border-amber-300 px-3 py-1.5 text-sm text-amber-800 hover:bg-amber-50 ${bkBusy ? "pointer-events-none opacity-50" : "cursor-pointer"}`}>
            {bkBusy === "restaurar" ? "Restaurando…" : "⟲ Restaurar desde archivo"}
            <input
              type="file"
              accept=".zip,.json,application/zip,application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) restaurarBackup(f);
                e.currentTarget.value = "";
              }}
            />
          </label>
        </div>
        {bkMsg && <p className="mt-2 text-xs text-slate-600">{bkMsg}</p>}
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
