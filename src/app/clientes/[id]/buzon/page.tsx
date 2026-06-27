import Link from "next/link";
import { notFound } from "next/navigation";
import { getClienteDeUsuario } from "@/lib/db";
import { requireUser, studioId } from "@/lib/auth";
import { PrintButton } from "@/components/PrintButton";
import { LogoAsenco } from "@/components/Logo";
import { fmtFecha } from "@/components/ui";
import type { BuzonMensaje } from "@/lib/types";

export const dynamic = "force-dynamic";

// Reporte imprimible de las NOTIFICACIONES DEL BUZÓN SUNAT.
// Recicla el mismo procedimiento del informe analítico: membrete corporativo +
// botón "Imprimir / Guardar PDF" (window.print) + estilos de impresión.
export default async function BuzonPdfPage({ params }: { params: { id: string } }) {
  const user = await requireUser();
  const cliente = await getClienteDeUsuario(params.id, studioId(user));
  if (!cliente) notFound();

  const buzon = cliente.buzon;
  const peligrosos = buzon?.peligrosos ?? [];
  const urgentes = buzon?.urgentes ?? [];
  // Si se guardó la lista completa, se usa; si no (datos antiguos), se arma con
  // los de riesgo que sí están persistidos.
  const todos: BuzonMensaje[] = buzon?.mensajes?.length
    ? buzon.mensajes
    : [...peligrosos, ...urgentes];
  const otros = todos.filter((m) => m.nivel === "otro");

  return (
    <div className="mx-auto max-w-4xl">
      <div className="no-print mb-4 flex items-center justify-between">
        <Link href={`/clientes/${cliente.id}`} className="text-sm text-brand-600 hover:underline">
          ← Volver al cliente
        </Link>
        <PrintButton />
      </div>

      <article className="card print-full overflow-hidden p-0">
        {/* Membrete corporativo (igual que el informe) */}
        <header className="evitar-corte">
          <div className="hero-gradient flex items-start justify-between p-6 text-white">
            <div className="flex items-center gap-3">
              <LogoAsenco dark />
              <div className="border-l border-white/25 pl-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-accent-300">
                  Notificaciones del buzón
                </p>
                <p className="text-xs text-white/80">Buzón electrónico SUNAT</p>
              </div>
            </div>
            <div className="text-right text-xs text-white/80">
              <p>Emitido: {fmtFecha(new Date().toISOString())}</p>
              <p>Documento confidencial</p>
            </div>
          </div>
          <div className="h-1.5 bg-accent-400" />
        </header>

        <div className="p-8 pt-6">
          {/* Datos del cliente */}
          <section className="evitar-corte rounded-xl border border-slate-200 bg-slate-50 p-4">
            <h2 className="text-lg font-bold text-brand-800">{cliente.razonSocial}</h2>
            <div className="mt-2 grid grid-cols-2 gap-2 text-sm text-slate-600">
              <p><span className="text-slate-400">RUC:</span> {cliente.ruc}</p>
              <p>
                <span className="text-slate-400">Consultado:</span>{" "}
                {buzon ? fmtFecha(buzon.consultadoAt) : "—"}
              </p>
              <p><span className="text-slate-400">Total notificaciones:</span> {todos.length}</p>
              <p>
                <span className="text-slate-400">De riesgo:</span>{" "}
                {peligrosos.length} peligroso(s) · {urgentes.length} urgente(s)
              </p>
            </div>
          </section>

          {!buzon && (
            <p className="mt-6 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">
              Este cliente aún no tiene el buzón consultado. Entra al cliente, usa
              “Extraer todo” o consulta el buzón y vuelve aquí para descargar el PDF.
            </p>
          )}

          {buzon && (
            <>
              {peligrosos.length > 0 && (
                <section className="mt-6 evitar-corte">
                  <h3 className="sec-h">🚨 Más peligroso — fiscalización / no contenciosas</h3>
                  <BuzonTabla mensajes={peligrosos} />
                </section>
              )}
              {urgentes.length > 0 && (
                <section className="mt-6 evitar-corte">
                  <h3 className="sec-h">⚠ Urgente — cobranza / valores</h3>
                  <BuzonTabla mensajes={urgentes} />
                </section>
              )}
              <section className="mt-6">
                <h3 className="sec-h">Todas las notificaciones del periodo</h3>
                {todos.length > 0 ? (
                  <BuzonTabla mensajes={todos} />
                ) : (
                  <p className="text-sm text-slate-400">Sin notificaciones en el periodo consultado.</p>
                )}
                {otros.length > 0 && (
                  <p className="mt-2 text-xs text-slate-400">
                    {otros.length} notificación(es) informativa(s) sin riesgo identificado.
                  </p>
                )}
              </section>
            </>
          )}

          <footer className="mt-8 border-t border-slate-200 pt-3 text-center text-[11px] text-slate-400">
            Reporte generado por RADAR TRIBUTARIO · by asenco — uso interno del estudio.
          </footer>
        </div>
      </article>
    </div>
  );
}

function BuzonTabla({ mensajes }: { mensajes: BuzonMensaje[] }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-400">
          <th className="py-1.5">Fecha</th>
          <th className="py-1.5">Categoría</th>
          <th className="py-1.5">Asunto</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {mensajes.map((m) => (
          <tr key={m.id} className="evitar-corte">
            <td className="py-1.5 pr-2 align-top whitespace-nowrap text-slate-500">{m.fecha}</td>
            <td className="py-1.5 pr-2 align-top">
              {m.nivel === "otro" ? (
                <span className="text-xs text-slate-400">Informativa</span>
              ) : (
                <span
                  className={`badge ${m.nivel === "peligroso" ? "bg-red-100 text-red-700" : "bg-orange-100 text-orange-700"}`}
                >
                  {m.tipo || "—"}
                </span>
              )}
            </td>
            <td className="py-1.5 text-slate-700">{m.asunto}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
