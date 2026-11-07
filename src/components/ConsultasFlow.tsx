"use client";

import { useEffect, useState, useCallback } from "react";
import { getSolPass, setSolPass as setSolPassSesion } from "@/lib/solSession";
import BuzonSeguimientoCell, { type Seguimiento } from "./BuzonSeguimientoCell";
import { usePuedeDiag } from "./SupremoContext";
import CuposEmpresa from "./CuposEmpresa";

interface ClienteOpt {
  id: string;
  razonSocial: string;
  ruc: string;
  solUser: string;
}
interface Mensaje {
  id: string;
  fecha: string;
  asunto: string;
  tipo: string;
  nivel: "peligroso" | "urgente" | "otro";
  origen?: "notificaciones" | "mensajes";
  adjuntos?: number;
}

export default function ConsultasFlow({ clientes }: { clientes: ClienteOpt[] }) {
  const [clienteId, setClienteId] = useState(clientes[0]?.id ?? "");
  const [solUser, setSolUser] = useState(clientes[0]?.solUser ?? "");
  const [solPass, setSolPass] = useState("");
  const [mensajes, setMensajes] = useState<Mensaje[] | null>(null);
  const [consultadoAt, setConsultadoAt] = useState<string | null>(null);
  const [cacheados, setCacheados] = useState<Set<string>>(new Set());
  // Por codMensaje: última descarga del PDF (fecha + quién).
  const [descargas, setDescargas] = useState<Record<string, { at: string; por?: string }>>({});
  const [busy, setBusy] = useState(false);
  const [bajando, setBajando] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [modoDiag, setModoDiag] = useState(false);
  const [diag, setDiag] = useState<string | null>(null);
  // Seguimientos guardados por mensaje (plazo de atención + comentario).
  const [segs, setSegs] = useState<Record<string, Seguimiento>>({});
  const [guardandoSeg, setGuardandoSeg] = useState<string | null>(null);
  // Ids de mensajes que llegaron NUEVOS en la última actualización (se resaltan).
  const [nuevos, setNuevos] = useState<Set<string>>(new Set());
  const [probando, setProbando] = useState<string | null>(null);

  const puedeDiag = usePuedeDiag();
  const cliente = clientes.find((c) => c.id === clienteId);

  const cargarSeguimientos = useCallback(async (id: string) => {
    if (!id) return;
    try {
      const res = await fetch(`/api/consultas/buzon/seguimiento?clienteId=${encodeURIComponent(id)}`);
      const data = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(data.seguimientos)) {
        const map: Record<string, Seguimiento> = {};
        for (const s of data.seguimientos) map[s.codMensaje] = s;
        setSegs(map);
      }
    } catch { /* */ }
  }, []);

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

  // Carga lo YA GUARDADO (sin clave): mensajes + qué PDFs están en caché.
  const cargarGuardados = useCallback(async (id: string) => {
    if (!id) return;
    try {
      const res = await fetch(`/api/consultas/buzon?clienteId=${encodeURIComponent(id)}`);
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        const msgs: Mensaje[] = data.mensajes ?? [];
        setMensajes(msgs.length ? msgs : null);
        setConsultadoAt(data.consultadoAt ?? null);
        setCacheados(new Set<string>(data.cacheados ?? []));
        setDescargas(data.descargas ?? {});
        if (msgs.length) setInfo(`Mostrando ${msgs.length} mensaje(s) guardado(s)${data.consultadoAt ? "" : ""}. Usa “Actualizar” para traer lo último.`);
      }
    } catch {
      /* sin guardados */
    }
  }, []);

  useEffect(() => {
    cargarGuardados(clienteId);
    cargarSeguimientos(clienteId);
    setSolPass(getSolPass(clienteId)); // recordar la Clave SOL de la sesión
  }, [clienteId, cargarGuardados, cargarSeguimientos]);
  useEffect(() => { if (solPass) setSolPassSesion(clienteId, solPass); }, [clienteId, solPass]);

  function elegir(id: string) {
    setClienteId(id);
    setSolUser(clientes.find((c) => c.id === id)?.solUser ?? "");
    setMensajes(null);
    setCacheados(new Set());
    setDescargas({});
    setInfo(null);
    setError(null);
  }

  async function extraer() {
    if (!clienteId) return setError("Elige una empresa.");
    if (!solPass) return setError("Ingresa la Clave SOL.");
    setBusy(true); setError(null); setInfo("Conectando al portal SOL y leyendo el buzón…");
    try {
      const res = await fetch("/api/consultas/buzon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clienteId, solUser, solPass, dias: 30 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? "No se pudo leer el buzón."); return; }
      const lista: Mensaje[] = data.mensajes ?? [];
      setMensajes(lista);
      if (Array.isArray(data.cacheados)) setCacheados(new Set<string>(data.cacheados));
      if (data.limitado) {
        setConsultadoAt(data.consultadoAt ?? null);
        setInfo(data.mensaje ?? "El buzón ya se consultó hoy (límite 1 vez al día).");
      } else {
        setConsultadoAt(new Date().toISOString());
        const nuevosIds: string[] = Array.isArray(data.nuevos) ? data.nuevos : [];
        setNuevos(new Set(nuevosIds));
        setInfo(`Se leyeron ${data.leidos ?? lista.length} mensaje(s): ${nuevosIds.length} nuevo(s). Historial guardado: ${lista.length}.`);
        // Descarga AUTOMÁTICA del PDF de los mensajes nuevos (queda guardado
        // para abrirlo al instante y para enviarlo por Telegram/correo).
        const pendientes = lista.filter((m) => nuevosIds.includes(m.id) && m.adjuntos !== 0 && !cacheados.has(m.id)).slice(0, 10);
        for (let i = 0; i < pendientes.length; i++) {
          setInfo(`Descargando PDF ${i + 1}/${pendientes.length} de los mensajes nuevos…`);
          await guardarPdfSilencioso(pendientes[i]);
        }
        if (pendientes.length) setInfo(`Listo: ${nuevosIds.length} mensaje(s) nuevo(s) y ${pendientes.length} PDF guardado(s). Historial: ${lista.length}.`);
      }
    } catch {
      setError("Se cortó la conexión con SUNAT. Intenta de nuevo.");
    } finally { setBusy(false); }
  }

  // Baja el PDF al servidor (caché) sin abrirlo en el navegador.
  async function guardarPdfSilencioso(m: Mensaje) {
    try {
      const res = await fetch("/api/consultas/buzon/adjunto", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clienteId, solUser, solPass, codMensaje: m.id, asunto: m.asunto, fecha: m.fecha, origen: m.origen, adjuntos: m.adjuntos }),
      });
      if (res.ok) {
        setCacheados((prev) => new Set(prev).add(m.id));
        setDescargas((prev) => ({ ...prev, [m.id]: { at: new Date().toISOString(), por: "automático" } }));
      }
    } catch { /* se podrá bajar a mano */ }
  }

  // SOLO SUPREMO: simula que este mensaje "acaba de llegar" y envía la alerta a
  // sus propios canales (Telegram/correo) con el PDF adjunto.
  async function probarEnvio(m: Mensaje) {
    setProbando(m.id); setError(null); setInfo(`Enviando prueba de “${m.asunto.slice(0, 50)}”…`);
    try {
      const res = await fetch("/api/consultas/buzon/probar-envio", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clienteId, codMensaje: m.id, solUser, solPass }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setError(d.error ?? "No se pudo enviar la prueba."); return; }
      const canales = [d.telegram ? "Telegram ✅" : d.telegram === false ? "Telegram ❌" : null, d.email ? "correo ✅" : d.email === false ? "correo ❌" : null].filter(Boolean).join(" · ");
      const adj = d.adjunto
        ? `PDF “${d.adjunto.nombre}” (${d.adjunto.kb} KB, ${d.adjunto.origen === "cache" ? "desde lo guardado" : "descargado de SUNAT"}) → Telegram ${d.adjunto.telegram ? "✅" : "—"} · correo ${d.adjunto.email ? "✅" : "—"}`
        : `sin PDF (${d.errorAdjunto ?? "no disponible"})`;
      const extra = [...(d.avisos ?? []), ...(d.errores ?? [])].join(" · ");
      setInfo(`Prueba enviada: ${canales || "ningún canal activo"} · Adjunto: ${adj}${extra ? ` · ${extra}` : ""}`);
      if (d.adjunto) setCacheados((prev) => new Set(prev).add(m.id));
    } catch { setError("Error de red al probar el envío."); }
    finally { setProbando(null); }
  }

  async function descargarPdf(m: Mensaje, forzar = false) {
    setBajando(m.id); setError(null); setDiag(null);
    try {
      const res = await fetch("/api/consultas/buzon/adjunto", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clienteId, solUser, solPass, codMensaje: m.id, asunto: m.asunto, fecha: m.fecha, origen: m.origen, adjuntos: m.adjuntos, diagnostico: modoDiag, forzar }),
      });
      if (modoDiag) {
        const data = await res.json().catch(() => ({}));
        setDiag(JSON.stringify(data, null, 2));
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "No se pudo descargar el PDF de ese mensaje.");
        if (data.diag) setDiag(JSON.stringify(data.diag, null, 2));
        return;
      }
      const desdeCache = res.headers.get("X-Desde-Cache") === "1";
      const descAt = res.headers.get("X-Descarga-At");
      const descPor = res.headers.get("X-Descarga-Por");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(m.asunto || "adjunto").slice(0, 40).replace(/[^\w\s-]/g, "")}.pdf`;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
      setCacheados((prev) => new Set(prev).add(m.id)); // ahora queda guardado
      // Registrar la última descarga (fecha + quién) para mostrarla en la fila.
      setDescargas((prev) => ({
        ...prev,
        [m.id]: { at: descAt ?? new Date().toISOString(), por: descPor ? decodeURIComponent(descPor) : prev[m.id]?.por },
      }));
      setInfo(desdeCache ? "PDF abierto desde lo guardado (sin reingresar a SUNAT)." : "PDF descargado y guardado para próximas veces.");
    } finally { setBajando(null); }
  }

  function fmtDescarga(d?: { at: string; por?: string }) {
    if (!d?.at) return null;
    let cuando = d.at;
    try { cuando = new Date(d.at).toLocaleString("es-PE", { dateStyle: "short", timeStyle: "short" }); } catch { /* */ }
    return `${cuando}${d.por ? ` · ${d.por}` : ""}`;
  }

  return (
    <div className="space-y-5">
      {info && <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">{info}</div>}
      {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
      {diag && (
        <div className="rounded-lg border border-slate-200 bg-slate-900 p-3">
          <p className="mb-1 text-xs font-semibold text-slate-300">Diagnóstico (cópialo y pásamelo para calibrar la descarga):</p>
          <pre className="max-h-80 overflow-auto text-[11px] leading-relaxed text-emerald-300">{diag}</pre>
        </div>
      )}

      {clientes.length === 0 ? (
        <div className="card p-6 text-sm text-slate-500">
          Aún no tienes empresas. Crea una en “+ Nuevo cliente” para usar las consultas.
        </div>
      ) : (
        <section className="card p-5">
          <h2 className="mb-3 font-bold text-slate-800">Buzón electrónico</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="text-xs font-semibold text-slate-600">Empresa</label>
              <select
                className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm outline-none focus:border-brand-500"
                value={clienteId}
                onChange={(e) => elegir(e.target.value)}
              >
                {clientes.map((c) => (
                  <option key={c.id} value={c.id}>{c.razonSocial} ({c.ruc})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600">Usuario SOL</label>
              <input
                className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm outline-none focus:border-brand-500"
                value={solUser}
                onChange={(e) => setSolUser(e.target.value)}
                placeholder="Usuario SOL"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600">Clave SOL</label>
              <input
                type="password"
                className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm outline-none focus:border-brand-500"
                value={solPass}
                onChange={(e) => setSolPass(e.target.value)}
                placeholder="Solo para traer/actualizar"
              />
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button className="btn-primary" onClick={extraer} disabled={busy}>
              {busy ? "Extrayendo…" : mensajes ? "🔄 Actualizar buzón" : "📨 Extraer buzón"}
            </button>
            {puedeDiag && (
              <label className="flex items-center gap-2 text-xs text-slate-500">
                <input type="checkbox" checked={modoDiag} onChange={(e) => setModoDiag(e.target.checked)} />
                Modo diagnóstico
              </label>
            )}
          </div>
          <p className="mt-2 text-xs text-slate-400">
            Los mensajes y los PDF que descargues quedan <b>guardados</b>: la próxima vez se abren al
            instante, sin volver a ingresar la Clave SOL. La Clave SOL nunca se guarda.
          </p>
          {clienteId && <div className="mt-3"><CuposEmpresa clienteId={clienteId} pasos={["buzon"]} /></div>}
        </section>
      )}

      {mensajes && (
        <section className="card overflow-hidden p-0">
          <div className="border-b border-slate-100 px-4 py-3">
            <h2 className="font-bold text-slate-800">Mensajes del buzón</h2>
            <p className="text-xs text-slate-400">
              <b>Historial acumulado</b>: {mensajes.length} mensaje(s) · cada actualización agrega solo los nuevos
              {nuevos.size ? <> · <span className="font-semibold text-emerald-700">{nuevos.size} nuevo(s) ahora</span></> : null}
              {consultadoAt ? ` · última actualización ${new Date(consultadoAt).toLocaleString("es-PE")}` : ""}
              {" "}· 📄 el PDF de los nuevos se guarda automáticamente (verde = guardado).
            </p>
          </div>
          {mensajes.length === 0 ? (
            <p className="px-4 py-6 text-sm text-slate-400">Sin mensajes en el periodo.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-400">
                <tr>
                  <th className="px-4 py-2">Módulo</th>
                  <th className="px-4 py-2">Fecha</th>
                  <th className="px-4 py-2">Categoría</th>
                  <th className="px-4 py-2">Asunto</th>
                  <th className="px-4 py-2 text-center">PDF</th>
                  <th className="px-4 py-2">Atención / comentario</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {mensajes.map((m) => {
                  const guardado = cacheados.has(m.id);
                  return (
                    <tr key={m.id} className={nuevos.has(m.id) ? "bg-emerald-50/60" : ""}>
                      <td className="whitespace-nowrap px-4 py-2">
                        <span className={`badge ${m.origen === "mensajes" ? "bg-violet-100 text-violet-700" : "bg-sky-100 text-sky-700"}`}>
                          {m.origen === "mensajes" ? "Mensajes" : "Notificaciones"}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 text-slate-500">{m.fecha}</td>
                      <td className="px-4 py-2">
                        {m.nivel === "otro" ? (
                          <span className="text-xs text-slate-400">Informativa</span>
                        ) : (
                          <span className={`badge ${m.nivel === "peligroso" ? "bg-red-100 text-red-700" : "bg-orange-100 text-orange-700"}`}>
                            {m.tipo || "—"}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-slate-700">
                        {nuevos.has(m.id) && <span className="mr-1.5 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">NUEVO</span>}
                        {m.asunto}
                        {puedeDiag && (
                          <button
                            onClick={() => probarEnvio(m)}
                            disabled={probando !== null || busy}
                            title="Solo supremo: simula que este mensaje acaba de llegar y envía la alerta (con el PDF) a tu Telegram/correo"
                            className="ml-2 rounded-md border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700 hover:bg-violet-100 disabled:opacity-50"
                          >
                            {probando === m.id ? "Enviando…" : "🧪 Probar envío"}
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-2 text-center">
                        <div className="inline-flex items-center gap-1">
                          <button
                            onClick={() => descargarPdf(m)}
                            disabled={bajando !== null}
                            title={guardado ? "Abrir PDF guardado (sin reingresar a SUNAT)" : "Descargar PDF adjunto"}
                            className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs disabled:opacity-50 ${
                              guardado
                                ? "border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                                : "border-slate-200 text-red-600 hover:bg-red-50"
                            }`}
                          >
                            {bajando === m.id ? "…" : guardado ? "✓ PDF" : "📄 PDF"}
                          </button>
                          {guardado && (
                            <button
                              onClick={() => descargarPdf(m, true)}
                              disabled={bajando !== null}
                              title="Volver a descargar desde SUNAT (ignora lo guardado)"
                              className="rounded-lg border border-slate-200 px-1.5 py-1 text-xs text-slate-500 hover:bg-slate-50 disabled:opacity-50"
                            >
                              ↻
                            </button>
                          )}
                        </div>
                        {descargas[m.id] && (
                          <p className="mt-1 text-[10px] leading-tight text-slate-400" title="Última descarga del PDF">
                            ⬇ {fmtDescarga(descargas[m.id])}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        <BuzonSeguimientoCell
                          codMensaje={m.id}
                          inicial={segs[m.id]}
                          guardando={guardandoSeg === m.id}
                          onGuardar={(dias, comentario) => guardarSeguimiento(m, dias, comentario)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      )}
    </div>
  );
}
