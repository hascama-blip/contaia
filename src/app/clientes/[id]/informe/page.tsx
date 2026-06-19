import Link from "next/link";
import { notFound } from "next/navigation";
import { getCliente } from "@/lib/db";
import { generarDiagnostico } from "@/lib/diagnostico";
import { compararDeclaracionSire } from "@/lib/declaracion";
import { compararAnual } from "@/lib/declaracionAnual";
import { etiquetaPeriodo } from "@/lib/sire";
import { PrintButton } from "@/components/PrintButton";
import { LogoAsenco } from "@/components/Logo";
import { SireBarChart, HallazgosDonut } from "@/components/ReporteCharts";
import { fmtFecha, fmtSoles } from "@/components/ui";
import type { NivelRiesgo, BuzonMensaje } from "@/lib/types";

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

  // --- Datos para el dashboard del informe ---
  const sire = cliente.sire ?? [];

  // Comparativo declaración mensual vs SIRE (por periodo con declaración cargada).
  const declaraciones = cliente.declaraciones ?? [];
  const sirePorPeriodo = new Map(sire.map((s) => [s.periodo, s]));
  const comparativos = declaraciones.map((dec) =>
    compararDeclaracionSire(dec, sirePorPeriodo.get(dec.periodo) ?? null)
  );
  const totalDeclaraciones = declaraciones.length;
  const periodosConDiferencia = comparativos.filter((c) => c.hayDiferencias).length;

  // Comparativo de DJ anuales (Formulario 710), año vs año.
  const declAnuales = cliente.declaracionesAnuales ?? [];
  const compAnual = declAnuales.length >= 2 ? compararAnual(declAnuales) : null;

  // Deudas tributarias (fotos OCR / manual).
  const deudas = cliente.deudas ?? [];
  const totalDeuda = deudas.reduce((a, x) => a + x.monto, 0);
  const nPeligrosos = cliente.buzon?.peligrosos?.length ?? 0;
  const nUrgentes = cliente.buzon?.urgentes?.length ?? 0;

  // Detalle de observaciones para la toma de decisiones (consolidado).
  const observacionesFinal: { texto: string; nivel: "alto" | "medio" | "info" }[] = [];
  if (sunat && sunat.estado.toUpperCase() !== "ACTIVO")
    observacionesFinal.push({ nivel: "alto", texto: `Contribuyente no ACTIVO en SUNAT (${sunat.estado}). Regularizar el RUC.` });
  if (sunat && sunat.condicion.toUpperCase() !== "HABIDO")
    observacionesFinal.push({ nivel: "alto", texto: `Condición de domicilio: ${sunat.condicion}. Actualizar para volver a HABIDO.` });
  if (totalDeuda > 0)
    observacionesFinal.push({ nivel: "alto", texto: `Deudas tributarias registradas por ${fmtSoles(totalDeuda)} (${deudas.length} concepto(s)). Evaluar pago o fraccionamiento.` });
  if (nPeligrosos > 0)
    observacionesFinal.push({ nivel: "alto", texto: `Buzón SOL: ${nPeligrosos} mensaje(s) de fiscalización / procedimientos no contenciosos. Atención inmediata.` });
  if (nUrgentes > 0)
    observacionesFinal.push({ nivel: "medio", texto: `Buzón SOL: ${nUrgentes} mensaje(s) de cobranza / valores. Revisar y responder.` });
  if (periodosConDiferencia > 0)
    observacionesFinal.push({ nivel: "medio", texto: `${periodosConDiferencia} periodo(s) con diferencias entre la declaración mensual y el SIRE. Conciliar.` });
  if (compAnual) {
    for (const c of compAnual.cuadre.filter((c) => !c.cuadra))
      observacionesFinal.push({ nivel: "medio", texto: `Balance ${c.ejercicio}: no cuadra (dif. ${fmtSoles(c.diferencia)}). Revisar Estados Financieros.` });
    for (const o of compAnual.observaciones.slice(0, 4))
      observacionesFinal.push({ nivel: "info", texto: `DJ anual — ${o}` });
  }
  for (const h of d.hallazgos.filter((h) => h.severidad === "alto" || h.severidad === "critico"))
    observacionesFinal.push({ nivel: "alto", texto: h.titulo });
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
  const peligrosos = buzon?.peligrosos ?? [];
  const urgentes = buzon?.urgentes ?? [];
  const cobranzas = urgentes.filter((m) => m.tipo === "Resolución de Cobranza");
  const valores = urgentes.filter((m) => m.tipo === "Valor");
  const fiscalizacion = peligrosos.filter((m) => m.tipo === "Fiscalización");
  const noContenciosas = peligrosos.filter((m) => m.tipo === "No Contenciosa");

  type Contingencia = { nivel: NivelRiesgo; titulo: string; detalle: string };
  const contingencias: Contingencia[] = [];
  if (fiscalizacion.length > 0)
    contingencias.push({
      nivel: "critico",
      titulo: `${fiscalizacion.length} notificación(es) de FISCALIZACIÓN`,
      detalle:
        "Procedimiento de fiscalización en curso. Máxima prioridad: responder requerimientos en plazo para evitar reparos y multas.",
    });
  if (noContenciosas.length > 0)
    contingencias.push({
      nivel: "critico",
      titulo: `${noContenciosas.length} resolución(es) NO CONTENCIOSA(S)`,
      detalle:
        "Incluye ingreso como recaudación de detracciones, devoluciones, etc. Atender con urgencia para no perder fondos/derechos.",
    });
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
  // Periodos pasados con registro SIRE no presentado (omiso).
  const hoyPer = new Date();
  const periodoActual = `${hoyPer.getFullYear()}${String(hoyPer.getMonth() + 1).padStart(2, "0")}`;
  const omisos = sire.filter(
    (s) => s.periodo < periodoActual && (!s.presentadoVentas || !s.presentadoCompras)
  );
  if (omisos.length > 0)
    contingencias.push({
      nivel: "alto",
      titulo: `${omisos.length} periodo(s) con registro SIRE no presentado`,
      detalle:
        "Riesgo de infracción por no generar/presentar el RVIE/RCE en el plazo. Regularizar.",
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

      <article className="card print-full overflow-hidden p-0">
        {/* Membrete corporativo */}
        <header className="evitar-corte">
          <div className="hero-gradient flex items-start justify-between p-6 text-white">
            <div className="flex items-center gap-3">
              <LogoAsenco dark />
              <div className="border-l border-white/25 pl-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-accent-300">Informe de gerencia</p>
                <p className="text-xs text-white/80">Diagnóstico tributario SUNAT</p>
              </div>
            </div>
            <div className="text-right text-xs text-white/80">
              <p>Emitido: {fmtFecha(d.generatedAt)}</p>
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
            <p><span className="text-slate-400">Email:</span> {cliente.email || "—"}</p>
            <p><span className="text-slate-400">Teléfono:</span> {cliente.telefono || "—"}</p>
            <p><span className="text-slate-400">Declaraciones comparadas:</span> {totalDeclaraciones}</p>
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
            label="Declaraciones c/ diferencias"
            value={`${periodosConDiferencia} / ${totalDeclaraciones}`}
            tone={periodosConDiferencia > 0 ? "red" : "emerald"}
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
          <h3 className="sec-h">
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

        {/* Buzón electrónico SUNAT (mes en curso) */}
        {buzon && (
          <section className="mt-6">
            <h3 className="sec-h">
              Buzón electrónico SUNAT — mes en curso
            </h3>
            <p className="mb-3 text-xs text-slate-500">
              {peligrosos.length} más peligroso(s) · {urgentes.length} urgente(s) ·{" "}
              {buzon.totalMensajes} mensaje(s) revisados · consultado {fmtFecha(buzon.consultadoAt)}
            </p>

            {peligrosos.length > 0 && (
              <div className="mb-3">
                <p className="mb-1 text-xs font-bold uppercase text-red-700">
                  🚨 Más peligroso — fiscalización / no contenciosas
                </p>
                <BuzonTabla mensajes={peligrosos} />
              </div>
            )}
            {urgentes.length > 0 && (
              <div className="mb-1">
                <p className="mb-1 text-xs font-bold uppercase text-orange-700">
                  ⚠ Urgente — cobranza / valores
                </p>
                <BuzonTabla mensajes={urgentes} />
              </div>
            )}
            {peligrosos.length === 0 && urgentes.length === 0 && (
              <p className="text-sm text-slate-400">
                Sin notificaciones de riesgo en el mes en curso.
              </p>
            )}
          </section>
        )}

        {/* Situación SUNAT */}
        <section className="mt-6">
          <h3 className="sec-h">
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
          <h3 className="sec-h">
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

        {/* Comparativo Declaración mensual vs SIRE */}
        {totalDeclaraciones > 0 && (
          <section className="mt-6 print-full">
            <h3 className="sec-h">
              Declaración mensual vs SIRE
            </h3>
            <p className="mb-3 text-sm text-slate-600">
              Se compararon {totalDeclaraciones} declaración(es) contra el registro SIRE.
              {periodosConDiferencia > 0 ? (
                <> <strong className="text-red-600">{periodosConDiferencia} periodo(s) con diferencias</strong> que requieren conciliación.</>
              ) : (
                <> Sin diferencias relevantes: lo declarado cuadra con el SIRE.</>
              )}
            </p>
            <div className="space-y-4">
              {comparativos.map((comp, idx) => (
                <div key={comp.periodo + idx} className="evitar-corte rounded-lg border border-slate-200 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-sm font-semibold text-slate-700">
                      {etiquetaPeriodo(comp.periodo)}
                    </p>
                    {comp.hayDiferencias ? (
                      <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
                        Con diferencias
                      </span>
                    ) : (
                      <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                        Cuadra
                      </span>
                    )}
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase text-slate-400">
                        <th className="py-1">Concepto</th>
                        <th className="py-1 text-right">Declarado</th>
                        <th className="py-1 text-right">SIRE</th>
                        <th className="py-1 text-right">Diferencia</th>
                        <th className="py-1 text-right">%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {comp.filas.map((f) => (
                        <tr key={f.concepto} className="border-t border-slate-100">
                          <td className="py-1 text-slate-600">{f.concepto}</td>
                          <td className="py-1 text-right">{fmtSoles(f.declarado)}</td>
                          <td className="py-1 text-right">
                            {f.estado === "sin-sire" ? "—" : fmtSoles(f.sire)}
                          </td>
                          <td
                            className={`py-1 text-right font-medium ${
                              f.estado === "alerta" ? "text-red-600" : "text-slate-600"
                            }`}
                          >
                            {f.estado === "sin-sire" ? "—" : fmtSoles(f.diferencia)}
                          </td>
                          <td
                            className={`py-1 text-right ${
                              f.estado === "alerta" ? "text-red-600" : "text-slate-500"
                            }`}
                          >
                            {f.estado === "sin-sire" ? "—" : `${f.porcentaje.toFixed(1)}%`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* DJ Anual — comparativo año vs año (Formulario 710) */}
        {compAnual && (
          <section className="mt-6 print-full">
            <h3 className="sec-h">
              DJ Anual — comparativo año vs año
            </h3>
            <div className="mb-3 flex flex-wrap gap-2">
              {compAnual.cuadre.map((c) => (
                <span
                  key={c.ejercicio}
                  className={`rounded px-2 py-0.5 text-xs font-semibold ${
                    c.cuadra ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
                  }`}
                >
                  {c.ejercicio}: {c.cuadra ? "Balance cuadra" : `No cuadra (dif. ${fmtInt(c.diferencia)})`}
                </span>
              ))}
            </div>

            {compAnual.observaciones.length > 0 && (
              <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
                <p className="mb-1 text-xs font-bold uppercase text-amber-700">Observaciones — variaciones importantes</p>
                <ul className="list-disc space-y-0.5 pl-5 text-sm text-slate-700">
                  {compAnual.observaciones.map((o, i) => (
                    <li key={i}>{o}</li>
                  ))}
                </ul>
              </div>
            )}

            <p className="rompe-no mb-1 text-xs font-bold uppercase tracking-wide text-brand-700">Estados Financieros</p>
            <div className="grid gap-3 md:grid-cols-2">
              <MiniTablaInforme titulo="Activo" filas={compAnual.activo} ejercicios={compAnual.ejercicios} />
              <div className="space-y-3">
                <MiniTablaInforme titulo="Pasivo" filas={compAnual.pasivo} ejercicios={compAnual.ejercicios} />
                <MiniTablaInforme titulo="Patrimonio" filas={compAnual.patrimonio} ejercicios={compAnual.ejercicios} />
              </div>
            </div>

            <p className="rompe-no mb-1 mt-3 text-xs font-bold uppercase tracking-wide text-brand-700">Estado de Resultados</p>
            {compAnual.resultadosVacio ? (
              <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500">
                No se registraron movimientos: no hubo operaciones en el año.
              </p>
            ) : (
              <MiniTablaInforme titulo="" filas={compAnual.resultados} ejercicios={compAnual.ejercicios} />
            )}
          </section>
        )}

        {/* Deudas tributarias (agrupadas por sección F36) */}
        {deudas.length > 0 && (
          <section className="mt-6 print-full">
            <h3 className="sec-h">
              Deudas tributarias
            </h3>
            {Array.from(
              deudas.reduce((map, d) => {
                const k = d.seccion || "Sin sección";
                if (!map.has(k)) map.set(k, [] as typeof deudas);
                map.get(k)!.push(d);
                return map;
              }, new Map<string, typeof deudas>())
            ).map(([seccion, lista]) => {
              const sub = lista.reduce((a, x) => a + x.monto, 0);
              return (
                <div key={seccion} className="mb-3 overflow-hidden rounded-lg border border-slate-200">
                  <div className="flex items-center justify-between bg-slate-100 px-3 py-1 text-xs font-bold uppercase text-slate-600">
                    <span>{seccion}</span>
                    <span>{fmtSoles(sub)}</span>
                  </div>
                  <table className="w-full text-sm">
                    <tbody>
                      {lista.map((x) => (
                        <tr key={x.id} className="border-t border-slate-100">
                          <td className="px-3 py-1 font-medium text-slate-700">{x.tipo}</td>
                          <td className="px-3 py-1 text-slate-500">{x.periodo || "—"}</td>
                          <td className="px-3 py-1 text-slate-400">{x.numero || ""}</td>
                          <td className="px-3 py-1 text-right font-semibold text-red-600">{fmtSoles(x.monto)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })}
            <p className="text-right text-sm font-bold text-red-700">TOTAL DEUDA: {fmtSoles(totalDeuda)}</p>
          </section>
        )}

        {/* Compras y Ventas (SIRE) */}
        {cliente.sire && cliente.sire.length > 0 && (
          <section className="mt-6">
            <h3 className="sec-h">
              Compras y Ventas (SIRE)
            </h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-400">
                  <th className="py-1.5">Periodo</th>
                  <th className="py-1.5 text-right">Ventas</th>
                  <th className="py-1.5 text-right">Compras</th>
                  <th className="py-1.5 text-right">Diferencia</th>
                  <th className="py-1.5 text-center">Ventas (RVIE)</th>
                  <th className="py-1.5 text-center">Compras (RCE)</th>
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
                      <td className="py-1.5 text-center">
                        <EstadoPresentacion ok={s.presentadoVentas} />
                      </td>
                      <td className="py-1.5 text-center">
                        <EstadoPresentacion ok={s.presentadoCompras} />
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
          <h3 className="sec-h">
            Recomendaciones
          </h3>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">
            {d.recomendaciones.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ol>
        </section>

        {/* Detalle de observaciones para la toma de decisiones */}
        <section className="mt-6 print-full">
          <h3 className="sec-h">
            Observaciones para la toma de decisiones
          </h3>
          {observacionesFinal.length === 0 ? (
            <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-700">
              No se detectaron observaciones críticas. Mantener al día declaraciones y pagos.
            </p>
          ) : (
            <ol className="space-y-2">
              {observacionesFinal.map((o, i) => (
                <li
                  key={i}
                  className={`flex gap-3 rounded-lg border-l-4 p-3 text-sm ${
                    o.nivel === "alto"
                      ? "border-l-red-500 bg-red-50 text-slate-700"
                      : o.nivel === "medio"
                        ? "border-l-amber-500 bg-amber-50 text-slate-700"
                        : "border-l-brand-400 bg-brand-50 text-slate-700"
                  }`}
                >
                  <span className="font-bold text-slate-400">{i + 1}.</span>
                  <span>
                    {o.texto}
                    <span className="ml-2 text-[10px] font-semibold uppercase text-slate-400">
                      [{o.nivel === "alto" ? "prioridad alta" : o.nivel === "medio" ? "prioridad media" : "informativo"}]
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <footer className="mt-8 border-t border-slate-200 pt-4 text-xs text-slate-400">
          <p>
            Informe generado automáticamente por ASENCOIA a partir de la información de
            SUNAT y los documentos cargados. Debe ser validado por un contador o auditor
            colegiado antes de su uso formal.
          </p>
        </footer>
        </div>
      </article>
    </div>
  );
}

function fmtInt(n: number): string {
  const abs = Math.abs(Math.round(n)).toLocaleString("es-PE");
  return n < 0 ? `(${abs})` : abs;
}

function MiniTablaInforme({
  titulo,
  filas,
  ejercicios,
}: {
  titulo: string;
  filas: import("@/lib/declaracionAnual").FilaAnual[];
  ejercicios: string[];
}) {
  if (filas.length === 0) return null;
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200">
      {titulo && (
        <div className="bg-brand-700 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-white">
          {titulo}
        </div>
      )}
      <table className="w-full text-[10px]">
        <thead>
          <tr className="bg-slate-50 text-right text-[9px] uppercase text-slate-400">
            <th className="px-2 py-1 text-left">Concepto</th>
            {ejercicios.map((y) => (
              <th key={y} className="px-2 py-1">{y}</th>
            ))}
            <th className="px-2 py-1">Var.</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => (
            <tr
              key={f.codigo}
              className={`border-t border-slate-100 ${
                f.esTotal ? "bg-brand-50 font-bold text-brand-900" : f.resaltar ? "bg-amber-50" : ""
              }`}
            >
              <td className="px-2 py-1 text-left text-slate-600">
                {f.resaltar && !f.esTotal && "🔶 "}
                {f.etiqueta}
              </td>
              {ejercicios.map((y) => (
                <td key={y} className="px-2 py-1 text-right tabular-nums text-slate-700">
                  {fmtInt(f.valores[y] ?? 0)}
                </td>
              ))}
              <td
                className={`px-2 py-1 text-right tabular-nums ${
                  f.variacion > 0 ? "text-emerald-600" : f.variacion < 0 ? "text-red-600" : "text-slate-300"
                }`}
              >
                {f.variacion > 0 ? "+" : ""}
                {fmtInt(f.variacion)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EstadoPresentacion({ ok }: { ok: boolean }) {
  return (
    <span className={`badge ${ok ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
      {ok ? "Presentado" : "No presentado"}
    </span>
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
          <tr key={m.id}>
            <td className="py-1.5 pr-2 align-top whitespace-nowrap text-slate-500">{m.fecha}</td>
            <td className="py-1.5 pr-2 align-top">
              <span
                className={`badge ${m.nivel === "peligroso" ? "bg-red-100 text-red-700" : "bg-orange-100 text-orange-700"}`}
              >
                {m.tipo || "—"}
              </span>
            </td>
            <td className="py-1.5 text-slate-700">{m.asunto}</td>
          </tr>
        ))}
      </tbody>
    </table>
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
