"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

interface Recordatorio {
  clienteId: string;
  razonSocial: string;
  ruc: string;
  codMensaje: string;
  asunto: string;
  fecha: string;
  origen?: "notificaciones" | "mensajes";
  diasAtencion: number;
  comentario: string;
  fechaLimite: string;
  vencido: boolean;
  creadoPorNombre?: string;
}

function fmtDia(iso: string): string {
  try { return new Date(iso).toLocaleDateString("es-PE", { day: "2-digit", month: "2-digit", year: "numeric" }); }
  catch { return iso; }
}

// Recordatorios de buzón (Home): avisa de los mensajes con plazo de atención
// vencido o por vencer, según se guardó en Consultas tributarias.
export default function RecordatoriosBanner() {
  const [recordatorios, setRecordatorios] = useState<Recordatorio[]>([]);
  const [cargado, setCargado] = useState(false);
  const [atendiendo, setAtendiendo] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      const res = await fetch("/api/recordatorios", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setRecordatorios(data.recordatorios ?? []);
    } catch { /* */ }
    finally { setCargado(true); }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  async function atender(r: Recordatorio) {
    setAtendiendo(r.codMensaje);
    try {
      await fetch("/api/consultas/buzon/seguimiento", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clienteId: r.clienteId, codMensaje: r.codMensaje, atendido: true }),
      });
      setRecordatorios((prev) => prev.filter((x) => !(x.clienteId === r.clienteId && x.codMensaje === r.codMensaje)));
    } finally { setAtendiendo(null); }
  }

  if (!cargado || recordatorios.length === 0) return null;

  const vencidos = recordatorios.filter((r) => r.vencido);
  const porVencer = recordatorios.filter((r) => !r.vencido);

  return (
    <section className="rounded-2xl border border-amber-300 bg-amber-50 p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-bold text-amber-800">
          🔔 Recordatorios de buzón
          {vencidos.length > 0 && (
            <span className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold text-white">{vencidos.length} vencido(s)</span>
          )}
        </h2>
        <Link href="/herramientas/consultas" className="text-xs font-semibold text-brand-600 hover:underline">
          Ir a Consultas →
        </Link>
      </div>

      <ul className="space-y-2">
        {[...vencidos, ...porVencer].slice(0, 12).map((r) => (
          <li
            key={`${r.clienteId}_${r.codMensaje}`}
            className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-white px-3 py-2 text-sm ${
              r.vencido ? "border-red-200" : "border-slate-200"
            }`}
          >
            <div className="min-w-0">
              <p className="truncate font-medium text-slate-800">{r.asunto || "(sin asunto)"}</p>
              <p className="text-xs text-slate-500">
                {r.razonSocial} · {r.ruc}
                {r.comentario ? ` · “${r.comentario}”` : ""}
                {r.creadoPorNombre ? ` · por ${r.creadoPorNombre}` : ""}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className={`whitespace-nowrap text-xs ${r.vencido ? "font-semibold text-red-600" : "text-slate-500"}`}>
                {r.vencido ? "⏰ Venció" : "Vence"} {fmtDia(r.fechaLimite)} ({r.diasAtencion}d)
              </span>
              <button
                onClick={() => atender(r)}
                disabled={atendiendo === r.codMensaje}
                className="rounded-md border border-emerald-200 px-2 py-1 text-xs text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
              >
                {atendiendo === r.codMensaje ? "…" : "✓ Atendido"}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
