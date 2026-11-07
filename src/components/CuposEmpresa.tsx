"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

interface Estado {
  plan: string;
  limite: number | null;
  renueva: string;
  pasos: { paso: string; nombre: string; usados: number }[];
}

const PLAN_NOMBRE: Record<string, string> = { basico: "Plan Básico", regular: "Plan Regular", premium: "Plan Premium", equipo: "Plan Empresas" };

// Cupos del mes de UNA empresa: cuántas generaciones quedan por paso. Solo se
// muestra si el plan tiene límite. Se refresca solo cada 20 s (cuando la pestaña
// está visible) para reflejar lo consumido por cada paso.
export default function CuposEmpresa({ clienteId, pasos }: { clienteId: string; pasos?: string[] }) {
  const [est, setEst] = useState<Estado | null>(null);

  const cargar = useCallback(() => {
    if (!clienteId) return;
    fetch(`/api/cupos?clienteId=${encodeURIComponent(clienteId)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && Array.isArray(d.pasos)) setEst(d); })
      .catch(() => {});
  }, [clienteId]);

  useEffect(() => {
    cargar();
    const t = setInterval(() => { if (document.visibilityState === "visible") cargar(); }, 20000);
    return () => clearInterval(t);
  }, [cargar]);

  if (!est || est.limite === null) return null;
  const lista = est.pasos.filter((p) => !pasos || pasos.includes(p.paso));
  const limite = est.limite;

  return (
    <div className="card p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold text-slate-700">
          Generaciones de este mes · {PLAN_NOMBRE[est.plan] ?? est.plan}: {limite} por paso para esta empresa
        </p>
        <p className="text-[11px] text-slate-400">
          Si un paso falla no se descuenta · se renuevan el {est.renueva} ·{" "}
          <Link href="/planes" className="text-brand-600 hover:underline">ampliar</Link>
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {lista.map((p) => {
          const quedan = Math.max(0, limite - p.usados);
          const color = quedan === 0 ? "bg-red-50 text-red-700 border-red-200" : quedan === 1 ? "bg-amber-50 text-amber-700 border-amber-200" : "bg-slate-50 text-slate-600 border-slate-200";
          return (
            <span key={p.paso} className={`rounded-full border px-2 py-0.5 text-[11px] ${color}`} title={`${p.usados} de ${limite} usadas`}>
              {p.nombre}: <b>{quedan}</b>/{limite}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/** Comprobantes de la Descarga masiva usados en el mes (solo si hay tope). */
export function TopeComprobantes() {
  const [c, setC] = useState<{ usados: number; tope: number | null } | null>(null);
  useEffect(() => {
    const cargar = () =>
      fetch("/api/cupos", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (d?.comprobantes) setC(d.comprobantes); })
        .catch(() => {});
    cargar();
    const t = setInterval(() => { if (document.visibilityState === "visible") cargar(); }, 20000);
    return () => clearInterval(t);
  }, []);
  if (!c || c.tope === null) return null;
  const pct = Math.min(100, Math.round((c.usados / c.tope) * 100));
  return (
    <div className="card p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="font-semibold text-slate-700">Comprobantes de este mes: {c.usados} de {c.tope}</span>
        <span className="text-slate-400">Facturas (XML/PDF) y recibos por honorarios descargados con éxito · se renueva el día 1</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full ${pct >= 100 ? "bg-red-500" : pct >= 80 ? "bg-amber-500" : "bg-brand-600"}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
