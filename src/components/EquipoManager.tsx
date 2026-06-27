"use client";

import { useState } from "react";

interface Sub {
  id: string;
  nombre: string;
  email: string;
  rol?: "admin" | "operador";
  createdAt: string;
}

export default function EquipoManager({
  inicial,
  adminNombre,
}: {
  inicial: Sub[];
  adminNombre: string;
}) {
  const [subs, setSubs] = useState<Sub[]>(inicial);
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setInfo(null);
    if (!nombre.trim() || !email.trim() || !password) return setError("Completa nombre, correo y contraseña.");
    setBusy(true);
    try {
      const res = await fetch("/api/usuarios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre, email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? "No se pudo crear el usuario."); return; }
      setSubs((prev) => [...prev, data.usuario]);
      setNombre(""); setEmail(""); setPassword("");
      setInfo(`Cuenta creada para ${data.usuario.nombre}. Ya puede iniciar sesión.`);
    } catch {
      setError("Error de red.");
    } finally { setBusy(false); }
  }

  async function eliminar(s: Sub) {
    if (!confirm(`¿Eliminar la cuenta de ${s.nombre}? No podrá volver a iniciar sesión.`)) return;
    setError(null); setInfo(null);
    try {
      const res = await fetch(`/api/usuarios?id=${encodeURIComponent(s.id)}`, { method: "DELETE" });
      if (!res.ok) { setError("No se pudo eliminar."); return; }
      setSubs((prev) => prev.filter((x) => x.id !== s.id));
    } catch { setError("Error de red."); }
  }

  return (
    <div className="space-y-6">
      {/* Alta de operador */}
      <section className="card p-5">
        <h2 className="mb-3 font-semibold text-slate-800">Agregar trabajador (operador)</h2>
        {error && <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
        {info && <div className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{info}</div>}
        <form onSubmit={crear} className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="label">Nombre</label>
            <input className="input" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre del trabajador" />
          </div>
          <div>
            <label className="label">Correo (usuario)</label>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="trabajador@correo.com" autoComplete="off" />
          </div>
          <div>
            <label className="label">Contraseña</label>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mín. 6 caracteres" autoComplete="new-password" />
          </div>
          <div className="sm:col-span-3">
            <button className="btn-primary" disabled={busy}>{busy ? "Creando…" : "Crear cuenta"}</button>
          </div>
        </form>
      </section>

      {/* Lista de cuentas */}
      <section className="card p-5">
        <h2 className="mb-3 font-semibold text-slate-800">Cuentas del estudio</h2>
        <div className="overflow-hidden rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-400">
              <tr>
                <th className="px-3 py-2">Nombre</th>
                <th className="px-3 py-2">Correo</th>
                <th className="px-3 py-2">Rol</th>
                <th className="px-3 py-2 text-right">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              <tr className="bg-brand-50/40">
                <td className="px-3 py-2 font-medium text-slate-800">{adminNombre} (tú)</td>
                <td className="px-3 py-2 text-slate-500">—</td>
                <td className="px-3 py-2"><span className="badge bg-brand-100 text-brand-700">Administrador</span></td>
                <td className="px-3 py-2"></td>
              </tr>
              {subs.map((s) => (
                <tr key={s.id}>
                  <td className="px-3 py-2 text-slate-700">{s.nombre}</td>
                  <td className="px-3 py-2 text-slate-500">{s.email}</td>
                  <td className="px-3 py-2"><span className="badge bg-slate-100 text-slate-600">Operador</span></td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => eliminar(s)} className="text-xs text-slate-400 hover:text-red-600">Eliminar</button>
                  </td>
                </tr>
              ))}
              {subs.length === 0 && (
                <tr><td colSpan={4} className="px-3 py-4 text-center text-sm text-slate-400">Aún no agregaste trabajadores.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
