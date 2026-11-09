"use client";

import { useEffect, useState } from "react";

// Panel del supremo: crea / elimina las EMPRESAS DE SIMULACIÓN (datos ficticios en
// todos los módulos, para demos y videos de publicidad). Nunca consultan SUNAT.
export default function DemoSupremo({ supremo = true }: { supremo?: boolean }) {
  const [n, setN] = useState<number | null>(null);
  const [grabacion, setGrabacion] = useState<string | null>(null); // activo hasta (ISO)
  const [ocultas, setOcultas] = useState(0);
  const [busy, setBusy] = useState<"" | "crear" | "borrar" | "grabacion">("");
  const [msg, setMsg] = useState<string | null>(null);

  const cargar = () => fetch("/api/demo").then((r) => r.json()).then((d) => { setN(d.empresas ?? 0); setGrabacion(d.grabacionHasta ?? null); setOcultas(d.ocultas ?? 0); }).catch(() => {});

  async function modoGrabacion(activar: boolean) {
    setBusy("grabacion"); setMsg(null);
    try {
      const r = await fetch("/api/demo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accion: "grabacion", activar }) });
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
      const r = await fetch("/api/demo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accion: a }) });
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
      {supremo && <AccesoDemo />}
    </div>
  );
}

// Solo supremo: habilitar el modo simulación a otra cuenta (por correo). Le asigna
// el plan Empresas (todos los módulos salvo los utilitarios) y puede crear sus
// propias empresas de simulación y usar el modo grabación desde "Modo simulación".
function AccesoDemo() {
  const [cuentas, setCuentas] = useState<{ id: string; nombre: string; email: string; plan?: string }[]>([]);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { fetch("/api/supremo/demo-acceso").then((r) => r.json()).then((d) => setCuentas(d.cuentas ?? [])).catch(() => {}); }, []);
  async function cambiar(correo: string, activar: boolean) {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/supremo/demo-acceso", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: correo, activar }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(d.error ?? "No se pudo."); return; }
      setCuentas(d.cuentas ?? []);
      setMsg(activar ? `✓ ${d.cuenta.nombre} ya tiene el modo simulación y el plan Empresas.` : `✓ Se quitó el modo simulación a ${d.cuenta.nombre}.`);
      if (activar) setEmail("");
    } catch { setMsg("Error de red."); } finally { setBusy(false); }
  }
  return (
    <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
      <p className="text-xs text-slate-600">
        <b className="text-slate-800">Dar acceso a otra cuenta</b> — podrá crear sus propias empresas de simulación y usar el modo
        grabación (en su menú: “Modo simulación”). Se le asigna el <b>plan Empresas</b> (todos los módulos, sin utilitarios). La cuenta
        debe estar registrada.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input className="input w-72 py-1.5 text-sm" placeholder="correo@ejemplo.com" value={email} onChange={(e) => setEmail(e.target.value.trim())} />
        <button className="rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50" disabled={busy || !email} onClick={() => cambiar(email, true)}>
          {busy ? "…" : "Dar acceso"}
        </button>
      </div>
      {cuentas.length > 0 && (
        <ul className="mt-2 divide-y divide-slate-100 text-xs">
          {cuentas.map((c) => (
            <li key={c.id} className="flex items-center gap-2 py-1.5">
              <span className="mr-auto text-slate-700"><b>{c.nombre}</b> · {c.email} {c.plan && <span className="text-slate-400">· plan {c.plan === "equipo" ? "Empresas" : c.plan}</span>}</span>
              <button className="text-red-600 hover:underline disabled:opacity-50" disabled={busy} onClick={() => cambiar(c.email, false)}>Quitar acceso</button>
            </li>
          ))}
        </ul>
      )}
      {msg && <p className="mt-2 text-xs text-slate-700">{msg}</p>}
    </div>
  );
}
