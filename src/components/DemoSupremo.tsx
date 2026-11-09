"use client";

import { useEffect, useState } from "react";

// Panel del supremo: crea / elimina las EMPRESAS DE SIMULACIÓN (datos ficticios en
// todos los módulos, para demos y videos de publicidad). Nunca consultan SUNAT.
export default function DemoSupremo() {
  const [n, setN] = useState<number | null>(null);
  const [grabacion, setGrabacion] = useState<string | null>(null); // activo hasta (ISO)
  const [ocultas, setOcultas] = useState(0);
  const [busy, setBusy] = useState<"" | "crear" | "borrar" | "grabacion">("");
  const [msg, setMsg] = useState<string | null>(null);

  const cargar = () => fetch("/api/supremo/demo").then((r) => r.json()).then((d) => { setN(d.empresas ?? 0); setGrabacion(d.grabacionHasta ?? null); setOcultas(d.ocultas ?? 0); }).catch(() => {});

  async function modoGrabacion(activar: boolean) {
    setBusy("grabacion"); setMsg(null);
    try {
      const r = await fetch("/api/supremo/demo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accion: "grabacion", activar }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(d.error ?? "No se pudo cambiar el modo grabación."); return; }
      setGrabacion(d.grabacionHasta ?? null);
      setMsg(activar ? "✓ Modo grabación activo: en Clientes, Dashboard y selectores solo se ven las empresas de simulación." : "✓ Modo grabación desactivado: vuelven a verse todas tus empresas.");
    } catch {
      setMsg("Error de red.");
    } finally {
      setBusy("");
    }
  }
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
      <div className={`mt-3 flex flex-wrap items-center gap-2 rounded-lg border p-3 ${grabacion ? "border-red-300 bg-red-50" : "border-slate-200 bg-white"}`}>
        <div className="mr-auto min-w-[14rem] flex-1 text-xs text-slate-600">
          <b className="text-slate-800">🎬 Modo grabación</b> — oculta tus empresas reales ({ocultas}) en Clientes, Dashboard, buscador,
          notificaciones y selectores de los módulos; solo quedan las de simulación. No borra nada y se desactiva solo a las 12 horas.
          {grabacion && <div className="mt-1 font-semibold text-red-700">Activo hasta las {new Date(grabacion).toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" })} ({new Date(grabacion).toLocaleDateString("es-PE")}).</div>}
        </div>
        {grabacion ? (
          <button className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50" onClick={() => modoGrabacion(false)} disabled={!!busy}>
            {busy === "grabacion" ? "…" : "■ Desactivar modo grabación"}
          </button>
        ) : (
          <button className="rounded-lg border border-red-300 px-3 py-1.5 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50" onClick={() => modoGrabacion(true)} disabled={!!busy || !n}
            title={!n ? "Primero crea las empresas de simulación" : ""}>
            {busy === "grabacion" ? "…" : "● Activar modo grabación"}
          </button>
        )}
      </div>
      {msg && <p className="mt-2 text-xs text-slate-700">{msg}</p>}
    </div>
  );
}
