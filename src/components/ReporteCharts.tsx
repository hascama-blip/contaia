"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const SEV_COLORS: Record<string, string> = {
  bajo: "#10b981",
  medio: "#f59e0b",
  alto: "#f97316",
  critico: "#ef4444",
};

function soles(n: number): string {
  return `S/ ${Number(n).toLocaleString("es-PE", { maximumFractionDigits: 0 })}`;
}

/** Barras agrupadas Ventas vs Compras por periodo. */
export function SireBarChart({
  data,
}: {
  data: { name: string; ventas: number; compras: number }[];
}) {
  if (data.length === 0) {
    return <Empty label="Sin datos SIRE" />;
  }
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef2f7" />
        <XAxis dataKey="name" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => soles(v)} width={70} />
        <Tooltip formatter={(v: number) => soles(v)} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="ventas" name="Ventas" fill="#10b981" radius={[4, 4, 0, 0]} />
        <Bar dataKey="compras" name="Compras" fill="#3b82f6" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Dona de hallazgos por severidad. */
export function HallazgosDonut({
  data,
}: {
  data: { name: string; value: number }[];
}) {
  const filtered = data.filter((d) => d.value > 0);
  if (filtered.length === 0) {
    return <Empty label="Sin hallazgos" />;
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
          {filtered.map((e) => (
            <Cell key={e.name} fill={SEV_COLORS[e.name] ?? "#94a3b8"} />
          ))}
        </Pie>
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Tooltip />
      </PieChart>
    </ResponsiveContainer>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <div className="grid h-[240px] place-items-center text-sm text-slate-400">
      {label}
    </div>
  );
}
