"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { SunatInfo } from "@/lib/types";
import { CondicionBadge, EstadoBadge } from "@/components/ui";

export default function NuevoClientePage() {
  const router = useRouter();
  const [form, setForm] = useState({
    razonSocial: "",
    ruc: "",
    email: "",
    telefono: "",
  });
  const [sunat, setSunat] = useState<SunatInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [loading, setLoading] = useState(false);

  function set(key: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function setRuc(value: string) {
    const limpio = value.replace(/\D/g, "").slice(0, 11);
    set("ruc", limpio);
    // Si cambian el RUC, invalidamos la consulta previa.
    if (sunat && sunat.ruc !== limpio) setSunat(null);
  }

  async function buscarRuc() {
    setError(null);
    setSunat(null);
    if (form.ruc.length !== 11) {
      setError("Ingresa un RUC de 11 dígitos para buscar.");
      return;
    }
    setBuscando(true);
    // En el primer uso, Render (plan gratis) puede tardar en "despertar";
    // damos hasta 70s y avisamos si se agota el tiempo.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 70_000);
    try {
      const res = await fetch(`/api/sunat/${form.ruc}`, {
        signal: controller.signal,
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          data.error ?? `No se pudo consultar el RUC (código ${res.status}).`
        );
        return;
      }
      const info: SunatInfo = data.sunat;
      setSunat(info);
      // Autocompleta la razón social con la de SUNAT.
      setForm((f) => ({ ...f, razonSocial: info.razonSocial }));
    } catch (err: any) {
      if (err?.name === "AbortError") {
        setError(
          "La consulta tardó demasiado (el servidor pudo estar dormido). Intenta de nuevo."
        );
      } else {
        setError("Error de red al consultar SUNAT. Revisa tu conexión e intenta otra vez.");
      }
    } finally {
      clearTimeout(timeout);
      setBuscando(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/clientes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Adjuntamos la info SUNAT consultada para guardarla con el cliente.
        body: JSON.stringify({ ...form, sunat }),
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
          <label className="label">RUC *</label>
          <div className="flex gap-2">
            <input
              className="input"
              value={form.ruc}
              onChange={(e) => setRuc(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  buscarRuc();
                }
              }}
              placeholder="20123456789"
              inputMode="numeric"
              required
            />
            <button
              type="button"
              className="btn-ghost shrink-0"
              onClick={buscarRuc}
              disabled={buscando}
            >
              {buscando ? "Buscando…" : "🔎 Buscar"}
            </button>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Escribe el RUC (11 dígitos) y pulsa <strong>Buscar</strong> para traer la
            información desde SUNAT.
          </p>
        </div>

        {sunat && (
          <div className="rounded-lg border border-brand-100 bg-brand-50 p-3 text-sm">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-semibold text-slate-700">Datos SUNAT</span>
              <span className="text-xs text-slate-400">
                fuente: {sunat.fuente}
              </span>
            </div>
            <p className="font-medium text-slate-800">{sunat.razonSocial}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <EstadoBadge estado={sunat.estado} />
              <CondicionBadge condicion={sunat.condicion} />
              <span className="badge bg-white text-slate-600">
                {sunat.tipoContribuyente}
              </span>
            </div>
            {sunat.direccion && (
              <p className="mt-2 text-xs text-slate-500">{sunat.direccion}</p>
            )}
          </div>
        )}

        <div>
          <label className="label">Razón social *</label>
          <input
            className="input"
            value={form.razonSocial}
            onChange={(e) => set("razonSocial", e.target.value)}
            placeholder="Se autocompleta al buscar el RUC"
            required
          />
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
