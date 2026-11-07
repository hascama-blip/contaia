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
    { header: "RxH excluidos", key: "rh", width: 12 },
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
      rh: e.excluidos?.honorarios ?? 0,
    });
    for (const k of ["tSire", "tCont", "dif"]) row.getCell(k).numFmt = "#,##0.00";
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
