import Link from "next/link";
import { notFound } from "next/navigation";
import { getCliente } from "@/lib/db";
import { generarDiagnostico } from "@/lib/diagnostico";
import { PrintButton } from "@/components/PrintButton";
import { fmtFecha, fmtSoles } from "@/components/ui";
import type { NivelRiesgo } from "@/lib/types";

export const dynamic = "force-dynamic";

const RIESGO_LABEL: Record<NivelRiesgo, string> = {
  bajo: "BAJO",
  medio: "MEDIO",
  alto: "ALTO",
  critico: "CRÍTICO",
};

const SEV_DOT: Record<NivelRiesgo, string> = {
  bajo: "bg-emerald-500",
  medio: "bg-amber-500",
  alto: "bg-orange-500",
  critico: "bg-red-500",
};

export default async function InformePage({ params }: { params: { id: string } }) {
  const cliente = await getCliente(params.id);
  if (!cliente) notFound();

  // Usa el diagnóstico guardado, o lo genera al vuelo para el informe.
  const d = cliente.diagnostico ?? generarDiagnostico(cliente);
  const sunat = cliente.sunat;

  const totalDocs = cliente.documentos.length;
  const deudaTotal = cliente.documentos.reduce(
    (acc, doc) => acc + doc.extraccion.deudas.reduce((a, b) => a + b, 0),
    0
  );

  return (
    <div className="mx-auto max-w-3xl">
      <div className="no-print mb-4 flex items-center justify-between">
        <Link href={`/clientes/${cliente.id}`} className="text-sm text-brand-600 hover:underline">
          ← Volver al cliente
        </Link>
        <PrintButton />
      </div>

      <article className="card print-full p-8">
        {/* Cabecera */}
        <header className="flex items-start justify-between border-b border-slate-200 pb-5">
          <div>
            <div className="flex items-center gap-2">
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-600 text-sm font-bold text-white">
                C
              </span>
              <span className="text-xl font-bold text-slate-800">
                Conta<span className="text-brand-600">IA</span>
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Informe de diagnóstico tributario
            </p>
          </div>
          <div className="text-right text-xs text-slate-500">
            <p>Emitido: {fmtFecha(d.generatedAt)}</p>
            <p>Documento confidencial</p>
          </div>
        </header>

        {/* Datos del cliente */}
        <section className="mt-6">
          <h2 className="text-lg font-bold text-slate-800">{cliente.razonSocial}</h2>
          <div className="mt-2 grid grid-cols-2 gap-2 text-sm text-slate-600">
            <p><span className="text-slate-400">RUC:</span> {cliente.ruc}</p>
            <p><span className="text-slate-400">Email:</span> {cliente.email || "—"}</p>
            <p><span className="text-slate-400">Teléfono:</span> {cliente.telefono || "—"}</p>
            <p><span className="text-slate-400">Documentos analizados:</span> {totalDocs}</p>
          </div>
        </section>

        {/* Resumen ejecutivo */}
        <section className="mt-6 rounded-lg bg-slate-50 p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">
                Puntaje de salud tributaria
              </p>
              <p className="text-4xl font-bold text-slate-800">{d.score}<span className="text-lg text-slate-400">/100</span></p>
            </div>
            <div className="text-right">
              <p className="text-xs uppercase tracking-wide text-slate-400">Nivel de riesgo</p>
              <p className="text-2xl font-bold text-slate-800">{RIESGO_LABEL[d.nivelRiesgo]}</p>
            </div>
          </div>
        </section>

        {/* Situación SUNAT */}
        <section className="mt-6">
          <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-500">
            Situación registral SUNAT
          </h3>
          {sunat ? (
            <table className="w-full text-sm">
              <tbody className="divide-y divide-slate-100">
                <Row k="Estado del contribuyente" v={sunat.estado} />
                <Row k="Condición de domicilio" v={sunat.condicion} />
                <Row k="Tipo de contribuyente" v={sunat.tipoContribuyente} />
                <Row k="Domicilio fiscal" v={sunat.direccion} />
                <Row k="Emisor electrónico" v={sunat.comprobanteElectronico ? "Sí" : "No"} />
                <Row k="Tributos / régimen" v={sunat.tributos.join(", ") || "—"} />
                <Row k="Fuente del dato" v={sunat.fuente === "oficial" ? "API oficial SUNAT" : "Simulado (demo)"} />
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-slate-400">No se realizó consulta SUNAT.</p>
          )}
        </section>

        {/* Hallazgos */}
        <section className="mt-6">
          <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-500">
            Hallazgos del análisis
          </h3>
          <ul className="space-y-2">
            {d.hallazgos.map((h, i) => (
              <li key={i} className="flex gap-3 rounded-md border border-slate-200 p-3">
                <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${SEV_DOT[h.severidad]}`} />
                <div>
                  <p className="text-sm font-semibold text-slate-800">
                    {h.titulo}
                    <span className="ml-2 text-xs font-normal text-slate-400">
                      ({RIESGO_LABEL[h.severidad].toLowerCase()})
                    </span>
                  </p>
                  <p className="text-sm text-slate-600">{h.detalle}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        {/* Documentos / deuda */}
        {totalDocs > 0 && (
          <section className="mt-6">
            <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-500">
              Evidencia documental
            </h3>
            <p className="text-sm text-slate-600">
              Se analizaron {totalDocs} documento(s).
              {deudaTotal > 0 && (
                <> Deuda estimada detectada por OCR: <strong>{fmtSoles(deudaTotal)}</strong>.</>
              )}
            </p>
            <ul className="mt-2 list-disc pl-5 text-sm text-slate-600">
              {cliente.documentos.map((doc) => (
                <li key={doc.id}>
                  {doc.originalName}
                  {doc.extraccion.palabrasClave.length > 0 && (
                    <span className="text-slate-400">
                      {" "}— {doc.extraccion.palabrasClave.join(", ")}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Recomendaciones */}
        <section className="mt-6">
          <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-500">
            Recomendaciones
          </h3>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">
            {d.recomendaciones.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ol>
        </section>

        <footer className="mt-8 border-t border-slate-200 pt-4 text-xs text-slate-400">
          <p>
            Informe generado automáticamente por ContaIA a partir de la información de
            SUNAT y los documentos cargados. Debe ser validado por un contador o auditor
            colegiado antes de su uso formal.
          </p>
        </footer>
      </article>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <tr>
      <td className="py-1.5 pr-4 text-slate-400">{k}</td>
      <td className="py-1.5 font-medium text-slate-700">{v}</td>
    </tr>
  );
}
