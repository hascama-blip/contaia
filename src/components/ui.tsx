import type { NivelRiesgo } from "@/lib/types";

const RIESGO_STYLE: Record<NivelRiesgo, string> = {
  bajo: "bg-emerald-100 text-emerald-700",
  medio: "bg-amber-100 text-amber-700",
  alto: "bg-orange-100 text-orange-700",
  critico: "bg-red-100 text-red-700",
};

const RIESGO_LABEL: Record<NivelRiesgo, string> = {
  bajo: "Riesgo bajo",
  medio: "Riesgo medio",
  alto: "Riesgo alto",
  critico: "Riesgo crítico",
};

export function RiesgoBadge({ nivel }: { nivel: NivelRiesgo }) {
  return <span className={`badge ${RIESGO_STYLE[nivel]}`}>{RIESGO_LABEL[nivel]}</span>;
}

export function EstadoBadge({ estado }: { estado: string }) {
  const ok = estado.toUpperCase() === "ACTIVO";
  return (
    <span
      className={`badge ${ok ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}
    >
      {estado}
    </span>
  );
}

export function CondicionBadge({ condicion }: { condicion: string }) {
  const ok = condicion.toUpperCase() === "HABIDO";
  return (
    <span
      className={`badge ${ok ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}
    >
      {condicion}
    </span>
  );
}

export function fmtSoles(n: number): string {
  return `S/ ${n.toLocaleString("es-PE", { minimumFractionDigits: 2 })}`;
}

export function fmtFecha(iso: string): string {
  try {
    return new Date(iso).toLocaleString("es-PE", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}
