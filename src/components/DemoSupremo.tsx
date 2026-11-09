"use client";

import { useEffect, useState } from "react";

// Panel del supremo: crea / elimina las EMPRESAS DE SIMULACIÓN (datos ficticios en
// todos los módulos, para demos y videos de publicidad). Nunca consultan SUNAT.
export default function DemoSupremo() {
  const [n, setN] = useState<number | null>(null);
  const [busy, setBusy] = useState<"" | "crear" | "borrar">("");
  const [msg, setMsg] = useState<string | null>(null);

  const cargar = () => fetch("/api/supremo/demo").then((r) => r.json()).then((d) => setN(d.empresas ?? 0)).catch(() => {});
  useEffect(() => { cargar(); }, []);

  async function accion(a: "crear" | "borrar") {
    if (a === "borrar" && !confirm("¿Eliminar las empresas de simulación? (no afecta a tus empresas reales)")) return;
    setBusy(a); setMsg(null);
    try {
      const r = await fetch("/api/supremo/demo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accion: a }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(d.error ?? "No se pudo completar."); return; }
      setMsg(a === "crear" ? `✓ ${d.creadas} empresas de simulación listas en Clientes (con datos en todos los módulos).` : `✓ ${d.borradas} empresas de simulación eliminadas.`);
      cargar();
    } catch {
      setMsg("Error de red.");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="rounded-xl border border-violet-200 bg-violet-50/40 p-4">
      <h3 className="text-sm font-semibold text-slate-800">Modo simulación (demos y videos)</h3>
      <p className="mt-1 text-xs text-slate-500">
        Crea 4 empresas <b>ficticias</b> en tu cuenta, con información inventada en todos los módulos: ficha SUNAT, SIRE
        (resumen, detalle y presentado/no presentado), buzón, declaraciones vs SIRE, DJ anual, deudas, ITF, diagnóstico,
        dashboard, informe y Visor. Una <b>RUC 20 sana</b>, una <b>RUC 20 con riesgos</b> (omisiones, fiscalización, deudas),
        una <b>RUC 10 con negocio</b> y una <b>RUC 10 sin negocio</b>. Sus RUC no existen (dígito verificador inválido) y
        nunca consultan SUNAT. Aparecen con la etiqueta <span className="rounded bg-violet-100 px-1 font-bold text-violet-700">Simulación</span>.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button className="rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50" onClick={() => accion("crear")} disabled={!!busy}>
          {busy === "crear" ? "Creando…" : n ? "↻ Regenerar empresas de simulación" : "▶ Crear empresas de simulación"}
        </button>
        {!!n && (
          <button className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50" onClick={() => accion("borrar")} disabled={!!busy}>
            {busy === "borrar" ? "Eliminando…" : "Eliminar empresas de simulación"}
          </button>
        )}
        {n !== null && <span className="text-xs text-slate-500">{n ? `${n} activas` : "Ninguna creada"}</span>}
      </div>
      {msg && <p className="mt-2 text-xs text-slate-700">{msg}</p>}
    </div>
  );
}
