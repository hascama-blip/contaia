"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function NuevoClientePage() {
  const router = useRouter();
  const [form, setForm] = useState({
    razonSocial: "",
    ruc: "",
    email: "",
    telefono: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function set(key: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/clientes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "No se pudo crear el cliente.");
        return;
      }
      router.push(`/clientes/${data.cliente.id}`);
    } catch {
      setError("Error de red.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <h1 className="text-2xl font-bold text-slate-800">Nuevo cliente</h1>
      <form onSubmit={submit} className="card space-y-4 p-6">
        <div>
          <label className="label">Razón social *</label>
          <input
            className="input"
            value={form.razonSocial}
            onChange={(e) => set("razonSocial", e.target.value)}
            placeholder="EMPRESA EJEMPLO S.A.C."
            required
          />
        </div>
        <div>
          <label className="label">RUC *</label>
          <input
            className="input"
            value={form.ruc}
            onChange={(e) => set("ruc", e.target.value.replace(/\D/g, "").slice(0, 11))}
            placeholder="20123456789"
            inputMode="numeric"
            required
          />
          <p className="mt-1 text-xs text-slate-400">11 dígitos.</p>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Email</label>
            <input
              className="input"
              type="email"
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
              placeholder="contacto@cliente.com"
            />
          </div>
          <div>
            <label className="label">Teléfono</label>
            <input
              className="input"
              value={form.telefono}
              onChange={(e) => set("telefono", e.target.value)}
              placeholder="999 888 777"
            />
          </div>
        </div>

        {error && (
          <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="btn-ghost"
            onClick={() => router.back()}
            disabled={loading}
          >
            Cancelar
          </button>
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? "Guardando…" : "Crear cliente"}
          </button>
        </div>
      </form>
    </div>
  );
}
