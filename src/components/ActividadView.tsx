"use client";

import { useMemo, useState } from "react";
import type { AccionAuditoria } from "@/lib/types";

const AREA_COLOR: Record<string, string> = {
  "Buzón": "bg-sky-100 text-sky-700",
  "Fraccionamiento F36": "bg-amber-100 text-amber-700",
  "Credenciales": "bg-violet-100 text-violet-700",
  "Cliente": "bg-emerald-100 text-emerald-700",
  "Declaración mensual": "bg-indigo-100 text-indigo-700",
  "Declaración anual": "bg-indigo-100 text-indigo-700",
  "SIRE": "bg-teal-100 text-teal-700",
};

function fmt(iso: string) {
  try {
    return new Date(iso).toLocaleString("es-PE", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso;
  }
}

export default function ActividadView({ acciones }: { acciones: AccionAuditoria[] }) {
  const [fUsuario, setFUsuario] = useState("");
  const [fArea, setFArea] = useState("");
  const [q, setQ] = useState("");

  const usuarios = useMemo(
    () => Array.from(new Set(acciones.map((a) => a.usuarioNombre))).sort(),
    [acciones]
  );
  const areas = useMemo(
    () => Array.from(new Set(acciones.map((a) => a.area))).sort(),
    [acciones]
  );

  const filtradas = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return acciones.filter((a) => {
      if (fUsuario && a.usuarioNombre !== fUsuario) return false;
      if (fArea && a.area !== fArea) return false;
      if (needle) {
        const hay = `${a.accion} ${a.clienteNombre ?? ""} ${a.detalle ?? ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [acciones, fUsuario, fArea, q]);

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-end gap-3 p-4">
        <div>
          <label className="text-xs font-semibold text-slate-600">Trabajador</label>
          <select
            className="mt-1 w-44 rounded-lg border border-slate-300 px-2 py-2 text-sm outline-none focus:border-brand-500"
            value={fUsuario}
            onChange={(e) => setFUsuario(e.target.value)}
          >
            <option value="">Todos</option>
            {usuarios.map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-600">Sección</label>
          <select
            className="mt-1 w-48 rounded-lg border border-slate-300 px-2 py-2 text-sm outline-none focus:border-brand-500"
            value={fArea}
            onChange={(e) => setFArea(e.target.value)}
          >
            <option value="">Todas</option>
            {areas.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>
        <div className="flex-1 min-w-[180px]">
          <label className="text-xs font-semibold text-slate-600">Buscar</label>
          <input
            className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm outline-none focus:border-brand-500"
            placeholder="Empresa, acción o detalle…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <span className="ml-auto text-xs text-slate-400">{filtradas.length} de {acciones.length} registro(s)</span>
      </div>

      {filtradas.length === 0 ? (
        <div className="card p-6 text-sm text-slate-500">No hay acciones registradas con esos filtros.</div>
      ) : (
        <div className="card overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-400">
                <tr>
                  <th className="px-4 py-2 whitespace-nowrap">Fecha y hora</th>
                  <th className="px-4 py-2">Trabajador</th>
                  <th className="px-4 py-2">Sección</th>
                  <th className="px-4 py-2">Acción</th>
                  <th className="px-4 py-2">Empresa</th>
                  <th className="px-4 py-2">Detalle</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtradas.map((a) => (
                  <tr key={a.id} className="align-top">
                    <td className="whitespace-nowrap px-4 py-2 text-slate-500">{fmt(a.at)}</td>
                    <td className="whitespace-nowrap px-4 py-2">
                      <span className="font-medium text-slate-700">{a.usuarioNombre}</span>
                      {a.rol === "operador" && <span className="ml-1 text-[10px] text-slate-400">· operador</span>}
                    </td>
                    <td className="px-4 py-2">
                      <span className={`badge ${AREA_COLOR[a.area] ?? "bg-slate-100 text-slate-600"}`}>{a.area}</span>
                    </td>
                    <td className="px-4 py-2 text-slate-700">{a.accion}</td>
                    <td className="px-4 py-2 text-slate-600">{a.clienteNombre ?? "—"}</td>
                    <td className="px-4 py-2 text-slate-400">{a.detalle ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
