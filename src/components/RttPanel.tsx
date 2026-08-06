"use client";

import { useEffect, useState } from "react";
import AccesosSol from "./AccesosSol";
import { getSolPass, getSolUser } from "@/lib/solSession";

interface ClienteMin { id: string; razonSocial: string; ruc: string; solUser: string }

const PASOS = [
  { estado: "creado", label: "Solicitado" },
  { estado: "pendiente", label: "Encolado" },
  { estado: "en_proceso", label: "Generando en SOL / esperando correo" },
  { estado: "recibido", label: "Correo recibido" },
  { estado: "listo", label: "Listo para descargar" },
];
const COLOR: Record<string, string> = {
  creado: "bg-slate-100 text-slate-600",
  pendiente: "bg-sky-100 text-sky-700",
  en_proceso: "bg-amber-100 text-amber-800",
  recibido: "bg-indigo-100 text-indigo-700",
  listo: "bg-emerald-100 text-emerald-700",
  error: "bg-red-100 text-red-700",
};
const orden = (e: string) => PASOS.findIndex((p) => p.estado === e);

export default function RttPanel({ clientes }: { clientes: ClienteMin[] }) {
  const [id, setId] = useState("");
  const [terceroRuc, setTerceroRuc] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
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

  async function probarWebhook() {
    setRefrescando(true);
    try {
      await fetch("/api/rtt/probar-webhook", { method: "POST" });
      await cargar();
    } finally { setRefrescando(false); }
  }
  useEffect(() => { cargar(); }, []);
  // Auto-refresco mientras haya solicitudes en proceso (esperando el correo).
  useEffect(() => {
    const enProceso = solicitudes.some((s) => ["creado", "pendiente", "en_proceso", "recibido"].includes(s.estado));
    if (!enProceso) return;
    const t = setInterval(cargar, 15000);
    return () => clearInterval(t);
  }, [solicitudes]);

  async function solicitar() {
    setError(null); setInfo(null);
    if (!sel) { setError("Elige la empresa con la que inicias sesión en SOL."); return; }
    const solPass = getSolPass(sel.id);
    const solUser = getSolUser(sel.id, sel.solUser);
    if (!solPass) { setError("Carga tu Clave SOL (arriba)."); return; }
    const ruc = (terceroRuc || sel.ruc).replace(/\D/g, "");
    if (!/^\d{11}$/.test(ruc)) { setError("RUC a reportar inválido (11 dígitos)."); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/rtt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ruc, rucLogin: sel.ruc, solUser, solPass, razonSocial: ruc === sel.ruc ? sel.razonSocial : undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? "No se pudo solicitar el RTT."); await cargar(); return; }
      setInfo("Solicitud enviada. SUNAT procesará y enviará el reporte por correo; aquí verás cuándo esté listo.");
      await cargar();
    } catch {
      setError("Error de red al solicitar el RTT.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="card p-5">
        <h2 className="mb-1 font-semibold text-slate-800">Solicitar Reporte Tributario para Terceros</h2>
        <p className="mb-4 text-xs text-slate-400">
          Elige la empresa con cuya <strong>Clave SOL</strong> se inicia sesión y el <strong>RUC a reportar</strong>
          (puede ser un tercero). El bot dispara la generación en SOL; SUNAT envía el PDF/XML por correo y un
          <strong> webhook</strong> lo captura automáticamente. No revisas el correo a mano.
        </p>
        <label className="label">Empresa (acceso SOL)</label>
        {clientes.length === 0 ? (
          <p className="text-sm text-slate-500">No tienes empresas. <a href="/clientes/nuevo" className="text-brand-600 hover:underline">Crea una →</a></p>
        ) : (
          <select className="input max-w-lg" value={id} onChange={(e) => { setId(e.target.value); setTerceroRuc(""); }}>
            <option value="">— Elige una empresa —</option>
            {clientes.map((c) => <option key={c.id} value={c.id}>{c.razonSocial} · RUC {c.ruc}</option>)}
          </select>
        )}
        {sel && (
          <div className="mt-4 space-y-3">
            <AccesosSol clienteId={sel.id} solUserGuardado={sel.solUser} />
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="label">RUC a reportar</label>
                <input className="input w-52" placeholder={sel.ruc} value={terceroRuc} onChange={(e) => setTerceroRuc(e.target.value.replace(/\D/g, "").slice(0, 11))} />
                <p className="mt-1 text-[10px] text-slate-400">Vacío = el RUC de la propia empresa.</p>
              </div>
              <button className="btn-primary" onClick={solicitar} disabled={busy}>
                {busy ? "Solicitando…" : "📄 Solicitar RTT"}
              </button>
            </div>
          </div>
        )}
        {info && <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">{info}</div>}
        {error && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
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
          Aquí aparece <strong>cada correo que llega al webhook</strong>. Para probar, envía un correo con un PDF
          adjunto a <code className="rounded bg-slate-100 px-1">reportes+RUC20512737456@{dominio || "reportes.tudominio.com"}</code> —
          si la cadena (MX → SendGrid → webhook) está bien, verás el evento abajo en segundos.
        </p>
        {webhookLog.length === 0 ? (
          <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">
            Aún no ha llegado ningún correo al webhook. Si ya enviaste uno y no aparece, revisa: MX de <code>reportes</code> → <code>mx.sendgrid.net</code>, el Inbound Parse (host + Destination URL con el secreto), y las variables en Render.
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
          <button className="btn-ghost text-sm" onClick={probarWebhook} disabled={refrescando} title="Inserta un evento de prueba para confirmar que la app funciona">
            🧪 Probar webhook
          </button>
          {revisadoAt && (
            <span className="text-[11px] text-slate-400">
              Revisado {revisadoAt} · {webhookLog.length} evento(s)
            </span>
          )}
        </div>
      </div>

      {/* Trazabilidad */}
      <div className="card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold text-slate-800">Mis solicitudes (trazabilidad)</h2>
          <button className="btn-ghost text-sm" onClick={cargar}>↻ Actualizar</button>
        </div>
        {solicitudes.length === 0 ? (
          <p className="text-sm text-slate-400">Aún no hay solicitudes.</p>
        ) : (
          <div className="space-y-3">
            {solicitudes.map((s) => (
              <div key={s.id} className="rounded-lg border border-slate-200 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="font-semibold text-slate-700">RUC {s.ruc}</span>
                    {s.razonSocial && <span className="ml-2 text-xs text-slate-400">{s.razonSocial}</span>}
                    <div className="text-[11px] text-slate-400">Solicitado: {new Date(s.creadoEn).toLocaleString("es-PE")}</div>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${COLOR[s.estado] ?? "bg-slate-100"}`}>
                    {PASOS.find((p) => p.estado === s.estado)?.label ?? s.estado}
                  </span>
                </div>

                {/* Barra de pasos */}
                <div className="mt-3 flex items-center gap-1">
                  {PASOS.map((p, i) => {
                    const done = s.estado !== "error" && orden(s.estado) >= i;
                    const cur = s.estado === p.estado;
                    return (
                      <div key={p.estado} className="flex flex-1 items-center gap-1" title={p.label}>
                        <div className={`h-2 flex-1 rounded-full ${done ? "bg-brand-500" : "bg-slate-200"} ${cur ? "ring-2 ring-brand-300" : ""}`} />
                      </div>
                    );
                  })}
                </div>
                <div className="mt-1 flex justify-between text-[9px] uppercase text-slate-400">
                  {PASOS.map((p) => <span key={p.estado}>{p.label.split(" ")[0]}</span>)}
                </div>

                {s.estado === "error" && (
                  <div className="mt-2 rounded bg-red-50 px-2 py-1 text-xs text-red-600">⚠ {s.error ?? "Error"}</div>
                )}
                {s.estado === "listo" && (
                  <div className="mt-2 flex gap-2">
                    <a className="btn-primary text-sm" href={`/api/rtt/${s.id}/archivo?tipo=pdf`}>⬇ PDF</a>
                    {s.rutaXml && <a className="btn-ghost text-sm" href={`/api/rtt/${s.id}/archivo?tipo=xml`}>⬇ XML</a>}
                  </div>
                )}
                {["en_proceso", "recibido", "pendiente", "creado"].includes(s.estado) && (
                  <p className="mt-2 text-[11px] text-slate-400">Esperando a SUNAT — el reporte llega por correo cuando SUNAT lo procesa (puede tardar). Esta vista se actualiza sola.</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
