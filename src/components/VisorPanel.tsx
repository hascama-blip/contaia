"use client";

import { useEffect, useState, useCallback } from "react";

interface Matriz {
  empresa: string; ruc: string; tipo: string;
  celdas: Record<string, "P" | "NP">; anios: Record<string, "P" | "NP">; at: string;
}

const TIPO_LABEL: Record<string, string> = { sire: "SIRE", "dj-mensual": "DJ mensual", "dj-anual": "DJ anual" };
const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Set", "Oct", "Nov", "Dic"];

export default function VisorPanel() {
  const [token, setToken] = useState<string>("");
  const [matriz, setMatriz] = useState<Matriz[]>([]);
  const [cargando, setCargando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const [t, c] = await Promise.all([
        fetch("/api/visor/token").then((r) => r.json()).catch(() => ({})),
        fetch("/api/visor/capturas").then((r) => r.json()).catch(() => ({})),
      ]);
      if (t?.token) setToken(t.token);
      if (Array.isArray(c?.matriz)) setMatriz(c.matriz);
    } finally { setCargando(false); }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  async function limpiar() {
    if (!confirm("¿Borrar el cuadro capturado?")) return;
    await fetch("/api/visor/capturas", { method: "DELETE" });
    cargar();
  }
  async function rotar() {
    if (!confirm("Al regenerar el token, la extensión ya instalada dejará de enviar. Tendrás que descargarla de nuevo. ¿Continuar?")) return;
    const r = await fetch("/api/visor/token", { method: "POST" }).then((x) => x.json()).catch(() => ({}));
    if (r?.token) setToken(r.token);
  }

  return (
    <div className="space-y-5">
      {/* Instalación */}
      <section className="card p-5">
        <h3 className="font-semibold text-slate-800">🧩 Extensión del navegador</h3>
        <p className="mt-1 text-xs text-slate-500">
          Descarga la extensión (ya trae tu token). Instálala una vez y, mientras navegas SUNAT
          normalmente (con tu login), captura los datos del <b>SIRE</b>, <b>DJ mensual</b> y
          <b> DJ anual</b> y los envía aquí. Evita captcha y bloqueo de IP (usas tu propia sesión).
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <a className="btn-primary" href="/api/visor/descargar">⬇ Descargar extensión (ZIP)</a>
          <button className="btn-ghost" onClick={cargar} disabled={cargando}>{cargando ? "Actualizando…" : "↻ Actualizar"}</button>
          {matriz.length > 0 && <a className="btn-accent" href="/herramientas/visor/reporte" target="_blank" rel="noopener noreferrer">📄 Reporte (PDF)</a>}
          {matriz.length > 0 && <a className="btn-ghost" href="/api/visor/reporte">⬇ Excel</a>}
        </div>
        <ol className="mt-3 list-decimal space-y-0.5 pl-5 text-[11px] text-slate-500">
          <li>Descomprime el ZIP en una carpeta.</li>
          <li>Ve a <code>chrome://extensions</code> (o <code>edge://extensions</code>) y activa <b>Modo de desarrollador</b>.</li>
          <li><b>Cargar descomprimida</b> → elige la carpeta.</li>
          <li>Inicia sesión en SUNAT y abre el SIRE / DJ. Las capturas aparecen abajo.</li>
        </ol>
        <div className="mt-3 flex items-center gap-2 text-[11px] text-slate-400">
          <span>Token: <code className="rounded bg-slate-100 px-1">{token ? token.slice(0, 6) + "…" + token.slice(-4) : "—"}</code></span>
          <button className="text-brand-600 hover:underline" onClick={rotar}>Regenerar</button>
        </div>
      </section>

      {/* Cuadros año×mes */}
      <section className="card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-semibold text-slate-800">Cuadro capturado</h3>
          {matriz.length > 0 && <button className="text-xs text-red-600 hover:underline" onClick={limpiar}>Borrar todo</button>}
        </div>
        {matriz.length === 0 ? (
          <p className="text-sm text-slate-500">Aún no llega nada. Instala la extensión y navega el SIRE / DJ en SUNAT (elige año por año para que se llene el cuadro).</p>
        ) : (
          <div className="space-y-6">
            {matriz.map((m, i) => <Cuadro key={i} m={m} />)}
          </div>
        )}
      </section>
    </div>
  );
}

function Cuadro({ m }: { m: Matriz }) {
  const anios = Array.from(new Set([...Object.keys(m.celdas).map((k) => k.slice(0, 4)), ...Object.keys(m.anios)])).sort();
  return (
    <div>
      <p className="mb-1 text-sm font-semibold text-slate-800">
        {TIPO_LABEL[m.tipo] ?? m.tipo} <span className="font-normal text-slate-400">· {m.empresa || m.ruc || "—"}{m.ruc ? ` · RUC ${m.ruc}` : ""}</span>
      </p>
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-center text-[11px]">
          <thead className="bg-slate-50 text-slate-500">
            <tr><th className="px-2 py-1.5 text-left">Año</th>{MESES.map((mm) => <th key={mm} className="px-2 py-1.5">{mm}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {anios.map((y) => (
              <tr key={y}>
                <td className="px-2 py-1.5 text-left font-medium text-slate-700">{y}</td>
                {Array.from({ length: 12 }, (_, k) => {
                  const e = m.celdas[`${y}-${String(k + 1).padStart(2, "0")}`];
                  return (
                    <td key={k} className={`px-2 py-1.5 ${e === "NP" ? "bg-red-50 font-semibold text-red-700" : e === "P" ? "bg-emerald-50 text-emerald-700" : "text-slate-300"}`}>
                      {e === "NP" ? "No" : e === "P" ? "Sí" : "·"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
