"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

// Panel "Notificaciones" del Inicio (cuentas que no son supremo): plan y días
// para su vencimiento, buzones por atender (programados en Consultas), empresas
// próximas a declarar según el cronograma SUNAT y avisos informativos. Se
// actualiza solo cada 5 minutos.

interface Datos {
  plan: { id: string; nombre: string; vence: string | null; dias: number | null };
  buzon: { vencidos: number; porVencer: number; items: { clienteId: string; razonSocial: string; asunto: string; fechaLimite: string; vencido: boolean; comentario: string }[] };
  declaraciones: { clienteId: string; razonSocial: string; ruc: string; periodo: string; grupo: string; fecha: string; dias: number; oficial: boolean }[];
  avisos: { id: string; titulo: string; texto: string; at: string }[];
  autos: { tipo: "info" | "alerta"; titulo: string; texto: string; href?: string }[];
  actualizado: string;
}

const fmtDia = (iso: string) => {
  try { return new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString("es-PE", { day: "2-digit", month: "short" }); } catch { return iso; }
};
const fmtPeriodo = (p: string) => {
  const [y, m] = p.split("-");
  const meses = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Set", "Oct", "Nov", "Dic"];
  return `${meses[Number(m) - 1] ?? m} ${y}`;
};

export default function NotificacionesPanel() {
  const [d, setD] = useState<Datos | null>(null);
  const [err, setErr] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const res = await fetch("/api/notificaciones", { cache: "no-store" });
      if (!res.ok) { setErr(true); return; }
      setD(await res.json()); setErr(false);
    } catch { setErr(true); }
  }, []);
  useEffect(() => {
    cargar();
    const t = setInterval(cargar, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [cargar]);

  const total = d ? d.buzon.vencidos + d.buzon.porVencer + d.declaraciones.filter((x) => x.dias >= 0).length + d.avisos.length + d.autos.length : 0;

  return (
    // Ocupa la altura disponible; su contenido se desplaza dentro SIN barra visible.
    <section className="flex min-h-0 flex-1 flex-col rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex shrink-0 items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-bold text-slate-800">🔔 Notificaciones</h2>
        {d && total > 0 && <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-600">{total}</span>}
      </div>

      {!d && !err && <p className="mt-3 text-xs text-slate-400">Cargando…</p>}
      {err && <p className="mt-3 text-xs text-red-500">No se pudieron cargar las notificaciones.</p>}

      {d && (
        <div className="sin-barra mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto">
          {/* Plan */}
          <PlanCard plan={d.plan} />

          {/* Buzones por atender */}
          {(d.buzon.vencidos > 0 || d.buzon.porVencer > 0) && (
            <Bloque icono="📨" titulo="Buzones por atender" sub={`${d.buzon.vencidos} vencido(s) · ${d.buzon.porVencer} por vencer`} color={d.buzon.vencidos ? "red" : "amber"}>
              {d.buzon.items.map((r, i) => (
                <Link key={i} href={`/clientes/${r.clienteId}`} className="block rounded-lg px-2 py-1.5 text-xs hover:bg-slate-50">
                  <span className={`mr-1.5 rounded px-1 py-0.5 text-[10px] font-bold ${r.vencido ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>{r.vencido ? "Vencido" : `Vence ${fmtDia(r.fechaLimite)}`}</span>
                  <span className="font-medium text-slate-700">{r.razonSocial}</span>
                  <p className="truncate text-slate-500">{r.asunto}</p>
                </Link>
              ))}
            </Bloque>
          )}

          {/* Próximos a declarar */}
          {d.declaraciones.length > 0 && (
            <Bloque icono="🗓️" titulo="Próximos a declarar" sub={`Periodo ${fmtPeriodo(d.declaraciones[0].periodo)} · por último dígito del RUC`} color="blue">
              {d.declaraciones.map((x) => (
                <Link key={x.clienteId} href={`/clientes/${x.clienteId}`} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-slate-50">
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-slate-700">{x.razonSocial}</span>
                    <span className="text-slate-400">RUC …{x.ruc.slice(-1)} · {fmtDia(x.fecha)}{x.oficial ? "" : " (ref.)"}</span>
                  </span>
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${x.dias < 0 ? "bg-slate-100 text-slate-500" : x.dias <= 2 ? "bg-red-100 text-red-700" : x.dias <= 7 ? "bg-amber-100 text-amber-700" : "bg-brand-50 text-brand-700"}`}>
                    {x.dias < 0 ? "Venció" : x.dias === 0 ? "Hoy" : x.dias === 1 ? "Mañana" : `${x.dias} días`}
                  </span>
                </Link>
              ))}
              <p className="px-2 pt-1 text-[10px] text-slate-400">(ref.) = fecha referencial según el patrón de SUNAT; confirma en el cronograma oficial.</p>
            </Bloque>
          )}

          {/* Avisos informativos + alertas automáticas */}
          {(d.avisos.length > 0 || d.autos.length > 0) && (
            <Bloque icono="📣" titulo="Avisos" sub="Se actualizan automáticamente" color="slate">
              {d.autos.map((a, i) => (
                <Item key={`a${i}`} href={a.href} alerta={a.tipo === "alerta"} titulo={a.titulo} texto={a.texto} />
              ))}
              {d.avisos.map((a) => (
                <Item key={a.id} titulo={a.titulo} texto={a.texto} fecha={fmtDia(a.at)} />
              ))}
            </Bloque>
          )}

          {total === 0 && <p className="rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-700">✅ Todo al día: sin buzones pendientes ni vencimientos próximos.</p>}
          <p className="text-right text-[10px] text-slate-400">Actualizado {new Date(d.actualizado).toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" })}</p>
        </div>
      )}
    </section>
  );
}

function PlanCard({ plan }: { plan: Datos["plan"] }) {
  const gratis = plan.id === "basico";
  const dias = plan.dias;
  const tono = dias == null ? "slate" : dias < 0 ? "red" : dias <= 7 ? "amber" : "emerald";
  const cls: Record<string, string> = {
    slate: "border-slate-200 bg-slate-50 text-slate-600",
    red: "border-red-200 bg-red-50 text-red-700",
    amber: "border-amber-200 bg-amber-50 text-amber-800",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-800",
  };
  return (
    <div className={`rounded-2xl border p-3 text-xs ${cls[tono]}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-bold">Tu plan: {plan.nombre}</span>
        {gratis && <Link href="/planes" className="rounded-lg bg-accent-400 px-2 py-1 text-[10px] font-bold text-brand-900 hover:bg-accent-300">Mejorar</Link>}
      </div>
      {!gratis && dias != null && (
        <p className="mt-1">
          {dias < 0 ? `Venció hace ${-dias} día(s). ` : dias === 0 ? "Vence hoy. " : `Vence en ${dias} día(s) (${fmtDia(plan.vence!)}). `}
          {dias <= 7 && <Link href={plan.id === "regular" || plan.id === "premium" ? `/pagar?plan=${plan.id}` : "/planes"} className="font-semibold underline">Renovar</Link>}
        </p>
      )}
      {!gratis && dias == null && <p className="mt-1 opacity-80">Sin fecha de vencimiento.</p>}
      {gratis && <p className="mt-1 opacity-80">Incluye el Reporte analítico de auditoría y las Consultas tributarias (3 generaciones por paso y empresa al mes).</p>}
    </div>
  );
}

function Bloque({ icono, titulo, sub, color, children }: { icono: string; titulo: string; sub: string; color: "red" | "amber" | "blue" | "slate"; children: React.ReactNode }) {
  const borde = { red: "border-red-200", amber: "border-amber-200", blue: "border-brand-100", slate: "border-slate-200" }[color];
  return (
    <div className={`rounded-2xl border ${borde} bg-white p-2`}>
      <div className="px-2 pb-1 pt-1">
        <p className="text-sm font-bold text-slate-800">{icono} {titulo}</p>
        <p className="text-[11px] text-slate-400">{sub}</p>
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function Item({ titulo, texto, href, alerta, fecha }: { titulo: string; texto: string; href?: string; alerta?: boolean; fecha?: string }) {
  const inner = (
    <>
      <p className="text-xs font-medium text-slate-700">{alerta ? "⚠️ " : "ℹ️ "}{titulo}</p>
      {texto && <p className="text-[11px] text-slate-500">{texto}</p>}
      {fecha && <p className="text-[10px] text-slate-400">{fecha}</p>}
    </>
  );
  return href ? <Link href={href} className="block rounded-lg px-2 py-1.5 hover:bg-slate-50">{inner}</Link> : <div className="px-2 py-1.5">{inner}</div>;
}
