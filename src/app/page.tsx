import Link from "next/link";
import { listClientes } from "@/lib/db";
import { sunatModo } from "@/lib/sunat";
import { EstadoBars, RiesgoPie } from "@/components/DashboardCharts";
import CruceSirePanel from "@/components/CruceSirePanel";
import ClasificacionPanel from "@/components/ClasificacionPanel";
import FacturasXmlPanel from "@/components/FacturasXmlPanel";
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
      {/* Héroe corporativo */}
      <section className="hero-gradient relative overflow-hidden rounded-3xl p-7 text-white shadow-lg">
        <div className="absolute -right-12 -top-12 h-48 w-48 rounded-full bg-white/10" />
        <div className="absolute -bottom-16 left-1/3 h-48 w-48 rounded-full bg-white/10" />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold backdrop-blur">
              Plataforma de diagnóstico tributario SUNAT
            </span>
            <h1 className="mt-3 text-3xl font-bold leading-tight">
              Hola, controla la salud tributaria de tu cartera
            </h1>
            <p className="mt-2 max-w-xl text-sm text-white/85">
              Consulta RUC, SIRE, buzón y declaraciones, y genera el informe de
              gerencia de cada cliente en minutos.
            </p>
          </div>
          <Link
            href="/clientes/nuevo"
            className="rounded-xl bg-white px-5 py-3 text-sm font-bold text-brand-700 shadow-md transition hover:bg-brand-50"
          >
            + Nuevo cliente
          </Link>
        </div>
      </section>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Dashboard</h2>
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

      {total === 0 && (
        <section className="grid gap-3 sm:grid-cols-3">
          <PasoHome n="1" titulo="Crea el cliente" detalle="Ingresa el RUC y trae sus datos de SUNAT al instante." />
          <PasoHome n="2" titulo="Extrae su información" detalle="SIRE (compras/ventas), buzón y declaraciones mensuales." />
          <PasoHome n="3" titulo="Genera el informe" detalle="Diagnóstico, contingencias e informe de gerencia en PDF." />
        </section>
      )}

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

      {/* Herramienta suelta: Clasificación automática de compras */}
      <section className="space-y-2">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Clasificación automática de compras</h2>
          <p className="text-sm text-slate-500">
            Sube el SIRE de compras y la cuenta contable de cada proveedor sale sola (por rubro);
            solo confirmas los nuevos y se aprende para la próxima.
          </p>
        </div>
        <ClasificacionPanel />
      </section>

      {/* Herramienta suelta: lectura de XML de facturas (detalle + cuenta) */}
      <section className="space-y-2">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Facturas XML → detalle + cuenta</h2>
          <p className="text-sm text-slate-500">
            Sube los XML de las facturas y obtén la <strong>descripción (glosa)</strong>, montos y
            la cuenta automática — listo para registrar en Contasis.
          </p>
        </div>
        <FacturasXmlPanel />
      </section>

      {/* Herramienta suelta: Cruce SIRE vs Contabilidad (Contasis) */}
      <section className="space-y-2">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Cruce SIRE vs Contabilidad</h2>
          <p className="text-sm text-slate-500">
            Sube los Excel del SIRE y de Contasis y compáralos comprobante por comprobante,
            sin necesidad de registrar un cliente.
          </p>
        </div>
        <CruceSirePanel />
      </section>

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

function PasoHome({ n, titulo, detalle }: { n: string; titulo: string; detalle: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <span className="step-num">{n}</span>
        <p className="font-semibold text-slate-800">{titulo}</p>
      </div>
      <p className="mt-2 text-xs text-slate-500">{detalle}</p>
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
