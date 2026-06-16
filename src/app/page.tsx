import Link from "next/link";
import { listClientes } from "@/lib/db";
import { sunatModo } from "@/lib/sunat";
import { EstadoBars, RiesgoPie } from "@/components/DashboardCharts";
import { RiesgoBadge } from "@/components/ui";
import type { NivelRiesgo } from "@/lib/types";

export const dynamic = "force-dynamic";

const MODO_LABEL: Record<string, string> = {
  decolecta: "decolecta.com",
  apisnet: "apis.net.pe",
  oficial: "API oficial SOL",
  mock: "modo simulado",
};

export default async function DashboardPage() {
  const clientes = await listClientes();
  const modo = sunatModo();

  const total = clientes.length;
  const consultados = clientes.filter((c) => c.sunat).length;
  const conDiagnostico = clientes.filter((c) => c.diagnostico).length;
  const activos = clientes.filter(
    (c) => c.sunat?.estado.toUpperCase() === "ACTIVO"
  ).length;
  const noHabidos = clientes.filter(
    (c) => c.sunat && c.sunat.condicion.toUpperCase() !== "HABIDO"
  ).length;

  const niveles: NivelRiesgo[] = ["bajo", "medio", "alto", "critico"];
  const riesgoData: { name: string; value: number }[] = niveles.map((n) => ({
    name: n as string,
    value: clientes.filter((c) => c.diagnostico?.nivelRiesgo === n).length,
  }));
  riesgoData.push({
    name: "sin diagnóstico",
    value: clientes.filter((c) => !c.diagnostico).length,
  });

  const estadoData = [
    {
      name: "Activos",
      value: clientes.filter((c) => c.sunat?.estado.toUpperCase() === "ACTIVO").length,
    },
    {
      name: "No activos",
      value: clientes.filter(
        (c) => c.sunat && c.sunat.estado.toUpperCase() !== "ACTIVO"
      ).length,
    },
    {
      name: "No habidos",
      value: noHabidos,
    },
    {
      name: "Sin consulta",
      value: clientes.filter((c) => !c.sunat).length,
    },
  ];

  const criticos = clientes
    .filter((c) => c.diagnostico && ["alto", "critico"].includes(c.diagnostico.nivelRiesgo))
    .sort((a, b) => (a.diagnostico!.score - b.diagnostico!.score))
    .slice(0, 5);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Dashboard</h1>
          <p className="text-sm text-slate-500">
            Estado tributario de tu cartera de clientes.
          </p>
        </div>
        <span
          className={`badge ${modo === "mock" ? "bg-slate-200 text-slate-600" : "bg-emerald-100 text-emerald-700"}`}
        >
          SUNAT: {MODO_LABEL[modo]}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <Stat label="Clientes" value={total} />
        <Stat label="Consultados" value={consultados} />
        <Stat label="Diagnosticados" value={conDiagnostico} />
        <Stat label="Activos SUNAT" value={activos} tone="ok" />
        <Stat label="No habidos" value={noHabidos} tone={noHabidos ? "warn" : "ok"} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="card p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">
            Distribución por nivel de riesgo
          </h2>
          <RiesgoPie data={riesgoData} />
        </div>
        <div className="card p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">
            Estado SUNAT de la cartera
          </h2>
          <EstadoBars data={estadoData} />
        </div>
      </div>

      <div className="card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">
            Clientes que requieren atención
          </h2>
          <Link href="/clientes" className="text-sm text-brand-600 hover:underline">
            Ver todos →
          </Link>
        </div>
        {criticos.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">
            No hay clientes en riesgo alto/crítico. {total === 0 && "Crea tu primer cliente."}
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {criticos.map((c) => (
              <li key={c.id} className="flex items-center justify-between py-3">
                <div>
                  <Link
                    href={`/clientes/${c.id}`}
                    className="font-medium text-slate-800 hover:text-brand-600"
                  >
                    {c.razonSocial}
                  </Link>
                  <p className="text-xs text-slate-500">RUC {c.ruc}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold text-slate-700">
                    {c.diagnostico!.score}/100
                  </span>
                  <RiesgoBadge nivel={c.diagnostico!.nivelRiesgo} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "ok" | "warn";
}) {
  const toneClass =
    tone === "warn"
      ? "text-amber-600"
      : tone === "ok"
        ? "text-emerald-600"
        : "text-slate-800";
  return (
    <div className="card p-4">
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${toneClass}`}>{value}</p>
    </div>
  );
}
