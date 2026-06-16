"use client";

import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const RIESGO_COLORS: Record<string, string> = {
  bajo: "#10b981",
  medio: "#f59e0b",
  alto: "#f97316",
  critico: "#ef4444",
  "sin diagnóstico": "#94a3b8",
};

export function RiesgoPie({ data }: { data: { name: string; value: number }[] }) {
  const filtered = data.filter((d) => d.value > 0);
  if (filtered.length === 0) {
    return <EmptyChart label="Sin datos de riesgo aún" />;
  }
  return (
    <ResponsiveContainer width="100%" height={240}>
      <PieChart>
        <Pie
          data={filtered}
          dataKey="value"
          nameKey="name"
          innerRadius={55}
          outerRadius={90}
          paddingAngle={2}
        >
          {filtered.map((entry) => (
            <Cell key={entry.name} fill={RIESGO_COLORS[entry.name] ?? "#94a3b8"} />
          ))}
        </Pie>
        <Tooltip />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function EstadoBars({ data }: { data: { name: string; value: number }[] }) {
  if (data.every((d) => d.value === 0)) {
    return <EmptyChart label="Sin consultas SUNAT aún" />;
  }
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data}>
        <XAxis dataKey="name" tick={{ fontSize: 12 }} />
        <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
        <Tooltip />
        <Bar dataKey="value" radius={[6, 6, 0, 0]} fill="#1f56f5" />
      </BarChart>
    </ResponsiveContainer>
  );
}

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="grid h-[240px] place-items-center text-sm text-slate-400">
      {label}
    </div>
  );
}
