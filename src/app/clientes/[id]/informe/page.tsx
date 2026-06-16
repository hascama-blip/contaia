import Link from "next/link";
import { notFound } from "next/navigation";
import { getCliente } from "@/lib/db";
import { generarDiagnostico } from "@/lib/diagnostico";
import { etiquetaPeriodo } from "@/lib/sire";
import { PrintButton } from "@/components/PrintButton";
import { SireBarChart, HallazgosDonut } from "@/components/ReporteCharts";
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

  // --- Datos para el dashboard del informe ---
  const sire = cliente.sire ?? [];
  // Acumulados de TODOS los periodos consultados (ventas/compras SUNAT).
  const ventasAcum = sire.reduce((a, s) => a + s.ventas.importeTotal, 0);
  const comprasAcum = sire.reduce((a, s) => a + s.compras.importeTotal, 0);
  const igvVentasAcum = sire.reduce((a, s) => a + s.ventas.igv, 0);
  const igvComprasAcum = sire.reduce((a, s) => a + s.compras.igv, 0);
  const igvPorPagar = igvVentasAcum - igvComprasAcum;
  const nPeriodos = sire.length;

  // Serie de periodos (ascendente) para el gráfico de barras.
  const sireChartData = [...sire]
    .sort((a, b) => a.periodo.localeCompare(b.periodo))
    .slice(-12)
    .map((s) => ({
      name: `${s.periodo.slice(4, 6)}/${s.periodo.slice(2, 4)}`,
      ventas: s.ventas.importeTotal,
      compras: s.compras.importeTotal,
    }));

  const niveles: NivelRiesgo[] = ["bajo", "medio", "alto", "critico"];
  const hallazgosData = niveles.map((n) => ({
    name: n,
    value: d.hallazgos.filter((h) => h.severidad === n).length,
  }));

  const scoreColor =
    d.score >= 85 ? "#10b981" : d.score >= 65 ? "#f59e0b" : d.score >= 40 ? "#f97316" : "#ef4444";
  const scoreDeg = (d.score / 100) * 360;

  // --- Buzón y contingencias ---
  const buzon = cliente.buzon;
  const urgentes = buzon?.urgentes ?? [];
  const cobranzas = urgentes.filter((m) => m.tipo === "Resolución de Cobranza");
  const valores = urgentes.filter((m) => m.tipo === "Valor");

  type Contingencia = { nivel: NivelRiesgo; titulo: string; detalle: string };
  const contingencias: Contingencia[] = [];
  if (cobranzas.length > 0)
    contingencias.push({
      nivel: "critico",
      titulo: `${cobranzas.length} resolución(es) de cobranza coactiva notificada(s)`,
      detalle:
        "Riesgo inminente de embargo/medidas cautelares. Atender de inmediato (pago o fraccionamiento).",
    });
  if (valores.length > 0)
    contingencias.push({
      nivel: "alto",
      titulo: `${valores.length} valor(es) notificado(s) (órdenes de pago, multas, determinaciones)`,
      detalle: "Deuda exigible. Revisar y pagar o reclamar dentro del plazo legal.",
    });
  if (sunat && sunat.condicion.toUpperCase() !== "HABIDO")
    contingencias.push({
      nivel: "alto",
      titulo: `Condición de domicilio: ${sunat.condicion}`,
      detalle: "Restringe crédito fiscal y comprobantes; señal de riesgo ante fiscalización.",
    });
  if (sunat && sunat.estado.toUpperCase() !== "ACTIVO")
    contingencias.push({
      nivel: sunat.estado.toUpperCase().includes("BAJA") ? "critico" : "alto",
      titulo: `Estado del contribuyente: ${sunat.estado}`,
      detalle: "No permite operar/emitir con normalidad. Regularizar ante SUNAT.",
    });
  if (igvPorPagar > 0)
    contingencias.push({
      nivel: igvPorPagar > 10000 ? "alto" : "medio",
      titulo: `IGV por pagar acumulado aprox. ${fmtSoles(igvPorPagar)}`,
      detalle: "Verificar provisión y pago oportuno del IGV para evitar multas e intereses.",
    });

  const NIVEL_PESO: Record<NivelRiesgo, number> = { critico: 4, alto: 3, medio: 2, bajo: 1 };
  contingencias.sort((a, b) => NIVEL_PESO[b.nivel] - NIVEL_PESO[a.nivel]);

  const CONT_STYLE: Record<NivelRiesgo, string> = {
    critico: "border-l-red-500 bg-red-50",
    alto: "border-l-orange-500 bg-orange-50",
    medio: "border-l-amber-500 bg-amber-50",
    bajo: "border-l-emerald-500 bg-emerald-50",
  };

  return (
    <div className="mx-auto max-w-4xl">
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
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-700 text-sm font-bold text-white">
                A
              </span>
              <span className="text-xl font-bold tracking-tight">
                <span className="text-brand-700">ASENCO</span>
                <span className="text-slate-900">IA</span>
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Informe de gerencia · Diagnóstico tributario
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

        {/* ===================== DASHBOARD ===================== */}
        {/* Fila 1: puntaje (anillo) + KPIs */}
        <section className="mt-6 grid gap-4 md:grid-cols-3">
          {/* Tarjeta puntaje con anillo */}
          <div className="flex items-center gap-4 rounded-xl border border-slate-200 p-4">
            <div
              className="grid h-24 w-24 shrink-0 place-items-center rounded-full"
              style={{ background: `conic-gradient(${scoreColor} ${scoreDeg}deg, #e2e8f0 ${scoreDeg}deg)` }}
            >
              <div className="grid h-[72px] w-[72px] place-items-center rounded-full bg-white">
                <span className="text-2xl font-bold text-slate-800">{d.score}</span>
                <span className="text-[10px] text-slate-400">/100</span>
              </div>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">
                Salud tributaria
              </p>
              <p className="text-lg font-bold" style={{ color: scoreColor }}>
                {RIESGO_LABEL[d.nivelRiesgo]}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {d.hallazgos.length} hallazgo(s)
              </p>
            </div>
          </div>

          {/* KPIs acumulados (suma de todos los periodos consultados) */}
          <Kpi
            label={nPeriodos ? `Ventas acumuladas (${nPeriodos} mes${nPeriodos > 1 ? "es" : ""})` : "Ventas acumuladas"}
            value={fmtSoles(ventasAcum)}
            tone="emerald"
          />
          <Kpi
            label={nPeriodos ? `Compras acumuladas (${nPeriodos} mes${nPeriodos > 1 ? "es" : ""})` : "Compras acumuladas"}
            value={fmtSoles(comprasAcum)}
            tone="blue"
          />
        </section>

        {/* Fila 2: KPIs secundarios */}
        <section className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
          <KpiSmall label="IGV ventas (acum.)" value={fmtSoles(igvVentasAcum)} />
          <KpiSmall label="IGV compras (acum.)" value={fmtSoles(igvComprasAcum)} />
          <KpiSmall
            label="IGV por pagar (aprox.)"
            value={fmtSoles(Math.max(0, igvPorPagar))}
            tone={igvPorPagar > 0 ? "amber" : "emerald"}
          />
          <KpiSmall
            label="Deuda detectada (docs)"
            value={fmtSoles(deudaTotal)}
            tone={deudaTotal > 0 ? "red" : "slate"}
          />
        </section>

        {/* Fila 3: gráficos — en su propia hoja al imprimir, juntos */}
        <section className="grafico-hoja mt-4 grid gap-4 md:grid-cols-2">
          <div className="break-inside-avoid rounded-xl border border-slate-200 p-4">
            <h3 className="mb-1 text-sm font-semibold text-slate-700">
              Ventas vs Compras por periodo
            </h3>
            <SireBarChart data={sireChartData} />
          </div>
          <div className="break-inside-avoid rounded-xl border border-slate-200 p-4">
            <h3 className="mb-1 text-sm font-semibold text-slate-700">
              Hallazgos por severidad
            </h3>
            <HallazgosDonut data={hallazgosData} />
          </div>
        </section>
        {/* =================== FIN DASHBOARD =================== */}

        {/* Contingencias y alertas */}
        <section className="mt-6">
          <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-500">
            Contingencias y alertas
          </h3>
          {contingencias.length === 0 ? (
            <p className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
              No se detectaron contingencias relevantes con la información disponible.
            </p>
          ) : (
            <ul className="space-y-2">
              {contingencias.map((c, i) => (
                <li key={i} className={`rounded-md border-l-4 p-3 ${CONT_STYLE[c.nivel]}`}>
                  <p className="text-sm font-semibold text-slate-800">
                    {c.titulo}
                    <span className="ml-2 text-xs font-normal uppercase text-slate-500">
                      ({c.nivel})
                    </span>
                  </p>
                  <p className="text-sm text-slate-600">{c.detalle}</p>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Buzón electrónico SUNAT (urgentes del mes) */}
        {buzon && (
          <section className="mt-6">
            <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-500">
              Buzón electrónico SUNAT — urgentes del mes
            </h3>
            <p className="mb-2 text-xs text-slate-500">
              {urgentes.length} mensaje(s) de cobranza/valores · {buzon.totalMensajes} mensaje(s) revisados ·
              consultado {fmtFecha(buzon.consultadoAt)}
            </p>
            {urgentes.length === 0 ? (
              <p className="text-sm text-slate-400">Sin notificaciones de cobranza ni valores en el mes.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-400">
                    <th className="py-1.5">Fecha</th>
                    <th className="py-1.5">Categoría</th>
                    <th className="py-1.5">Asunto</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {urgentes.map((m) => (
                    <tr key={m.id}>
                      <td className="py-1.5 pr-2 align-top text-slate-500 whitespace-nowrap">{m.fecha}</td>
                      <td className="py-1.5 pr-2 align-top">
                        <span className={`badge ${m.tipo === "Resolución de Cobranza" ? "bg-red-100 text-red-700" : "bg-orange-100 text-orange-700"}`}>
                          {m.tipo || "—"}
                        </span>
                      </td>
                      <td className="py-1.5 text-slate-700">{m.asunto}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )}

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

        {/* Compras y Ventas (SIRE) */}
        {cliente.sire && cliente.sire.length > 0 && (
          <section className="mt-6">
            <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-500">
              Compras y Ventas (SIRE)
            </h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-400">
                  <th className="py-1.5">Periodo</th>
                  <th className="py-1.5 text-right">Ventas</th>
                  <th className="py-1.5 text-right">Compras</th>
                  <th className="py-1.5 text-right">Diferencia</th>
                  <th className="py-1.5 text-right">Origen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {cliente.sire.map((s) => {
                  const dif = s.ventas.importeTotal - s.compras.importeTotal;
                  return (
                    <tr key={s.periodo}>
                      <td className="py-1.5 text-slate-700">{etiquetaPeriodo(s.periodo)}</td>
                      <td className="py-1.5 text-right text-slate-700">{fmtSoles(s.ventas.importeTotal)}</td>
                      <td className="py-1.5 text-right text-slate-700">{fmtSoles(s.compras.importeTotal)}</td>
                      <td className={`py-1.5 text-right font-medium ${dif >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                        {fmtSoles(dif)}
                      </td>
                      <td className="py-1.5 text-right text-xs text-slate-400">
                        {s.fuente === "oficial" ? "SUNAT" : "simulado"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
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
            Informe generado automáticamente por ASENCOIA a partir de la información de
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

const TONE: Record<string, string> = {
  emerald: "text-emerald-600",
  blue: "text-blue-600",
  amber: "text-amber-600",
  red: "text-red-600",
  slate: "text-slate-800",
};

function Kpi({
  label,
  value,
  tone = "slate",
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 p-4">
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-2 text-2xl font-bold ${TONE[tone]}`}>{value}</p>
    </div>
  );
}

function KpiSmall({
  label,
  value,
  tone = "slate",
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-1 text-base font-bold ${TONE[tone]}`}>{value}</p>
    </div>
  );
}
