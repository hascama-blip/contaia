"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Lista de empresas de la cuenta "Utilitarios RTP" con EDICIÓN: si se registró
// una empresa con el RUC o la razón social equivocados, se corrige aquí (o se
// elimina). Cambiar el RUC sigue las mismas reglas que el alta.
interface Empresa { id: string; razonSocial: string; ruc: string; solUser: string }

export default function EmpresasRtp({ empresas }: { empresas: Empresa[] }) {
  const router = useRouter();
  const [editando, setEditando] = useState<Empresa | null>(null);
  const [form, setForm] = useState({ razonSocial: "", ruc: "", solUser: "" });
  const [busy, setBusy] = useState<"" | "guardar" | "ruc" | "borrar">("");
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const abrir = (e: Empresa) => { setEditando(e); setForm({ razonSocial: e.razonSocial, ruc: e.ruc, solUser: e.solUser }); setError(null); setAviso(null); };

  async function consultarRuc() {
    if (!/^\d{11}$/.test(form.ruc)) { setError("El RUC debe tener 11 dígitos."); return; }
    setBusy("ruc"); setError(null);
    try {
      const r = await fetch(`/api/sunat/${form.ruc}`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.sunat?.razonSocial) { setError(d.error ?? "No se encontró ese RUC en SUNAT."); return; }
      setForm((f) => ({ ...f, razonSocial: d.sunat.razonSocial }));
    } catch { setError("Error de red al consultar el RUC."); } finally { setBusy(""); }
  }

  async function guardar() {
    if (!editando) return;
    if (!form.razonSocial.trim()) { setError("La razón social no puede quedar vacía."); return; }
    if (!/^\d{11}$/.test(form.ruc)) { setError("El RUC debe tener 11 dígitos."); return; }
    if (form.ruc !== editando.ruc && !confirm(`¿Cambiar el RUC de ${editando.ruc} a ${form.ruc}? Los datos de SUNAT guardados del RUC anterior se borran.`)) return;
    setBusy("guardar"); setError(null);
    try {
      const r = await fetch(`/api/clientes/${editando.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ razonSocial: form.razonSocial.trim(), ruc: form.ruc }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d.error ?? "No se pudo guardar."); return; }
      if (form.solUser.trim() && form.solUser.trim() !== editando.solUser) {
        const rc = await fetch(`/api/clientes/${editando.id}/credenciales`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ solUser: form.solUser.trim() }),
        });
        if (!rc.ok) { const dc = await rc.json().catch(() => ({})); setError(dc.error ?? "Se guardó la empresa, pero no el Usuario SOL."); return; }
      }
      setAviso("✓ Empresa actualizada.");
      setEditando(null);
      router.refresh();
    } catch { setError("Error de red al guardar."); } finally { setBusy(""); }
  }

  async function eliminar(e: Empresa) {
    if (!confirm(`¿Eliminar la empresa "${e.razonSocial}" (RUC ${e.ruc})? No se puede deshacer.`)) return;
    setBusy("borrar"); setError(null);
    try {
      const r = await fetch(`/api/clientes/${e.id}`, { method: "DELETE" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d.error ?? "No se pudo eliminar."); return; }
      setEditando(null); setAviso("✓ Empresa eliminada."); router.refresh();
    } catch { setError("Error de red."); } finally { setBusy(""); }
  }

  return (
    <>
      {aviso && <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{aviso}</div>}
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr><th className="px-4 py-3">Empresa</th><th className="px-4 py-3">RUC</th><th className="px-4 py-3">Usuario SOL</th><th className="px-4 py-3 text-right">Acciones</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {empresas.map((e) => (
              <tr key={e.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium text-slate-800">{e.razonSocial}</td>
                <td className="px-4 py-3 text-slate-600">{e.ruc}</td>
                <td className="px-4 py-3 text-slate-500">{e.solUser || "—"}</td>
                <td className="px-4 py-3 text-right">
                  <button className="btn-ghost px-3 py-1 text-xs" onClick={() => abrir(e)}>✎ Editar</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editando && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/50 p-4" role="dialog" aria-modal="true" onClick={() => !busy && setEditando(null)}>
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl" onClick={(ev) => ev.stopPropagation()}>
            <h2 className="text-lg font-bold text-slate-800">Editar empresa</h2>
            <p className="mt-1 text-xs text-slate-500">Corrige el RUC, la razón social o el Usuario SOL si la empresa se registró por error.</p>
            <div className="mt-4 space-y-3">
              <div>
                <label className="label">RUC</label>
                <div className="flex gap-2">
                  <input className="input" inputMode="numeric" maxLength={11} value={form.ruc}
                    onChange={(ev) => setForm((f) => ({ ...f, ruc: ev.target.value.replace(/\D/g, "").slice(0, 11) }))} />
                  <button className="btn-ghost whitespace-nowrap text-sm" onClick={consultarRuc} disabled={!!busy} title="Trae la razón social de SUNAT">
                    {busy === "ruc" ? "Consultando…" : "Consultar SUNAT"}
                  </button>
                </div>
                {form.ruc !== editando.ruc && <p className="mt-1 text-[11px] text-amber-700">Cambiar el RUC borra los datos de SUNAT guardados del RUC anterior.</p>}
              </div>
              <div>
                <label className="label">Razón social</label>
                <input className="input" value={form.razonSocial} onChange={(ev) => setForm((f) => ({ ...f, razonSocial: ev.target.value }))} />
              </div>
              <div>
                <label className="label">Usuario SOL</label>
                <input className="input" value={form.solUser} onChange={(ev) => setForm((f) => ({ ...f, solUser: ev.target.value.toUpperCase() }))} autoComplete="off" />
              </div>
            </div>
            {error && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
            <div className="mt-5 flex flex-wrap items-center gap-2">
              <button className="btn-primary" onClick={guardar} disabled={!!busy}>{busy === "guardar" ? "Guardando…" : "Guardar cambios"}</button>
              <button className="btn-ghost" onClick={() => setEditando(null)} disabled={!!busy}>Cancelar</button>
              <button className="ml-auto text-sm font-semibold text-red-600 hover:underline disabled:opacity-50" onClick={() => eliminar(editando)} disabled={!!busy}>
                {busy === "borrar" ? "Eliminando…" : "Eliminar empresa"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
