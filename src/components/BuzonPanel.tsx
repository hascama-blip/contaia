"use client";

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import { getSolPass } from "@/lib/solSession";
import BuzonSeguimientoCell, { type Seguimiento } from "./BuzonSeguimientoCell";

interface Mensaje {
  id: string;
  fecha: string;
  asunto: string;
  tipo: string;
  nivel: "peligroso" | "urgente" | "otro";
  origen?: "notificaciones" | "mensajes";
  adjuntos?: number;
}

// Buzón del detalle del cliente (Reporte analítico). Igual al de Consultas
// tributarias (tabla + plazo/comentario, persistencia, límite 1/día) pero SIN
// descarga de PDF: solo el texto de los mensajes.
export default function BuzonPanel({
  clienteId,
  solUserGuardado,
  yaConsultado,
}: {
  clienteId: string;
  solUserGuardado: string;
  yaConsultado?: boolean;
}) {
  const [mensajes, setMensajes] = useState<Mensaje[] | null>(null);
  const [consultadoAt, setConsultadoAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [diagModo, setDiagModo] = useState(false);
  const [diag, setDiag] = useState<string | null>(null);
  const [segs, setSegs] = useState<Record<string, Seguimiento>>({});
  const [guardandoSeg, setGuardandoSeg] = useState<string | null>(null);

  const cargarGuardados = useCallback(async () => {
    try {
      const res = await fetch(`/api/consultas/buzon?clienteId=${encodeURIComponent(clienteId)}`);
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        const msgs: Mensaje[] = data.mensajes ?? [];
        setMensajes(msgs.length ? msgs : null);
        setConsultadoAt(data.consultadoAt ?? null);
      }
    } catch { /* */ }
  }, [clienteId]);

  const cargarSeguimientos = useCallback(async () => {
    try {
      const res = await fetch(`/api/consultas/buzon/seguimiento?clienteId=${encodeURIComponent(clienteId)}`);
      const data = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(data.seguimientos)) {
        const map: Record<string, Seguimiento> = {};
        for (const s of data.seguimientos) map[s.codMensaje] = s;
        setSegs(map);
      }
    } catch { /* */ }
  }, [clienteId]);

  useEffect(() => { cargarGuardados(); cargarSeguimientos(); }, [cargarGuardados, cargarSeguimientos]);

  async function extraer() {
    setError(null); setDiag(null);
    const solUser = solUserGuardado;
    const solPass = getSolPass(clienteId);
    if (!solUser || !solPass) { setError("Carga tus accesos SOL (arriba) para consultar."); return; }
    setBusy(true); setInfo("Conectando al portal SOL y leyendo el buzón…");
    try {
      const res = await fetch("/api/consultas/buzon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clienteId, solUser, solPass, dias: 30, diagnostico: diagModo }),
      });
      const data = await res.json().catch(() => ({}));
      if (diagModo) { setDiag(JSON.stringify(data, null, 2)); setInfo(null); return; }
      if (!res.ok) { setError(data.error ?? "No se pudo leer el buzón."); return; }
      setMensajes(data.mensajes ?? []);
      if (data.limitado) {
        setConsultadoAt(data.consultadoAt ?? null);
        setInfo(data.mensaje ?? "El buzón ya se consultó hoy (límite 1 vez al día).");
      } else {
        setConsultadoAt(new Date().toISOString());
        setInfo(`Se encontraron ${data.mensajes?.length ?? 0} mensaje(s). Quedaron guardados.`);
      }
    } catch {
      setError("Se cortó la conexión con SUNAT. Intenta de nuevo.");
    } finally { setBusy(false); }
  }

  async function guardarSeguimiento(m: Mensaje, diasAtencion: number, comentario: string) {
    setGuardandoSeg(m.id);
    try {
      const res = await fetch("/api/consultas/buzon/seguimiento", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clienteId, codMensaje: m.id, asunto: m.asunto, fecha: m.fecha, origen: m.origen, diasAtencion, comentario }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.seguimiento) {
        setSegs((prev) => ({ ...prev, [m.id]: data.seguimiento }));
        setInfo("Seguimiento guardado.");
      } else {
        setError(data.error ?? "No se pudo guardar el seguimiento.");
      }
    } finally { setGuardandoSeg(null); }
  }

  return (
    <section className="card p-5">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="font-semibold text-slate-800">📨 Buzón electrónico</h3>
        {yaConsultado && (
          <Link href={`/clientes/${clienteId}/buzon`} className="text-xs text-brand-600 hover:underline">
            Ver notificaciones (PDF)
          </Link>
        )}
      </div>
      <p className="mb-3 text-xs text-slate-500">
        Últimos 6 de <b>Notificaciones</b> y 6 de <b>Mensajes</b>. Usa los accesos SOL cargados.
        Se puede actualizar 1 vez al día.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-primary" onClick={extraer} disabled={busy}>
          {busy ? "Consultando…" : mensajes ? "Actualizar buzón" : "Consultar buzón"}
        </button>
        <label className="flex items-center gap-2 text-xs text-slate-500">
          <input type="checkbox" checked={diagModo} onChange={(e) => setDiagModo(e.target.checked)} />
          Modo diagnóstico
        </label>
        {consultadoAt && <span className="text-xs text-slate-400">Última consulta: {new Date(consultadoAt).toLocaleString("es-PE")}</span>}
      </div>

      {info && <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">{info}</div>}
      {error && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
      {diag && <pre className="mt-3 max-h-72 overflow-auto rounded-lg bg-slate-900 p-3 text-[11px] text-slate-100">{diag}</pre>}

      {mensajes && mensajes.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-400">
              <tr>
                <th className="px-3 py-2">Módulo</th>
                <th className="px-3 py-2">Fecha</th>
                <th className="px-3 py-2">Categoría</th>
                <th className="px-3 py-2">Asunto</th>
                <th className="px-3 py-2">Atención / comentario</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {mensajes.map((m) => (
                <tr key={m.id}>
                  <td className="whitespace-nowrap px-3 py-2">
                    <span className={`badge ${m.origen === "mensajes" ? "bg-violet-100 text-violet-700" : "bg-sky-100 text-sky-700"}`}>
                      {m.origen === "mensajes" ? "Mensajes" : "Notificaciones"}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-500">{m.fecha}</td>
                  <td className="px-3 py-2">
                    {m.nivel === "otro" ? (
                      <span className="text-xs text-slate-400">Informativa</span>
                    ) : (
                      <span className={`badge ${m.nivel === "peligroso" ? "bg-red-100 text-red-700" : "bg-orange-100 text-orange-700"}`}>
                        {m.tipo || "—"}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-slate-700">{m.asunto}</td>
                  <td className="px-3 py-2">
                    <BuzonSeguimientoCell
                      codMensaje={m.id}
                      inicial={segs[m.id]}
                      guardando={guardandoSeg === m.id}
                      onGuardar={(dias, comentario) => guardarSeguimiento(m, dias, comentario)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
