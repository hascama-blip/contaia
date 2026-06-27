"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { SunatInfo } from "@/lib/types";
import { CondicionBadge, EstadoBadge } from "@/components/ui";
import { setSolPass } from "@/lib/solSession";

export default function NuevoClientePage() {
  const router = useRouter();
  const [form, setForm] = useState({
    razonSocial: "",
    ruc: "",
    email: "",
    telefono: "",
    // Credenciales SOL: usuario + clave (obligatorios) y API (opcional).
    solUser: "",
    solPass: "",
    clientId: "",
    clientSecret: "",
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
    // Usuario + Clave SOL son obligatorios (habilitan el diagnóstico previo).
    if (!form.solUser.trim() || !form.solPass.trim()) {
      setError("El Usuario SOL y la Clave SOL son obligatorios para el diagnóstico.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/clientes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Adjuntamos la info SUNAT consultada + credenciales (la Clave SOL NO se guarda).
        body: JSON.stringify({
          razonSocial: form.razonSocial,
          ruc: form.ruc,
          email: form.email,
          telefono: form.telefono,
          sunat,
          cred: {
            solUser: form.solUser,
            clientId: form.clientId,
            clientSecret: form.clientSecret,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "No se pudo crear el cliente.");
        return;
      }
      // La Clave SOL queda solo en la sesión del navegador (nunca en la BD).
      setSolPass(data.cliente.id, form.solPass);
      router.push(`/clientes/${data.cliente.id}`);
    } catch {
      setError("Error de red.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* Héroe corporativo */}
      <section className="hero-gradient relative overflow-hidden rounded-3xl p-7 text-white shadow-lg">
        <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10" />
        <div className="absolute -bottom-12 -left-6 h-40 w-40 rounded-full bg-white/10" />
        <div className="relative">
          <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold backdrop-blur">
            🔎 Consulta SUNAT en segundos
          </span>
          <h1 className="mt-3 text-3xl font-bold leading-tight">
            Diagnóstico tributario de tu cliente
          </h1>
          <p className="mt-2 max-w-lg text-sm text-white/85">
            Escribe el <strong>RUC</strong> y la plataforma trae los datos de SUNAT,
            su SIRE, buzón y declaraciones para darte un diagnóstico claro.
          </p>
        </div>
      </section>

      {/* Cómo funciona: 3 pasos simples */}
      <section className="grid gap-3 sm:grid-cols-3">
        <Paso n="1" titulo="Ingresa el RUC" detalle="Trae razón social y estado SUNAT automáticamente." />
        <Paso n="2" titulo="Extrae su info" detalle="SIRE (compras/ventas), buzón y declaraciones." />
        <Paso n="3" titulo="Obtén el informe" detalle="Diagnóstico, contingencias e informe de gerencia." />
      </section>

      <form onSubmit={submit} className="card space-y-4 p-6 shadow-md">
        <div>
          <label className="label text-base font-semibold text-slate-700">
            RUC del cliente
          </label>
          <div className="flex gap-2">
            <input
              className="input flex-1 rounded-xl border-2 border-brand-100 py-3 text-lg font-semibold tracking-wide focus:border-brand-500"
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
              className="btn-accent shrink-0 px-5 text-base"
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
              <p className="mt-2 text-xs text-slate-500">
                <span className="font-semibold text-slate-600">Domicilio fiscal:</span>{" "}
                {sunat.direccion}
              </p>
            )}
            {(sunat.fechaInscripcion || sunat.fechaInicioActividades) && (
              <p className="mt-1 text-xs text-slate-500">
                {sunat.fechaInscripcion && (
                  <><span className="font-semibold text-slate-600">Inscripción:</span> {sunat.fechaInscripcion}{"  "}</>
                )}
                {sunat.fechaInicioActividades && (
                  <><span className="font-semibold text-slate-600">Inicio de actividades:</span> {sunat.fechaInicioActividades}</>
                )}
              </p>
            )}
            {sunat.representantes && sunat.representantes.length > 0 && (
              <div className="mt-3">
                <p className="mb-1 text-xs font-semibold text-slate-600">
                  Representantes legales ({sunat.representantes.length})
                </p>
                <div className="overflow-hidden rounded-md border border-brand-100 bg-white">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 text-left text-[11px] uppercase text-slate-400">
                      <tr>
                        <th className="px-2 py-1">Nombre</th>
                        <th className="px-2 py-1 whitespace-nowrap">Documento</th>
                        <th className="px-2 py-1">Cargo</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {sunat.representantes.map((r, i) => (
                        <tr key={i}>
                          <td className="px-2 py-1 text-slate-700">{r.nombre}</td>
                          <td className="px-2 py-1 whitespace-nowrap text-slate-600">
                            {[r.tipoDoc, r.numeroDoc].filter(Boolean).join(" ")}
                          </td>
                          <td className="px-2 py-1 text-slate-500">{r.cargo ?? ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        <div>
          <label className="label">
            Razón social *
            {sunat && (
              <span className="ml-2 text-xs font-normal text-emerald-600">🔒 Verificada con SUNAT (no editable)</span>
            )}
          </label>
          <input
            className={`input ${sunat ? "cursor-not-allowed bg-slate-100 text-slate-600" : ""}`}
            value={form.razonSocial}
            onChange={(e) => set("razonSocial", e.target.value)}
            placeholder="Se autocompleta al buscar el RUC"
            readOnly={!!sunat}
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

        {/* Credenciales SOL (obligatorias para el diagnóstico) */}
        <div className="rounded-xl border border-brand-100 bg-brand-50/40 p-4">
          <p className="text-sm font-semibold text-slate-700">Credenciales SUNAT (SOL)</p>
          <p className="mb-3 text-xs text-slate-500">
            El <b>Usuario</b> y la <b>Clave SOL</b> son obligatorios (habilitan buzón y
            fraccionamiento). La <b>API</b> es opcional aquí: se puede colocar luego en campo
            para habilitar el SIRE. <b>La Clave SOL nunca se guarda.</b>
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Usuario SOL *</label>
              <input
                className="input"
                value={form.solUser}
                onChange={(e) => set("solUser", e.target.value)}
                placeholder="Usuario SOL"
                autoComplete="off"
              />
            </div>
            <div>
              <label className="label">Clave SOL *</label>
              <input
                className="input"
                type="password"
                value={form.solPass}
                onChange={(e) => set("solPass", e.target.value)}
                placeholder="No se guarda"
                autoComplete="new-password"
              />
            </div>
            <div>
              <label className="label">client_id (API) — opcional</label>
              <input
                className="input"
                value={form.clientId}
                onChange={(e) => set("clientId", e.target.value)}
                placeholder="Se puede colocar luego"
                autoComplete="off"
              />
            </div>
            <div>
              <label className="label">client_secret (API) — opcional</label>
              <input
                className="input"
                type="password"
                value={form.clientSecret}
                onChange={(e) => set("clientSecret", e.target.value)}
                placeholder="Se puede colocar luego"
                autoComplete="new-password"
              />
            </div>
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
          <button type="submit" className="btn-primary px-6" disabled={loading}>
            {loading ? "Guardando…" : "Crear cliente →"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Paso({ n, titulo, detalle }: { n: string; titulo: string; detalle: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-brand-200 hover:shadow-md">
      <div className="flex items-center gap-3">
        <span className="step-num">{n}</span>
        <p className="font-semibold text-slate-800">{titulo}</p>
      </div>
      <p className="mt-2 text-xs text-slate-500">{detalle}</p>
    </div>
  );
}
