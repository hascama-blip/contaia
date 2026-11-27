"use client";

import { useMemo, useRef, useState } from "react";
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { usePuedeDiag } from "./SupremoContext";
import type { EmpresaCaja, SedeCaja, DiaCaja } from "@/lib/cajaVirtual";

// Caja virtual → reportes por sede. Una sola sesión: se conecta con usuario y clave (la clave no
// se guarda), se elige empresa y rango de fechas, y de cada sede (cada "lupa" de la web) se bajan
// todos sus días: PDF, Excel y la carpeta de Drive. Sale UN ZIP POR SEDE, armado en el navegador
// día por día (así se ve el avance y un día que falle se puede reintentar).

const soles = (n: number) => `S/ ${Number(n || 0).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fch = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split("-").reverse().join("/") : iso);
const slug = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "sede";
const EN_PARALELO = 3;

/** Motivos de lo que no se pudo bajar, agrupados (sin la fecha ni el enlace) y con cuántos días afecta cada uno. */
function motivos(notas: string[]): [string, number][] {
  const m = new Map<string, number>();
  for (const x of notas) { const k = x.replace(/^\d{2}\/\d{2}\/\d{4} · /, "").replace(/\s*\(https?:[^)]*\)/, "").replace(/"[^"]*"/, "un archivo").replace(/\.$/, ""); m.set(k, (m.get(k) ?? 0) + 1); }
  return Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, 4);
}

interface Avance { hechos: number; total: number; archivos: number; notas: string[]; estado: "bajando" | "listo" | "error"; error?: string }

function mesAnterior(): [string, string] {
  const h = new Date(); const a = new Date(h.getFullYear(), h.getMonth() - 1, 1), b = new Date(h.getFullYear(), h.getMonth(), 0);
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return [iso(a), iso(b)];
}

export default function CajaVirtualPanel() {
  const puedeDiag = usePuedeDiag();
  const [usuario, setUsuario] = useState("");
  const [clave, setClave] = useState("");
  const [sid, setSid] = useState("");
  const [empresas, setEmpresas] = useState<EmpresaCaja[]>([]);
  const [empresa, setEmpresa] = useState("");
  const [rubro, setRubro] = useState("");
  const [[desde, hasta], setRango] = useState<[string, string]>(mesAnterior);
  const [que, setQue] = useState({ pdf: true, excel: true, drive: true });
  const [sedes, setSedes] = useState<SedeCaja[] | null>(null);
  const [avance, setAvance] = useState<Record<number, Avance>>({});
  const [busy, setBusy] = useState<"" | "conectar" | "listar" | "bajar">("");
  const [error, setError] = useState<string | null>(null);
  const [diag, setDiag] = useState<string[]>([]);
  const cancelar = useRef(false);

  const emp = empresas.find((e) => e.id === empresa);
  const rubros = emp?.rubros ?? [];
  const totalDias = useMemo(() => (sedes ?? []).reduce((a, s) => a + s.dias.length, 0), [sedes]);

  async function api(body: Record<string, unknown>): Promise<Response> {
    return fetch("/api/caja-virtual", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  }
  function vencio(d: any) { if (d?.vencida) { setSid(""); setSedes(null); } }

  async function conectar() {
    setError(null); setDiag([]); setSedes(null); setAvance({});
    if (!usuario.trim() || !clave) { setError("Escribe el usuario y la clave de la caja virtual."); return; }
    setBusy("conectar");
    try {
      const r = await api({ accion: "conectar", usuario, clave });
      const d = await r.json().catch(() => ({}));
      if (d.diag) setDiag(d.diag);
      if (!r.ok) { setError(d.error ?? "No se pudo conectar."); return; }
      setSid(d.sid); setEmpresas(d.empresas ?? []); setClave("");
      const e0 = (d.empresas ?? [])[0];
      setEmpresa(e0?.id ?? ""); setRubro(e0?.rubros?.[0]?.id ?? "");
    } catch { setError("Error de red al conectar con la caja virtual."); }
    finally { setBusy(""); }
  }

  async function listar() {
    setError(null); setSedes(null); setAvance({});
    if (!desde || !hasta || desde > hasta) { setError("Revisa el rango de fechas."); return; }
    setBusy("listar");
    try {
      const r = await api({ accion: "listar", sid, empresa, rubro, desde, hasta });
      const d = await r.json().catch(() => ({}));
      if (d.diag) setDiag(d.diag);
      if (!r.ok) { vencio(d); setError(d.error ?? "No se pudo consultar."); return; }
      setSedes(d.sedes ?? []);
    } catch { setError("Error de red al consultar la caja virtual."); }
    finally { setBusy(""); }
  }

  /** Baja todos los días de UNA sede y entrega su ZIP. */
  async function bajarSede(i: number, s: SedeCaja): Promise<boolean> {
    const archivos: Record<string, Uint8Array> = {};
    const notas: string[] = [];
    let hechos = 0, nArch = 0, fallo = "";
    const pon = (estado: Avance["estado"], error?: string) => setAvance((a) => ({ ...a, [i]: { hechos, total: s.dias.length, archivos: nArch, notas: [...notas], estado, error } }));
    pon("bajando");
    const cola = [...s.dias];
    const uno = async (d: DiaCaja) => {
      for (let intento = 0; intento < 2; intento++) {
        try {
          const r = await api({ accion: "dia", sid, empresa, rubro, dia: d, ...que });
          if (!r.ok) { const j = await r.json().catch(() => ({})); if (j.vencida) { fallo = j.error; vencio(j); return; } throw new Error(j.error ?? `HTTP ${r.status}`); }
          const z = unzipSync(new Uint8Array(await r.arrayBuffer()));
          for (const [nombre, data] of Object.entries(z)) {
            if (nombre === "_notas.txt") { for (const l of strFromU8(data).split("\n").filter(Boolean)) notas.push(`${fch(d.fecha)} · ${l}`); continue; }
            archivos[`${d.fecha}/${nombre}`] = data; nArch++;
          }
          return;
        } catch (e) {
          if (intento === 1) notas.push(`${fch(d.fecha)} · No se pudo descargar el día: ${e instanceof Error ? e.message : "error"}`);
          else await new Promise((r) => setTimeout(r, 1500));
        }
      }
    };
    await Promise.all(Array.from({ length: EN_PARALELO }, async () => {
      while (cola.length && !cancelar.current && !fallo) { const d = cola.shift()!; await uno(d); hechos++; pon("bajando"); }
    }));
    if (fallo) { pon("error", fallo); return false; }
    if (cancelar.current) { pon("error", "Cancelado."); return false; }
    // Resumen de la sede (abre en Excel) + lo que no se pudo bajar.
    const filas = [["Fecha", "Dia", "Sede", "Estado", "Total curso", "Total deuda", "Total promotor", "Total detraccion", "Total pago", "Deuda actual", "Carpeta Drive"],
      ...s.dias.map((d) => [fch(d.fecha), d.dia, d.sede, d.estado, d.totalCurso, d.totalDeuda, d.totalPromotor, d.totalDetraccion, d.totalPago, d.deudaActual, d.drive ? `https://drive.google.com/drive/folders/${d.drive}` : ""])];
    archivos["00-RESUMEN.csv"] = strToU8("﻿" + filas.map((f) => f.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\r\n"));
    if (notas.length) archivos["00-PENDIENTES.txt"] = strToU8(`Lo que no se pudo descargar de ${s.sede}:\r\n\r\n${notas.join("\r\n")}\r\n`);
    const blob = new Blob([zipSync(archivos, { level: 0 }) as unknown as BlobPart], { type: "application/zip" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `caja-virtual-${slug(emp?.nombre ?? "")}-${slug(s.sede)}-${s.periodo.replace("/", "-")}.zip`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    pon("listo");
    return true;
  }

  async function bajar(indices: number[]) {
    if (!sedes) return;
    setError(null); cancelar.current = false; setBusy("bajar");
    try { for (const i of indices) { if (cancelar.current) break; if (!(await bajarSede(i, sedes[i]))) break; } }
    finally { setBusy(""); }
  }

  async function cerrar() { if (sid) await api({ accion: "cerrar", sid }).catch(() => null); setSid(""); setEmpresas([]); setSedes(null); setAvance({}); setDiag([]); }

  return (
    <div className="space-y-4">
      {/* 1 · Conexión */}
      <section className="card p-5">
        <h2 className="font-semibold text-slate-800">1 · Conectar a la caja virtual</h2>
        {!sid ? (
          <>
            <p className="mt-1 text-xs text-slate-500">Usa tu usuario y clave de cajavirtualvip.com. La clave <b>no se guarda</b>: solo abre la sesión (dura unos 30 minutos sin uso).</p>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <div><label className="label">Usuario</label><input className="input" value={usuario} onChange={(e) => setUsuario(e.target.value)} autoComplete="off" /></div>
              <div><label className="label">Clave</label><input className="input" type="password" value={clave} onChange={(e) => setClave(e.target.value)} onKeyDown={(e) => e.key === "Enter" && conectar()} autoComplete="new-password" /></div>
              <button className="btn-primary" onClick={conectar} disabled={!!busy}>{busy === "conectar" ? "Conectando…" : "Conectar"}</button>
            </div>
          </>
        ) : (
          <div className="mt-2 flex flex-wrap items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-sm text-emerald-800">
            <span className="mr-auto">🔒 Sesión abierta como <b>{usuario}</b> · {empresas.length} empresa(s) disponibles.</span>
            <button className="btn-ghost py-1.5 text-xs" onClick={cerrar} disabled={!!busy}>Cerrar sesión</button>
          </div>
        )}
      </section>

      {/* 2 · Qué bajar */}
      {sid && (
        <section className="card p-5">
          <h2 className="font-semibold text-slate-800">2 · Empresa y fechas</h2>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <div>
              <label className="label">Empresa</label>
              <select className="input" value={empresa} onChange={(e) => { setEmpresa(e.target.value); setRubro(empresas.find((x) => x.id === e.target.value)?.rubros[0]?.id ?? ""); setSedes(null); }}>
                {empresas.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
              </select>
            </div>
            {rubros.length > 1 && (
              <div>
                <label className="label">Rubro</label>
                <select className="input" value={rubro} onChange={(e) => { setRubro(e.target.value); setSedes(null); }}>
                  {rubros.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
                </select>
              </div>
            )}
            <div><label className="label">Desde</label><input className="input" type="date" value={desde} onChange={(e) => setRango([e.target.value, hasta])} /></div>
            <div><label className="label">Hasta</label><input className="input" type="date" value={hasta} onChange={(e) => setRango([desde, e.target.value])} /></div>
            <button className="btn-primary" onClick={listar} disabled={!!busy || !empresa}>{busy === "listar" ? "Consultando…" : "🔎 Buscar sedes y días"}</button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-slate-600">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">De cada día:</span>
            {([["pdf", "PDF del reporte"], ["excel", "Excel del reporte"], ["drive", "Carpeta de Drive"]] as const).map(([k, etq]) => (
              <label key={k} className="flex items-center gap-2"><input type="checkbox" checked={que[k]} onChange={(e) => setQue((q) => ({ ...q, [k]: e.target.checked }))} disabled={busy === "bajar"} /> {etq}</label>
            ))}
          </div>
        </section>
      )}

      {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}

      {/* 3 · Sedes y descarga */}
      {sedes && (
        <section className="card p-5">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="mr-auto font-semibold text-slate-800">3 · {sedes.length} sede(s) · {totalDias} día(s)</h2>
            {busy === "bajar"
              ? <button className="btn-ghost text-sm" onClick={() => { cancelar.current = true; }}>Detener</button>
              : sedes.length > 0 && <button className="btn-primary text-sm" onClick={() => bajar(sedes.map((_, i) => i))} disabled={!!busy || !(que.pdf || que.excel || que.drive)}>⬇ Descargar todas las sedes (un ZIP por sede)</button>}
          </div>
          {!sedes.length ? <p className="mt-3 text-sm text-slate-500">No hay ingresos en ese rango para esta empresa.</p> : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full whitespace-nowrap text-sm">
                <thead><tr className="text-left text-[11px] uppercase text-slate-400">
                  <th className="px-2 py-1">Sede</th><th className="px-2 py-1">Responsable</th><th className="px-2 py-1">Periodo</th><th className="px-2 py-1 text-right">Días</th>
                  <th className="px-2 py-1 text-right">Total curso</th><th className="px-2 py-1 text-right">Total pago</th><th className="px-2 py-1 text-right">Deuda actual</th><th className="px-2 py-1">Descarga</th>
                </tr></thead>
                <tbody>
                  {sedes.map((s, i) => {
                    const a = avance[i];
                    return (
                      <tr key={`${s.sede}|${s.periodo}|${i}`} className="border-t border-slate-100 align-top">
                        <td className="px-2 py-1.5 font-semibold text-slate-800">{s.sede}</td><td className="px-2 py-1.5 text-slate-600">{s.responsable}</td><td className="px-2 py-1.5 text-slate-600">{s.periodo}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{s.dias.length}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{soles(s.totalCurso)}</td><td className="px-2 py-1.5 text-right tabular-nums text-brand-700">{soles(s.totalPago)}</td>
                        <td className={`px-2 py-1.5 text-right tabular-nums ${s.deudaActual ? "text-red-600" : "text-slate-400"}`}>{soles(s.deudaActual)}</td>
                        <td className="whitespace-normal px-2 py-1.5">
                          {!a ? <button className="text-xs font-semibold text-brand-600 hover:underline disabled:opacity-40" disabled={!!busy || !s.dias.length} onClick={() => bajar([i])}>⬇ Descargar esta sede</button>
                            : a.estado === "bajando" ? <span className="text-xs text-amber-700">Bajando día {Math.min(a.hechos + 1, a.total)} de {a.total}… ({a.archivos} archivos)</span>
                            : a.estado === "listo" ? (
                              <span className="text-xs text-emerald-700">✓ ZIP descargado · {a.archivos} archivos
                                {a.notas.length > 0 && (
                                  <span className="mt-0.5 block text-amber-700">
                                    {a.notas.length} pendiente(s) (detalle en 00-PENDIENTES.txt):
                                    {motivos(a.notas).map(([m, n]) => <span key={m} className="block">· {n} día(s): {m}</span>)}
                                  </span>
                                )}
                              </span>
                            )
                            : <span className="text-xs text-red-600">{a.error ?? "No se completó."} <button className="font-semibold underline" disabled={!!busy} onClick={() => bajar([i])}>Reintentar</button></span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-3 text-xs text-slate-500">
            Cada ZIP trae una carpeta por día (AAAA-MM-DD) con el PDF y el Excel del reporte y una subcarpeta <b>drive</b> con lo que subió la sede, más
            <b> 00-RESUMEN.csv</b> con los totales de cada día. Si el navegador pregunta, permite las descargas múltiples de este sitio.
          </p>
        </section>
      )}

      {puedeDiag && diag.length > 0 && <pre className="max-h-72 overflow-auto rounded-lg bg-slate-900 p-3 text-[11px] text-slate-100">{diag.join("\n")}</pre>}
    </div>
  );
}
