import { bloqueoModulo } from "@/lib/acceso";
import { NextRequest, NextResponse } from "next/server";
import { zipSync } from "fflate";
import ExcelJS from "exceljs";
import { requireUser } from "@/lib/auth";
import { construirExcelCruce } from "@/lib/xlsxIO";
import type { ConciliacionEmpresa } from "@/lib/conciliacionSire";

export const runtime = "nodejs";
export const maxDuration = 120;

const slug = (s: string) =>
  String(s || "empresa").replace(/\./g, "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "empresa";

// POST JSON { empresas: ConciliacionEmpresa[] } → ZIP con UN Excel de conciliación
// por empresa (SIRE vs contabilidad, ventas o compras) + un resumen de todas.
export async function POST(req: NextRequest) {
  const _bloqueo = await bloqueoModulo("analisis-rtp"); if (_bloqueo) return _bloqueo;
  await requireUser();
  const body = await req.json().catch(() => null);
  const empresas: ConciliacionEmpresa[] = Array.isArray(body?.empresas)
    ? body.empresas.filter((e: any) => e?.cruce && Array.isArray(e.cruce.filas)).slice(0, 40)
    : [];
  // Empresas de las pestañas sin SIRE todavía: van al resumen para que no falte ninguna.
  const faltantes: { empresa: string; ruc: string; libro: string; periodo: string; motivo: string; comprobantes: number; total: number }[] = Array.isArray(body?.faltantes)
    ? body.faltantes.slice(0, 80).map((f: any) => ({ empresa: String(f?.empresa ?? "").slice(0, 120), ruc: String(f?.ruc ?? "").replace(/\D/g, "").slice(0, 11), libro: f?.libro === "compras" ? "compras" : "ventas", periodo: String(f?.periodo ?? "").replace(/\D/g, "").slice(0, 6), motivo: f?.motivo === "sin-cliente" ? "sin-cliente" : "sin-detalle", comprobantes: Number(f?.comprobantes) || 0, total: Number(f?.total) || 0 }))
    : [];
  if (!empresas.length) return NextResponse.json({ error: "No hay conciliaciones que exportar." }, { status: 400 });

  const archivos: Record<string, Uint8Array> = {};
  for (const [i, e] of empresas.entries()) {
    const libro = e.libro === "compras" ? "compras" : "ventas";
    const buf = await construirExcelCruce({ periodo: e.periodo, ruc: e.ruc, razonSocial: e.empresa, [libro]: e.cruce, generadoAt: new Date().toISOString() });
    archivos[`${String(i + 1).padStart(2, "0")}-${slug(e.empresa)}-${libro}${e.periodo ? `-${e.periodo}` : ""}.xlsx`] = new Uint8Array(buf);
  }

  // Resumen de todas las empresas.
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Resumen");
  ws.columns = [
    { header: "Empresa", key: "empresa", width: 34 },
    { header: "RUC", key: "ruc", width: 13 },
    { header: "Libro", key: "libro", width: 9 },
    { header: "Periodo", key: "periodo", width: 9 },
    { header: "Comprob. SIRE", key: "nSire", width: 13 },
    { header: "Total SIRE (S/)", key: "tSire", width: 16 },
    { header: "Comprob. contables", key: "nCont", width: 16 },
    { header: "Total contable (S/)", key: "tCont", width: 18 },
    { header: "Diferencia total", key: "dif", width: 16 },
    { header: "Coinciden", key: "ok", width: 10 },
    { header: "Dif. montos", key: "difMonto", width: 11 },
    { header: "Dif. fecha", key: "difFecha", width: 10 },
    { header: "Solo SIRE", key: "soloSire", width: 10 },
    { header: "Solo contable", key: "soloCont", width: 12 },
    { header: "Conciliadas con subdiario", key: "sub", width: 14 },
    { header: "Vence DJ mensual", key: "vence", width: 15 },
    { header: "Días hábiles para regularizar", key: "habiles", width: 15 },
    { header: "Estado de cierre", key: "estadoCierre", width: 16 },
    { header: "RxH excluidos", key: "rh", width: 12 },
    { header: "Situación", key: "situacion", width: 34 },
  ];
  ws.getRow(1).eachCell((c) => { c.font = { bold: true, color: { argb: "FFFFFFFF" } }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF102B4D" } }; });
  for (const e of empresas) {
    const c = e.cruce;
    const row = ws.addRow({
      empresa: e.empresa, ruc: e.ruc, libro: e.libro === "compras" ? "Compras" : "Ventas", periodo: e.periodo,
      nSire: c.totalesSire.comprobantes, tSire: c.totalesSire.total,
      nCont: c.totalesContable.comprobantes, tCont: c.totalesContable.total,
      dif: Math.round((c.totalesSire.total - c.totalesContable.total) * 100) / 100,
      ok: c.ok, difMonto: c.difMonto, difFecha: c.difFecha, soloSire: c.soloSire, soloCont: c.soloContable,
      sub: e.subdiario?.conciliados ?? 0,
      vence: e.cierre?.vence ?? "",
      habiles: e.cierre ? (e.cierre.diasCalendario < 0 ? `${-e.cierre.diasCalendario} día(s) de atraso` : e.cierre.diasHabiles) : "",
      estadoCierre: ({ vencido: "VENCIDO", "vence-hoy": "Vence hoy", urgente: "Urgente", "en-plazo": "En plazo" } as Record<string, string>)[e.cierre?.estado ?? ""] ?? "",
      rh: e.excluidos?.honorarios ?? 0,
      situacion: !c.totalesSire.comprobantes && !c.totalesContable.comprobantes ? "Sin movimiento (ni en contabilidad ni en SIRE)" : !c.totalesContable.comprobantes ? "Nada en contabilidad: todo está solo en SIRE" : !c.totalesSire.comprobantes ? "SIRE sin movimiento: todo está solo en contabilidad" : "Conciliada",
    });
    for (const k of ["tSire", "tCont", "dif"]) row.getCell(k).numFmt = "#,##0.00";
  }
  for (const f of faltantes) {
    const row = ws.addRow({
      empresa: f.empresa, ruc: f.ruc, libro: f.libro === "compras" ? "Compras" : "Ventas", periodo: f.periodo,
      nCont: f.comprobantes, tCont: f.total,
      situacion: f.motivo === "sin-cliente" ? "SIN CONCILIAR: la empresa no está en Clientes" : "SIN CONCILIAR: falta descargar el Detalle SIRE",
    });
    row.getCell("tCont").numFmt = "#,##0.00";
    row.eachCell({ includeEmpty: true }, (c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } }; });
  }
  ws.views = [{ state: "frozen", ySplit: 1 }];
  archivos["00-RESUMEN-conciliacion.xlsx"] = new Uint8Array(await wb.xlsx.writeBuffer());

  const zip = zipSync(archivos, { level: 6 });
  return new NextResponse(Buffer.from(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="conciliacion-sire-por-empresa${empresas[0]?.periodo ? `-${empresas[0].periodo}` : ""}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}
