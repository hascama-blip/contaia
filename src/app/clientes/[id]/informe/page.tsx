import Link from "next/link";
import { notFound } from "next/navigation";
import { getClienteDeUsuario } from "@/lib/db";
import { requireUser, studioId } from "@/lib/auth";
import { generarDiagnostico } from "@/lib/diagnostico";
import { compararDeclaracionSire } from "@/lib/declaracion";
import { compararAnual } from "@/lib/declaracionAnual";
import { etiquetaPeriodo } from "@/lib/sire";
import { PrintButton, DescargarPdfBtn } from "@/components/PrintButton";
import { LogoAsenco } from "@/components/Logo";
import { fmtFecha, fmtSoles } from "@/components/ui";
import type { BuzonMensaje } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function InformePage({ params }: { params: { id: string } }) {
  const user = await requireUser();
  const cliente = await getClienteDeUsuario(params.id, studioId(user));
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

  // Deudas tributarias extraídas de SUNAT (Fraccionamiento F36).
  const deudasF36 = cliente.deudasF36?.tablas ?? [];
  const idxDeudaCol = (headers: string[]) =>
    headers.findIndex((h) => /deuda a acogerse|deuda|importe|monto/i.test(h));
  const aNum = (s: string) => Number(String(s).replace(/[^\d.-]/g, "")) || 0;
  const totalDeuda = deudasF36.reduce((acc, t) => {
    const ci = idxDeudaCol(t.headers);
    if (ci < 0) return acc;
    return acc + t.filas.reduce((a, f) => a + aNum(f[ci] ?? ""), 0);
  }, 0);
  const nDeudas = deudasF36.reduce((a, t) => a + t.filas.length, 0);
  const nPeligrosos = cliente.buzon?.peligrosos?.length ?? 0;
  const nUrgentes = cliente.buzon?.urgentes?.length ?? 0;

  // Detalle de observaciones para la toma de decisiones (consolidado).
  const observacionesFinal: { texto: string; nivel: "alto" | "medio" | "info" }[] = [];
  if (sunat && sunat.estado.toUpperCase() !== "ACTIVO")
    observacionesFinal.push({ nivel: "alto", texto: `Contribuyente no ACTIVO en SUNAT (${sunat.estado}). Regularizar el RUC.` });
  if (sunat && sunat.condicion.toUpperCase() !== "HABIDO")
    observacionesFinal.push({ nivel: "alto", texto: `Condición de domicilio: ${sunat.condicion}. Actualizar para volver a HABIDO.` });
  if (totalDeuda > 0)
    observacionesFinal.push({ nivel: "alto", texto: `Deudas tributarias en SUNAT por ${fmtSoles(totalDeuda)} (${nDeudas} valor(es)). Evaluar pago o fraccionamiento.` });
  if (cliente.deudasF36?.nota)
    observacionesFinal.push({ nivel: "alto", texto: `SUNAT (fraccionamiento): ${cliente.deudasF36.nota}` });
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
  const nPeriodos = sire.length;

  // Serie cronológica (ascendente) para el gráfico de ingresos vs gastos.
  const serieCron = [...sire].sort((a, b) => a.periodo.localeCompare(b.periodo));
  const datosGrafico = serieCron.map((s) => ({
    periodo: s.periodo,
    ventas: s.ventas.importeTotal,
    compras: s.compras.importeTotal,
  }));

  // --- Buzón ---
  const buzon = cliente.buzon;
  const peligrosos = buzon?.peligrosos ?? [];
  const urgentes = buzon?.urgentes ?? [];
  // TODOS los mensajes del buzón (no solo los de riesgo) para listarlos completos.
  const todosMensajes = buzon?.mensajes?.length ? buzon.mensajes : [...peligrosos, ...urgentes];
  // Comentarios (seguimiento) por mensaje, para dar alcance en el informe.
  const comentariosBuzon = new Map<string, string>();
  for (const s of cliente.seguimientosBuzon ?? []) {
    if (s.comentario && s.comentario.trim()) comentariosBuzon.set(s.codMensaje, s.comentario.trim());
  }
  const buzonNotificaciones = todosMensajes.filter((m) => m.origen !== "mensajes");
  const buzonMensajes = todosMensajes.filter((m) => m.origen === "mensajes");

  return (
    <div className="mx-auto max-w-4xl">
      <div className="no-print mb-4 flex items-center justify-between gap-3">
        <Link href={`/clientes/${cliente.id}`} className="text-sm text-brand-600 hover:underline">
          ← Volver al cliente
        </Link>
        <div className="flex items-center gap-2">
          <PrintButton />
          <DescargarPdfBtn clienteId={cliente.id} />
        </div>
      </div>

      <article className="card print-full overflow-hidden p-0">
        {/* Membrete corporativo */}
        <header className="evitar-corte">
          <div className="hero-gradient flex flex-col gap-3 p-4 text-white sm:flex-row sm:items-start sm:justify-between sm:p-6">
            <div className="flex items-center gap-3">
              <LogoAsenco dark />
              <div className="border-l border-white/25 pl-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-accent-300">Informe de gerencia</p>
                <p className="text-xs text-white/80">Diagnóstico tributario SUNAT</p>
              </div>
            </div>
            <div className="text-xs text-white/80 sm:text-right">
              <p>Emitido: {fmtFecha(d.generatedAt)}</p>
              <p>Documento confidencial</p>
            </div>
          </div>
          <div className="h-1.5 bg-accent-400" />
        </header>

        <div className="p-4 pt-5 sm:p-8 sm:pt-6">
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

        {/* ===== DATOS DE CONSULTA RUC (primero) ===== */}
        <section className="mt-5 isla rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="sec-h">
            Situación registral SUNAT (consulta RUC)
          </h3>
          {sunat ? (
            <table className="w-full text-sm">
              <tbody className="divide-y divide-slate-100">
                <Row k="Razón social" v={sunat.razonSocial} />
                <Row k="Estado del contribuyente" v={sunat.estado} />
                <Row k="Condición de domicilio" v={sunat.condicion} />
                <Row k="Tipo de contribuyente" v={sunat.tipoContribuyente} />
                <Row k="Domicilio fiscal" v={sunat.direccion} />
                {sunat.fechaInscripcion && <Row k="Fecha de inscripción" v={sunat.fechaInscripcion} />}
                {sunat.fechaInicioActividades && <Row k="Inicio de actividades" v={sunat.fechaInicioActividades} />}
                <Row k="Emisor electrónico" v={sunat.comprobanteElectronico ? "Sí" : "No"} />
                <Row k="Tributos / régimen" v={sunat.tributos.join(", ") || "—"} />
                <Row k="Fuente del dato" v={sunat.fuente === "oficial" ? "API oficial SUNAT" : "Simulado (demo)"} />
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-slate-400">No se realizó consulta SUNAT.</p>
          )}
        </section>

        {/* ===== Resumen (puntaje + acumulados) ===== */}
        <section className="mt-5 isla rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="sec-h">Resumen</h3>
          <div className="grid gap-4 md:grid-cols-2">
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
          </div>
          <div className="mt-3 grid grid-cols-2 gap-4">
            <KpiSmall label="IGV ventas (acum.)" value={fmtSoles(igvVentasAcum)} />
            <KpiSmall label="IGV compras (acum.)" value={fmtSoles(igvComprasAcum)} />
          </div>
        </section>

        {/* ===== Gráfico de ingresos (ventas) vs gastos (compras) por periodo ===== */}
        {datosGrafico.length >= 2 && (
          <section className="mt-5 isla rounded-xl border border-slate-200 bg-white p-4">
            <h3 className="sec-h">Ingresos y gastos por periodo</h3>
            <p className="mb-3 text-xs text-slate-500">
              Evolución de las ventas (ingresos) y las compras (gastos) según el SIRE.
            </p>
            <GraficoIngresosGastos datos={datosGrafico} />
          </section>
        )}

        {/* ===== 1) BUZÓN — todos los mensajes ===== */}
        {buzon && (
          <section className="mt-5 isla rounded-xl border border-slate-200 bg-white p-4">
            <h3 className="sec-h">
              Consulta de buzón electrónico
            </h3>
            <p className="mb-3 text-xs text-slate-500">
              {peligrosos.length} más peligroso(s) · {urgentes.length} urgente(s) ·{" "}
              {todosMensajes.length} mensaje(s) en total · consultado {fmtFecha(buzon.consultadoAt)}
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
              <div className="mb-3">
                <p className="mb-1 text-xs font-bold uppercase text-orange-700">
                  ⚠ Urgente — cobranza / valores
                </p>
                <BuzonTabla mensajes={urgentes} />
              </div>
            )}

            {/* Dividido en secciones: Notificaciones y Mensajes, con comentario */}
            <div className="mb-3">
              <p className="mb-1 text-xs font-bold uppercase text-brand-700">
                Notificaciones ({buzonNotificaciones.length})
              </p>
              {buzonNotificaciones.length > 0 ? (
                <BuzonTablaCompleta mensajes={buzonNotificaciones} comentarios={comentariosBuzon} />
              ) : (
                <p className="text-sm text-slate-400">Sin notificaciones.</p>
              )}
            </div>
            <div>
              <p className="mb-1 text-xs font-bold uppercase text-brand-700">
                Mensajes ({buzonMensajes.length})
              </p>
              {buzonMensajes.length > 0 ? (
                <BuzonTablaCompleta mensajes={buzonMensajes} comentarios={comentariosBuzon} />
              ) : (
                <p className="text-sm text-slate-400">Sin mensajes.</p>
              )}
            </div>
          </section>
        )}

        {/* ===== 2) ESTADO DE PRESENTACIÓN SIRE (aparte de los montos) ===== */}
        {cliente.sire && cliente.sire.length > 0 && (
          <section className="mt-5 isla rounded-xl border border-slate-200 bg-white p-4">
            <h3 className="sec-h">
              Consulta de presentación SIRE (RVIE / RCE)
            </h3>
            <p className="mb-3 text-xs text-slate-500">
              Estado de presentación por periodo de los registros de ventas (RVIE) y compras (RCE).
            </p>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-400">
                  <th className="py-1.5">Periodo</th>
                  <th className="py-1.5 text-center">Ventas (RVIE)</th>
                  <th className="py-1.5 text-center">Compras (RCE)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {cliente.sire.map((s) => (
                  <tr key={s.periodo}>
                    <td className="py-1.5 text-slate-700">{etiquetaPeriodo(s.periodo)}</td>
                    <td className="py-1.5 text-center"><EstadoPresentacion ok={s.presentadoVentas} /></td>
                    <td className="py-1.5 text-center"><EstadoPresentacion ok={s.presentadoCompras} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {/* ===== 3) FRACCIONAMIENTO / DEUDAS TRIBUTARIAS (SUNAT) ===== */}
        {/* Mensaje de bloqueo de SUNAT (p.ej. "Tiene deuda pendiente por Perdida") */}
        {cliente.deudasF36?.nota && (
          <section className="mt-5 isla rounded-xl border border-slate-200 bg-white p-4">
            <h3 className="sec-h">Deuda tributaria y/o fraccionamiento</h3>
            <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              ⚠ SUNAT: {cliente.deudasF36.nota}
            </p>
          </section>
        )}
        {/* Sin deudas: mensaje positivo si se consultó y no hay pendientes */}
        {cliente.deudasF36?.at && nDeudas === 0 && !cliente.deudasF36?.nota && (
          <section className="mt-5 isla rounded-xl border border-slate-200 bg-white p-4">
            <h3 className="sec-h">Deuda tributaria y/o fraccionamiento</h3>
            <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              Esta empresa no cuenta con deudas pendientes de acoger al fraccionamiento (consultado {fmtFecha(cliente.deudasF36.at)}).
            </p>
          </section>
        )}
        {/* Deudas tributarias (Fraccionamiento F36, por sección) */}
        {nDeudas > 0 && (
          <section className="mt-5 isla rounded-xl border border-slate-200 bg-white p-4">
            <h3 className="sec-h">Deuda tributaria y/o fraccionamiento</h3>
            {deudasF36.filter((t) => t.filas.length > 0).map((t) => (
              <div key={t.pestana} className="evitar-corte mb-3 overflow-hidden rounded-lg border border-slate-200">
                <div className="bg-slate-100 px-3 py-1 text-xs font-bold uppercase text-slate-600">{t.pestana}</div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-left text-[11px] uppercase text-slate-400">
                        {t.headers.map((h, i) => <th key={i} className="whitespace-nowrap px-3 py-1">{h}</th>)}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {t.filas.map((f, r) => (
                        <tr key={r}>{f.map((c, i) => <td key={i} className="whitespace-nowrap px-3 py-1 text-slate-700">{c}</td>)}</tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
            <p className="text-right text-sm font-bold text-red-700">TOTAL DEUDA A ACOGERSE: {fmtSoles(totalDeuda)}</p>
            {cliente.deudasF36?.at && (
              <p className="text-right text-[11px] text-slate-400">Extraído de SUNAT: {fmtFecha(cliente.deudasF36.at)}</p>
            )}
          </section>
        )}

        {/* ===== 4) COMPRAS Y VENTAS (SIRE) — MONTOS ===== */}
        {cliente.sire && cliente.sire.length > 0 && (
          <section className="mt-5 isla rounded-xl border border-slate-200 bg-white p-4">
            <h3 className="sec-h">
              Compras y Ventas (SIRE) — montos
            </h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-400">
                  <th className="py-1.5">Periodo</th>
                  <th className="py-1.5 text-right">Ventas</th>
                  <th className="py-1.5 text-right">Compras</th>
                  <th className="py-1.5 text-right">Diferencia</th>
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
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        )}

        {/* ===== 5) COMPARATIVO MENSUAL — Declaración vs SIRE ===== */}
        {totalDeclaraciones > 0 && (
          <section className="mt-5 isla rounded-xl border border-slate-200 bg-white p-4">
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
              {comparativos.map((comp, idx) => {
                const noPresento = declaraciones[idx]?.noPresento;
                if (noPresento) {
                  return (
                    <div key={comp.periodo + idx} className="evitar-corte flex items-center justify-between rounded-lg border border-red-200 bg-red-50 p-3">
                      <p className="text-sm font-semibold text-slate-700">{etiquetaPeriodo(comp.periodo)}</p>
                      <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">NO PRESENTÓ</span>
                    </div>
                  );
                }
                return (
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
                );
              })}
            </div>
          </section>
        )}

        {/* DJ Anual — comparativo año vs año (Formulario 710) */}
        {compAnual && (
          <section className="mt-5 isla rounded-xl border border-slate-200 bg-white p-4">
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

        {/* ===== Acción (recomendaciones) ===== */}
        <section className="mt-5 isla rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="sec-h">
            Acción
          </h3>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">
            {d.recomendaciones.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ol>
        </section>

        {/* ===== Ejecución (observaciones para la toma de decisiones) ===== */}
        <section className="mt-5 isla rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="sec-h">
            Ejecución
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
            Informe generado automáticamente por{" "}
            <span translate="no" className="font-semibold text-slate-500">RADAR TRIBUTAR·IA</span>{" "}
            <span translate="no">· by </span>
            <span translate="no" className="font-semibold text-slate-500">ASENCO</span>{" "}
            a partir de la información de SUNAT y los documentos cargados.{" "}
            <span className="font-semibold text-slate-500">Este informe es confidencial</span>{" "}
            y debe ser validado por un contador o auditor colegiado antes de su uso formal.
          </p>
          {/* Fuente: logo de SUNAT a color, pequeño (~20% del tamaño anterior) */}
          <div className="mt-3 flex items-center gap-2">
            <span className="font-semibold text-slate-500">Fuente:</span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-sunat.png" alt="SUNAT" className="h-[60px] w-auto" />
          </div>
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

// "YYYYMM" -> "Ene 26" (etiqueta corta para el eje X del gráfico).
function perCorto(periodo: string): string {
  const meses = ["", "Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  const m = Number(periodo.slice(4, 6));
  return `${meses[m] ?? periodo.slice(4, 6)} ${periodo.slice(2, 4)}`;
}

// Gráfico de líneas Ventas (ingresos) vs Compras (gastos) por periodo.
// SVG puro (sin librerías) para que imprima limpio en el informe.
function GraficoIngresosGastos({
  datos,
}: {
  datos: { periodo: string; ventas: number; compras: number }[];
}) {
  const W = 760, H = 280;
  const M = { t: 16, r: 18, b: 44, l: 68 };
  const iw = W - M.l - M.r;
  const ih = H - M.t - M.b;
  const maxV = Math.max(1, ...datos.map((d) => Math.max(d.ventas, d.compras)));
  const pow = Math.pow(10, Math.floor(Math.log10(maxV)));
  const maxY = Math.ceil(maxV / pow) * pow || 1;
  const n = datos.length;
  const x = (i: number) => M.l + (n <= 1 ? iw / 2 : (iw * i) / (n - 1));
  const y = (v: number) => M.t + ih * (1 - v / maxY);
  const path = (key: "ventas" | "compras") =>
    datos.map((d, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(d[key]).toFixed(1)}`).join(" ");
  const ticks = 4;
  const gridY = Array.from({ length: ticks + 1 }, (_, i) => (maxY / ticks) * i);
  const fmtEje = (v: number) =>
    v >= 1000 ? `${(v / 1000).toLocaleString("es-PE", { maximumFractionDigits: 1 })}k` : String(Math.round(v));

  const VENTAS = "#059669"; // emerald-600 (ingresos)
  const COMPRAS = "#2563eb"; // blue-600 (gastos)

  return (
    <div className="overflow-x-auto">
      <div className="mb-2 flex flex-wrap gap-4 text-xs">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: VENTAS }} />
          <span className="text-slate-600">Ventas (ingresos)</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: COMPRAS }} />
          <span className="text-slate-600">Compras (gastos)</span>
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Ingresos y gastos por periodo">
        {gridY.map((v, i) => (
          <g key={i}>
            <line x1={M.l} y1={y(v)} x2={W - M.r} y2={y(v)} stroke="#e2e8f0" strokeWidth={1} />
            <text x={M.l - 8} y={y(v) + 3} textAnchor="end" fontSize={10} fill="#94a3b8">
              S/ {fmtEje(v)}
            </text>
          </g>
        ))}
        {datos.map((d, i) => (
          <text key={i} x={x(i)} y={H - M.b + 18} textAnchor="middle" fontSize={10} fill="#64748b">
            {perCorto(d.periodo)}
          </text>
        ))}
        <path d={path("compras")} fill="none" stroke={COMPRAS} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />
        <path d={path("ventas")} fill="none" stroke={VENTAS} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />
        {datos.map((d, i) => (
          <g key={i}>
            <circle cx={x(i)} cy={y(d.compras)} r={3} fill={COMPRAS} />
            <circle cx={x(i)} cy={y(d.ventas)} r={3} fill={VENTAS} />
          </g>
        ))}
      </svg>
    </div>
  );
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

function BuzonTablaCompleta({
  mensajes,
  comentarios,
}: {
  mensajes: BuzonMensaje[];
  comentarios?: Map<string, string>;
}) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-400">
          <th className="py-1.5">Fecha</th>
          <th className="py-1.5">Tipo</th>
          <th className="py-1.5">Asunto</th>
          <th className="py-1.5">Comentario</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {mensajes.map((m) => (
          <tr key={m.id}>
            <td className="py-1.5 pr-2 align-top whitespace-nowrap text-slate-500">{m.fecha}</td>
            <td className="py-1.5 pr-2 align-top">
              {m.nivel === "otro" ? (
                <span className="text-xs text-slate-400">Informativa</span>
              ) : (
                <span className={`badge ${m.nivel === "peligroso" ? "bg-red-100 text-red-700" : "bg-orange-100 text-orange-700"}`}>
                  {m.tipo || "—"}
                </span>
              )}
            </td>
            <td className="py-1.5 pr-2 align-top text-slate-700">{m.asunto}</td>
            <td className="py-1.5 align-top text-slate-600">{comentarios?.get(m.id) || "—"}</td>
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
