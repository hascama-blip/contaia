import Link from "next/link";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { requireUser, bloquearSiSoloRtp } from "@/lib/auth";
import { PLANES, waPlan } from "@/lib/planes";
import PagarPlan from "@/components/PagarPlan";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pagar plan — Radar Tributario" };

export default async function Page({ searchParams }: { searchParams: { plan?: string } }) {
  const user = await requireUser();
  bloquearSiSoloRtp(user);
  const plan = searchParams.plan === "premium" ? "premium" : searchParams.plan === "regular" ? "regular" : null;
  if (!plan) redirect("/planes");
  const info = PLANES.find((p) => p.planId === plan)!;
  const h = headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host") ?? "radartributaria.com"}`;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <Link href="/planes" className="text-sm text-brand-600 hover:underline">← Planes</Link>
        <h1 className="mt-1 text-2xl font-bold text-slate-800">Pagar {info.nombre}</h1>
        <p className="text-sm text-slate-500">{info.resumen}</p>
      </div>
      <PagarPlan plan={plan} whatsapp={waPlan(user.nombre, info.nombre, `${origin}/supremo?u=${user.id}`)} />
      <div className="card p-5">
        <p className="mb-2 text-sm font-semibold text-slate-800">Qué incluye</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {info.incluidos.map((g, i) => (
            <div key={i} className={g.nuevo ? "rounded-lg border border-accent-300 bg-accent-50 p-3" : ""}>
              <p className="text-xs font-semibold text-slate-700">
                {g.titulo} {g.nuevo && <span className="ml-1 rounded-full bg-accent-400 px-1.5 py-0.5 text-[9px] font-bold text-brand-900">NUEVO</span>}
              </p>
              <ul className="mt-1 space-y-0.5">
                {g.puntos.map((pt, j) => (
                  <li key={j} className="flex gap-1.5 text-[11px] text-slate-500"><span className="text-emerald-500">✓</span>{pt}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
