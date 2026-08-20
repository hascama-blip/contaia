import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser, esSupremo, modulosDelEstudio } from "@/lib/auth";
import { getVisorMatriz, type VisorMatriz } from "@/lib/db";
import { PrintButton } from "@/components/PrintButton";
import { LogoAsenco } from "@/components/Logo";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reporte Visor Tributario" };

const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Set", "Oct", "Nov", "Dic"];
const TIPO_LABEL: Record<string, string> = { sire: "SIRE — Registro de Ventas / Compras", "dj-mensual": "Declaración Jurada Mensual", "dj-anual": "Declaración Jurada Anual" };
const NOM_MES = ["", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Setiembre", "Octubre", "Noviembre", "Diciembre"];

function fmtFecha(iso: string) {
  try { return new Date(iso).toLocaleDateString("es-PE", { day: "2-digit", month: "long", year: "numeric" }); } catch { return iso; }
}
function aniosDe(m: VisorMatriz): string[] {
  return Array.from(new Set([...Object.keys(m.celdas).map((k) => k.slice(0, 4)), ...Object.keys(m.anios)])).sort();
}

export default async function Page() {
  const user = await requireUser();
  const mods = await modulosDelEstudio(user);
  if (!esSupremo(user) && !mods.has("visor")) redirect("/");
  const mats = await getVisorMatriz(user.id);

  // Agrupa por empresa.
  const porEmpresa = new Map<string, VisorMatriz[]>();
  for (const m of mats) {
    const k = m.empresa || m.ruc || "Empresa";
    if (!porEmpresa.has(k)) porEmpresa.set(k, []);
    porEmpresa.get(k)!.push(m);
  }

  // Observaciones (lo No Presentado) por empresa.
  const obs = (lista: VisorMatriz[]): string[] => {
    const out: string[] = [];
    for (const m of lista.sort((a, b) => a.tipo.localeCompare(b.tipo))) {
      // DJ anual: contingencia a nivel de ejercicio (año), no de mes.
      if (m.tipo === "dj-anual") {
        const aniosNp = Object.entries(m.anios).filter(([, e]) => e === "NP").map(([y]) => y).sort();
        if (aniosNp.length) out.push(`${TIPO_LABEL[m.tipo] ?? m.tipo}: NO PRESENTÓ el ejercicio ${aniosNp.join(", ")}.`);
        continue;
      }
      const np = Object.entries(m.celdas).filter(([, e]) => e === "NP").map(([k]) => k).sort();
      if (np.length) {
        const porAnio = new Map<string, string[]>();
        for (const k of np) { const y = k.slice(0, 4); const mm = Number(k.slice(5, 7)); (porAnio.get(y) ?? porAnio.set(y, []).get(y)!).push(NOM_MES[mm]); }
        for (const [y, meses] of porAnio) out.push(`${TIPO_LABEL[m.tipo] ?? m.tipo}: NO PRESENTÓ ${meses.join(", ")} del ${y}.`);
      }
    }
    return out;
  };

  return (
    <div className="mx-auto max-w-4xl">
      <div className="no-print mb-4 flex items-center justify-between gap-3">
        <Link href="/herramientas/visor" className="text-sm text-brand-600 hover:underline">← Volver al Visor</Link>
        <PrintButton />
      </div>

      <article className="card print-full overflow-hidden p-0">
        {/* Membrete corporativo (igual al informe) */}
        <header className="evitar-corte">
          <div className="hero-gradient flex flex-col gap-3 p-4 text-white sm:flex-row sm:items-start sm:justify-between sm:p-6">
            <div className="flex items-center gap-3">
              <LogoAsenco dark />
              <div className="border-l border-white/25 pl-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-accent-300">Reporte de cumplimiento</p>
                <p className="text-xs text-white/80">Presentación SUNAT · SIRE y Declaraciones Juradas</p>
              </div>
            </div>
            <div className="text-xs text-white/80 sm:text-right">
              <p>Emitido: {fmtFecha(new Date().toISOString())}</p>
              <p>Documento confidencial</p>
            </div>
          </div>
        </header>

        <div className="space-y-8 p-4 sm:p-6">
          {porEmpresa.size === 0 && (
            <p className="text-sm text-slate-500">Aún no hay datos capturados. Navega el SIRE / DJ con la extensión del Visor instalada.</p>
          )}

          {[...porEmpresa].map(([empresa, lista]) => {
            const ruc = lista.find((m) => m.ruc)?.ruc;
            const observaciones = obs(lista);
            return (
              <section key={empresa} className="evitar-corte space-y-4">
                <div className="border-b border-slate-200 pb-2">
                  <h2 className="text-lg font-bold text-slate-800">{empresa}</h2>
                  {ruc && <p className="text-xs text-slate-500">RUC {ruc}</p>}
                </div>

                {lista.sort((a, b) => a.tipo.localeCompare(b.tipo)).map((m, i) => {
                  const anios = aniosDe(m);
                  // DJ anual: cuadro SOLO por año (un estado por ejercicio).
                  if (m.tipo === "dj-anual") {
                    return (
                      <div key={i} className="evitar-corte">
                        <p className="mb-1 text-sm font-semibold text-brand-700">{TIPO_LABEL[m.tipo] ?? m.tipo}</p>
                        <div className="inline-block overflow-hidden rounded-lg border border-slate-200">
                          <table className="text-center text-[11px]">
                            <thead className="bg-slate-100 text-slate-600"><tr>{anios.map((y) => <th key={y} className="px-4 py-1.5">{y}</th>)}</tr></thead>
                            <tbody><tr>{anios.map((y) => {
                              const e = m.anios[y];
                              return <td key={y} className={`px-4 py-1.5 ${e === "NP" ? "bg-red-50 font-semibold text-red-700" : e === "P" ? "bg-emerald-50 text-emerald-700" : "text-slate-300"}`}>{e === "NP" ? "No" : e === "P" ? "Sí" : "·"}</td>;
                            })}</tr></tbody>
                          </table>
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div key={i} className="evitar-corte">
                      <p className="mb-1 text-sm font-semibold text-brand-700">{TIPO_LABEL[m.tipo] ?? m.tipo}</p>
                      <div className="overflow-hidden rounded-lg border border-slate-200">
                        <table className="w-full text-center text-[11px]">
                          <thead className="bg-slate-100 text-slate-600">
                            <tr><th className="px-2 py-1.5 text-left">Año</th>{MESES.map((mm) => <th key={mm} className="px-2 py-1.5">{mm}</th>)}</tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {anios.map((y) => (
                              <tr key={y}>
                                <td className="px-2 py-1.5 text-left font-medium text-slate-700">{y}</td>
                                {Array.from({ length: 12 }, (_, k) => {
                                  const e = m.celdas[`${y}-${String(k + 1).padStart(2, "0")}`];
                                  return (
                                    <td key={k} className={e === "NP" ? "bg-red-50 font-semibold text-red-700" : e === "P" ? "bg-emerald-50 text-emerald-700" : "text-slate-300"}>
                                      {e === "NP" ? "No" : e === "P" ? "Sí" : "·"}
                                    </td>
                                  );
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })}

                {observaciones.length > 0 && (
                  <div className="evitar-corte">
                    <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-600">Observaciones — contingencias</h3>
                    <ol className="space-y-2">
                      {observaciones.map((o, i) => (
                        <li key={i} className="flex gap-3 rounded-lg border-l-4 border-l-red-500 bg-red-50 p-3 text-sm text-slate-700">
                          <span className="font-bold text-slate-400">{i + 1}.</span>
                          <span>{o}<span className="ml-2 text-[10px] font-semibold uppercase text-slate-400">[prioridad alta]</span></span>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
              </section>
            );
          })}

          <div className="flex items-center gap-4 border-t border-slate-200 pt-3 text-[11px] text-slate-400">
            <span><b className="text-emerald-700">Sí</b> = Presentó</span>
            <span><b className="text-red-700">No</b> = No presentó</span>
            <span>· = sin dato capturado</span>
          </div>
        </div>
      </article>
    </div>
  );
}
