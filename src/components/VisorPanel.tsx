"use client";

import { useEffect, useState, useCallback } from "react";

interface Captura {
  id: string; at: string; url: string; titulo: string; tipo: string; resumen?: string; tieneDatos?: boolean;
}

const TIPO_BADGE: Record<string, { txt: string; cls: string }> = {
  sire: { txt: "SIRE", cls: "bg-blue-100 text-blue-700" },
  "dj-mensual": { txt: "DJ mensual", cls: "bg-amber-100 text-amber-700" },
  "dj-anual": { txt: "DJ anual", cls: "bg-purple-100 text-purple-700" },
  otro: { txt: "Otro", cls: "bg-slate-100 text-slate-500" },
};

export default function VisorPanel() {
  const [token, setToken] = useState<string>("");
  const [capturas, setCapturas] = useState<Captura[]>([]);
  const [cargando, setCargando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const [t, c] = await Promise.all([
        fetch("/api/visor/token").then((r) => r.json()).catch(() => ({})),
        fetch("/api/visor/capturas").then((r) => r.json()).catch(() => ({})),
      ]);
      if (t?.token) setToken(t.token);
      if (Array.isArray(c?.capturas)) setCapturas(c.capturas);
    } finally { setCargando(false); }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  async function limpiar() {
    if (!confirm("¿Borrar todas las capturas recibidas?")) return;
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
          <button className="btn-ghost" onClick={cargar} disabled={cargando}>{cargando ? "Actualizando…" : "↻ Actualizar capturas"}</button>
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

      {/* Capturas */}
      <section className="card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-semibold text-slate-800">Capturas recibidas ({capturas.length})</h3>
          {capturas.length > 0 && <button className="text-xs text-red-600 hover:underline" onClick={limpiar}>Borrar todo</button>}
        </div>
        {capturas.length === 0 ? (
          <p className="text-sm text-slate-500">Aún no llegan capturas. Instala la extensión y navega el SIRE / DJ en SUNAT.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-[11px] uppercase text-slate-400">
                <tr><th className="px-3 py-2">Fecha</th><th className="px-3 py-2">Tipo</th><th className="px-3 py-2">Hallazgo</th><th className="px-3 py-2">Página</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {capturas.map((c) => {
                  const b = TIPO_BADGE[c.tipo] ?? TIPO_BADGE.otro;
                  return (
                    <tr key={c.id}>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-500">{new Date(c.at).toLocaleString("es-PE")}</td>
                      <td className="px-3 py-2"><span className={`badge ${b.cls}`}>{b.txt}</span></td>
                      <td className="px-3 py-2 text-slate-700">{c.resumen || "—"} {c.tieneDatos && <span className="text-[10px] text-emerald-600">· datos</span>}</td>
                      <td className="px-3 py-2 text-[11px] text-slate-400">{c.titulo || c.url}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
