"use client";

import { useEffect, useState } from "react";
import AccesosSol from "./AccesosSol";
import { getSolPass, getSolUser } from "@/lib/solSession";

interface ClienteMin { id: string; razonSocial: string; ruc: string; solUser: string }

const LABEL: Record<string, string> = {
  creado: "Solicitado",
  pendiente: "Encolado",
  en_proceso: "Generando en SOL / esperando correo",
  recibido: "Correo recibido",
  listo: "Listo para descargar",
  error: "Error",
};
const COLOR: Record<string, string> = {
  creado: "bg-slate-100 text-slate-600",
  pendiente: "bg-sky-100 text-sky-700",
  en_proceso: "bg-amber-100 text-amber-800",
  recibido: "bg-indigo-100 text-indigo-700",
  listo: "bg-emerald-100 text-emerald-700",
  error: "bg-red-100 text-red-700",
};

export default function RttPanel({ clientes }: { clientes: ClienteMin[] }) {
  const [id, setId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [diagModo, setDiagModo] = useState(false);
  const [diag, setDiag] = useState<string | null>(null);
  const [solicitudes, setSolicitudes] = useState<any[]>([]);
  const [webhookLog, setWebhookLog] = useState<any[]>([]);
  const [dominio, setDominio] = useState<string>("");
  const [revisadoAt, setRevisadoAt] = useState<string>("");
  const [refrescando, setRefrescando] = useState(false);
  const sel = clientes.find((c) => c.id === id) ?? null;

  async function cargar() {
    setRefrescando(true);
    try {
      const res = await fetch("/api/rtt", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) { setSolicitudes(data.solicitudes ?? []); setWebhookLog(data.webhookLog ?? []); setDominio(data.dominio ?? ""); }
      setRevisadoAt(new Date().toLocaleTimeString("es-PE"));
    } catch { /* */ } finally { setRefrescando(false); }
  }

  useEffect(() => { cargar(); }, []);
  // Auto-refresco mientras haya generaciones en curso (esperando el correo).
  useEffect(() => {
    const enProceso = solicitudes.some((s) => ["creado", "pendiente", "en_proceso", "recibido"].includes(s.estado));
    if (!enProceso) return;
    const t = setInterval(cargar, 15000);
    return () => clearInterval(t);
  }, [solicitudes]);

  async function solicitar() {
    setError(null); setInfo(null); setDiag(null);
    if (!sel) { setError("Elige la empresa con la que inicias sesión en SOL."); return; }
    const solPass = getSolPass(sel.id);
    const solUser = getSolUser(sel.id, sel.solUser);
    if (!solPass) { setError("Carga tu Clave SOL (arriba)."); return; }
    const ruc = sel.ruc.replace(/\D/g, "");
    if (!/^\d{11}$/.test(ruc)) { setError("La empresa no tiene un RUC válido."); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/rtt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ruc, rucLogin: sel.ruc, solUser, solPass, razonSocial: sel.razonSocial, diagnostico: diagModo }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.diag) setDiag(JSON.stringify(data.diag, null, 2));
      if (!res.ok) { setError(data.error ?? "No se pudo generar el reporte."); await cargar(); return; }
      setInfo(diagModo ? "Diagnóstico listo (revisa la traza cruda abajo)." : "Generación enviada. SUNAT procesa y envía el reporte por correo; aquí lo verás listo para descargar en cuanto llegue.");
      await cargar();
    } catch {
      setError("Error de red al generar el reporte.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="card p-5">
        <h2 className="mb-1 font-semibold text-slate-800">Generar Reporte Tributario para Terceros</h2>
        <p className="mb-4 text-xs text-slate-400">
          Elige la empresa: el bot inicia sesión con su <strong>Clave SOL</strong>, genera su Reporte Tributario
          para Terceros y SUNAT lo envía por correo; un <strong>webhook</strong> lo captura automáticamente y aquí
          lo descargas. No revisas el correo a mano.
        </p>
        <label className="label">Empresa (acceso SOL)</label>
        {clientes.length === 0 ? (
          <p className="text-sm text-slate-500">No tienes empresas. <a href="/clientes/nuevo" className="text-brand-600 hover:underline">Crea una →</a></p>
        ) : (
          <select className="input max-w-lg" value={id} onChange={(e) => setId(e.target.value)}>
            <option value="">— Elige una empresa —</option>
            {clientes.map((c) => <option key={c.id} value={c.id}>{c.razonSocial} · RUC {c.ruc}</option>)}
          </select>
        )}
        {sel && (
          <div className="mt-4 space-y-3">
            <AccesosSol clienteId={sel.id} solUserGuardado={sel.solUser} />
            <div className="flex flex-wrap items-center gap-3">
              <button className="btn-primary" onClick={solicitar} disabled={busy}>
                {busy ? "Generando…" : "📄 Generar Reporte Tributario"}
              </button>
              <label className="flex items-center gap-2 text-xs text-slate-500">
                <input type="checkbox" checked={diagModo} onChange={(e) => setDiagModo(e.target.checked)} /> Modo diagnóstico
              </label>
            </div>
          </div>
        )}
        {info && <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">{info}</div>}
        {error && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
        {diag && <pre className="mt-3 max-h-96 overflow-auto rounded-lg bg-slate-900 p-3 text-[11px] text-slate-100">{diag}</pre>}
      </div>

      {/* Generación de Reporte Tributario: info + descarga */}
      <div className="card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold text-slate-800">Generación de Reporte Tributario</h2>
          <button className="btn-ghost text-sm" onClick={cargar} disabled={refrescando}>
            {refrescando ? "Actualizando…" : "↻ Actualizar"}
          </button>
        </div>
        {solicitudes.filter((s) => s.estado !== "error").length === 0 ? (
          <p className="text-sm text-slate-400">Aún no has generado ningún reporte. Elige una empresa y pulsa “Generar Reporte Tributario”.</p>
        ) : (
          <div className="space-y-3">
            {solicitudes.filter((s) => s.estado !== "error").map((s) => {
              const listo = s.estado === "listo";
              const enCurso = ["creado", "pendiente", "en_proceso", "recibido"].includes(s.estado);
              return (
                <div key={s.id} className={`rounded-lg border p-3 ${listo ? "border-emerald-200 bg-emerald-50/40" : s.estado === "error" ? "border-red-200 bg-red-50/40" : "border-slate-200"}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="font-semibold text-slate-700">{s.razonSocial || `RUC ${s.ruc}`}</span>
                      <span className="ml-2 text-xs text-slate-400">RUC {s.ruc}</span>
                    </div>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${COLOR[s.estado] ?? "bg-slate-100"}`}>
                      {LABEL[s.estado] ?? s.estado}
                    </span>
                  </div>

                  {/* Información de la generación */}
                  <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-slate-500 sm:grid-cols-3">
                    <div><dt className="inline text-slate-400">Solicitado: </dt><dd className="inline">{new Date(s.creadoEn).toLocaleString("es-PE")}</dd></div>
                    {s.actualizadoEn && <div><dt className="inline text-slate-400">Actualizado: </dt><dd className="inline">{new Date(s.actualizadoEn).toLocaleString("es-PE")}</dd></div>}
                    <div><dt className="inline text-slate-400">Correo: </dt><dd className="inline break-all">{s.emailDestino}</dd></div>
                  </dl>

                  {s.estado === "error" && (
                    <div className="mt-2 rounded bg-red-50 px-2 py-1 text-xs text-red-600">⚠ {s.error ?? "Error en la generación"}</div>
                  )}
                  {listo && (
                    <div className="mt-2 flex gap-2">
                      <a className="btn-primary text-sm" href={`/api/rtt/${s.id}/archivo?tipo=pdf`}>⬇ Descargar PDF</a>
                      {s.rutaXml && <a className="btn-ghost text-sm" href={`/api/rtt/${s.id}/archivo?tipo=xml`}>⬇ Descargar XML</a>}
                    </div>
                  )}
                  {enCurso && (
                    <p className="mt-2 text-[11px] text-slate-400">⏳ SUNAT está procesando el reporte; llega por correo y aquí queda listo para descargar. Esta vista se actualiza sola.</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Verificación del webhook: últimos correos recibidos */}
      <div className="card p-5">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="font-semibold text-slate-800">Webhook de correo — verificación</h2>
          <span className={`badge ${dominio ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"}`}>
            {dominio ? `Dominio: ${dominio}` : "Falta configurar RTT_DOMINIO"}
          </span>
        </div>
        <p className="mb-3 text-xs text-slate-400">
          Aquí aparece <strong>cada correo que llega al webhook</strong> (el PDF/XML de SUNAT). Sirve para verificar
          que la cadena MX → SendGrid → webhook está funcionando.
        </p>
        {webhookLog.length === 0 ? (
          <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">
            Aún no ha llegado ningún correo al webhook.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-xs">
              <thead className="bg-slate-50">
                <tr className="text-left text-[10px] uppercase text-slate-400">
                  <th className="px-2 py-1">Hora</th><th className="px-2 py-1">RUC</th><th className="px-2 py-1">PDF</th><th className="px-2 py-1">XML</th><th className="px-2 py-1">Resultado</th>
                </tr>
              </thead>
              <tbody>
                {webhookLog.map((e: any, i: number) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="px-2 py-1 text-slate-500">{new Date(e.at).toLocaleString("es-PE")}</td>
                    <td className="px-2 py-1 font-medium text-slate-700">{e.ruc || "—"}</td>
                    <td className="px-2 py-1">{e.tienePdf ? "✓" : "—"}</td>
                    <td className="px-2 py-1">{e.tieneXml ? "✓" : "—"}</td>
                    <td className={`px-2 py-1 ${/OK/.test(e.resultado) ? "text-emerald-700" : "text-amber-700"}`}>{e.resultado}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button className="btn-ghost text-sm" onClick={cargar} disabled={refrescando}>
            {refrescando ? "Revisando…" : "↻ Actualizar"}
          </button>
          {revisadoAt && (
            <span className="text-[11px] text-slate-400">
              Revisado {revisadoAt} · {webhookLog.length} evento(s)
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
