"use client";

import { useEffect, useState, useCallback } from "react";

interface Solicitud {
  id: string;
  nombre: string;
  email: string;
  createdAt: string;
  estado?: "pendiente" | "aprobado" | "rechazado";
  decididoAt?: string;
  modulos?: string[];
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
                    <tr key={s.id}>
                      <td className="px-4 py-2 font-medium text-slate-700">
                        {s.nombre}
                        <p className="text-[11px] font-normal text-slate-400">{fmt(s.createdAt)}</p>
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
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

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
