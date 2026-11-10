"use client";

import { useEffect, useState } from "react";

interface Pago {
  id: string; userNombre: string; userEmail: string; plan: string; montoCentimos: number; lanzamiento: boolean;
  proveedor: string; estado: string; prueba?: boolean; referencia?: string; detalle?: string; creadoAt: string; pagadoAt?: string; vigenteHasta?: string;
}
interface Empresa { id: string; nombre: string; email: string; planVence: string | null; limites: { generaciones?: number; comprobantes?: number } | null }
interface Datos {
  pasarela: string | null; falta: string[]; modoPrueba?: boolean;
  lanzamiento: { cupos: number; usados: number; restantes: number };
  totalCentimos: number; pagos: Pago[]; empresas: Empresa[];
}

const soles = (c: number) => `S/ ${(c / 100).toFixed(2)}`;
const fmt = (iso?: string) => (iso ? new Date(iso).toLocaleString("es-PE", { dateStyle: "short", timeStyle: "short" }) : "—");

// Panel del supremo: pagos de planes por la pasarela, cupos de lanzamiento y
// los límites pactados de las cuentas del Plan Empresas.
export default function PagosSupremo() {
  const [d, setD] = useState<Datos | null>(null);
  const [verTodos, setVerTodos] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [edit, setEdit] = useState<Record<string, { generaciones: string; comprobantes: string }>>({});

  const cargar = () => fetch("/api/supremo/pagos", { cache: "no-store" }).then((r) => r.json()).then(setD).catch(() => {});
  useEffect(() => { cargar(); }, []);

  async function guardarLimites(e: Empresa) {
    const v = edit[e.id] ?? { generaciones: "", comprobantes: "" };
    const res = await fetch("/api/supremo/pagos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: e.id, ...v }) });
    const r = await res.json().catch(() => ({}));
    setMsg(res.ok ? `Límites guardados para ${e.nombre}.` : r.error ?? "No se pudo guardar.");
    cargar();
  }

  if (!d) return null;
  const pagos = verTodos ? d.pagos : d.pagos.filter((p) => p.estado === "pagado");

  return (
    <div className="card space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-slate-800">💳 Pagos de planes</h2>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${d.pasarela ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
          {d.pasarela ? `Pasarela activa: ${d.pasarela}${d.modoPrueba ? " · MODO PRUEBA (claves de test): solo pagan las cuentas de PAGOS_PRUEBA_CORREOS; el resto ve WhatsApp" : " · producción"}` : `Pasarela sin configurar (falta ${d.falta.join(", ")})`}
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg bg-slate-50 p-3 text-sm"><p className="text-xs text-slate-500">Cobrado real (últimos 100)</p><p className="text-lg font-bold text-slate-800">{soles(d.totalCentimos)}</p></div>
        <div className="rounded-lg bg-slate-50 p-3 text-sm"><p className="text-xs text-slate-500">Precio de lanzamiento usado</p><p className="text-lg font-bold text-slate-800">{d.lanzamiento.usados} de {d.lanzamiento.cupos}</p></div>
        <div className="rounded-lg bg-slate-50 p-3 text-sm"><p className="text-xs text-slate-500">Cupos de lanzamiento libres</p><p className="text-lg font-bold text-slate-800">{d.lanzamiento.restantes}</p></div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-semibold text-slate-700">{verTodos ? "Todos los intentos" : "Pagos confirmados"}</p>
          <label className="flex items-center gap-2 text-xs text-slate-500">
            <input type="checkbox" checked={verTodos} onChange={(e) => setVerTodos(e.target.checked)} /> Ver pendientes y rechazados
          </label>
        </div>
        {pagos.length === 0 ? (
          <p className="text-sm text-slate-400">Aún no hay pagos.</p>
        ) : (
          <div className="max-h-80 overflow-auto rounded-lg border border-slate-200">
            <table className="min-w-full text-xs">
              <thead className="sticky top-0 bg-slate-50 text-[11px] uppercase text-slate-500">
                <tr><th className="px-2 py-1.5 text-left">Fecha</th><th className="px-2 py-1.5 text-left">Cuenta</th><th className="px-2 py-1.5 text-left">Plan</th><th className="px-2 py-1.5 text-right">Monto</th><th className="px-2 py-1.5 text-left">Estado</th><th className="px-2 py-1.5 text-left">Vigente hasta</th><th className="px-2 py-1.5 text-left">Ref.</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pagos.map((p) => (
                  <tr key={p.id}>
                    <td className="px-2 py-1 whitespace-nowrap">{fmt(p.pagadoAt ?? p.creadoAt)}</td>
                    <td className="px-2 py-1">{p.userNombre}<div className="text-[10px] text-slate-400">{p.userEmail}</div></td>
                    <td className="px-2 py-1">{p.plan}{p.lanzamiento && <span className="ml-1 rounded bg-emerald-100 px-1 text-[9px] font-bold text-emerald-700">−50%</span>}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{soles(p.montoCentimos)}</td>
                    <td className="px-2 py-1" title={p.detalle}>{p.estado}{p.prueba && <span className="ml-1 rounded bg-amber-100 px-1 text-[9px] font-bold text-amber-700">PRUEBA</span>}</td>
                    <td className="px-2 py-1">{p.vigenteHasta ?? "—"}</td>
                    <td className="px-2 py-1 text-[10px] text-slate-400">{p.proveedor} {p.referencia ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div>
        <p className="text-sm font-semibold text-slate-700">Plan Empresas · límites pactados</p>
        <p className="mb-2 text-[11px] text-slate-500">
          Generaciones por paso y empresa al mes, y comprobantes de la Descarga masiva al mes. <b>0</b> = sin límite; vacío = por defecto (sin límite).
          El plan y su vencimiento se asignan arriba, en la cuenta.
        </p>
        {d.empresas.length === 0 ? (
          <p className="text-sm text-slate-400">Ninguna cuenta tiene el Plan Empresas.</p>
        ) : (
          <div className="space-y-2">
            {d.empresas.map((e) => {
              const v = edit[e.id] ?? { generaciones: e.limites?.generaciones?.toString() ?? "", comprobantes: e.limites?.comprobantes?.toString() ?? "" };
              const set = (k: "generaciones" | "comprobantes", val: string) => setEdit((p) => ({ ...p, [e.id]: { ...v, [k]: val } }));
              return (
                <div key={e.id} className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 p-2 text-xs">
                  <div className="min-w-[180px] flex-1"><p className="font-semibold text-slate-700">{e.nombre}</p><p className="text-slate-400">{e.email} · vence {e.planVence ?? "sin fecha"}</p></div>
                  <label>Generaciones<input type="number" min={0} className="input mt-0.5 w-24 py-1 text-xs" value={v.generaciones} onChange={(x) => set("generaciones", x.target.value)} /></label>
                  <label>Comprobantes<input type="number" min={0} className="input mt-0.5 w-28 py-1 text-xs" value={v.comprobantes} onChange={(x) => set("comprobantes", x.target.value)} /></label>
                  <button className="btn-primary py-1 text-xs" onClick={() => guardarLimites(e)}>Guardar</button>
                </div>
              );
            })}
          </div>
        )}
        {msg && <p className="mt-2 text-xs text-slate-600">{msg}</p>}
      </div>
    </div>
  );
}
