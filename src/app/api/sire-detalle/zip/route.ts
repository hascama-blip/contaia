import { bloqueoModulo } from "@/lib/acceso";
import { NextRequest, NextResponse } from "next/server";
import { zipSync } from "fflate";
import ExcelJS from "exceljs";
import { getClienteAutorizado } from "@/lib/auth";
import { excelDetalleSire } from "@/lib/sireDetalleExcel";
import { VERSION_NO_INCLUIDOS } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_PERIODOS = 24;
const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Setiembre", "Octubre", "Noviembre", "Diciembre"];
const slug = (s: string) => String(s || "empresa").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "empresa";
const num = (v: unknown) => { const n = Number(String(v ?? "").replace(/,/g, "")); return Number.isFinite(n) ? n : 0; };

// POST JSON { clienteId, tipo: "ventas" | "compras", periodos: ["AAAAMM", …] }
// → ZIP con UN Excel por mes (el Detalle SIRE YA EXTRAÍDO y guardado de esa empresa) + un resumen.
// No consulta SUNAT: la pantalla extrae primero cada mes del rango (lo guardado no se vuelve a pedir).
export async function POST(req: NextRequest) {
  const _bloqueo = await bloqueoModulo("detalle-sire"); if (_bloqueo) return _bloqueo;
  const body = await req.json().catch(() => null);
  const cliente = await getClienteAutorizado(String(body?.clienteId ?? ""));
  if (!cliente) return NextResponse.json({ error: "Empresa no encontrada." }, { status: 404 });
  const tipo: "ventas" | "compras" = body?.tipo === "ventas" ? "ventas" : "compras";
  const periodos: string[] = Array.from(new Set<string>((Array.isArray(body?.periodos) ? body.periodos : []).map((p: unknown) => String(p)).filter((p: string) => /^\d{6}$/.test(p)))).sort().slice(0, MAX_PERIODOS);
  if (!periodos.length) return NextResponse.json({ error: "Indica los periodos (AAAAMM)." }, { status: 400 });

  const archivos: Record<string, Uint8Array> = {};
  const libro = tipo === "ventas" ? "RVIE" : "RCE";
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Resumen");
  ws.columns = [{ header: "Periodo", width: 10 }, { header: "Mes", width: 18 }, { header: "Comprobantes", width: 14 }, { header: "Total CP", width: 16 }, { header: tipo === "ventas" ? "No incluidos" : "Excluidos", width: 14 }, { header: "Situación", width: 46 }, { header: "Extraído de SUNAT", width: 20 }];
  ws.getRow(1).eachCell((c) => { c.font = { bold: true, color: { argb: "FFFFFFFF" } }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF102B4D" } }; });
  let incluidos = 0;
  for (const p of periodos) {
    const mes = `${MESES[Number(p.slice(4)) - 1] ?? ""} ${p.slice(0, 4)}`;
    const cache = cliente.sireDetalle?.[`${tipo}-${p}`];
    if (!cache) { ws.addRow([p, mes, "", "", "", "NO EXTRAÍDO: falta descargarlo de SUNAT", ""]); continue; }
    const ni = cache.noIncluidos?.v === VERSION_NO_INCLUIDOS ? cache.noIncluidos : undefined;
    const bloque = { columnas: cache.columnas, filas: cache.filas, noIncluidos: ni };
    const iTotal = (cache.columnas ?? []).findIndex((c) => /^total cp|importe total/i.test(String(c).trim()));
    const total = iTotal >= 0 ? Math.round((cache.filas ?? []).reduce((a, f) => a + num(f[iTotal]), 0) * 100) / 100 : "";
    const row = ws.addRow([p, mes, cache.filas?.length ?? 0, total, ni ? ni.filas?.length ?? 0 : "no consultado", cache.filas?.length ? "Con comprobantes" : "Sin movimiento en SUNAT", cache.at ? cache.at.slice(0, 16).replace("T", " ") : ""]);
    row.getCell(4).numFmt = "#,##0.00";
    archivos[`detalle-sire-${tipo}-${p}.xlsx`] = new Uint8Array(await excelDetalleSire({ [tipo]: bloque }));
    incluidos++;
  }
  if (!incluidos) return NextResponse.json({ error: "Ninguno de esos periodos está extraído todavía." }, { status: 400 });
  ws.addRow([]);
  ws.addRow([`${cliente.razonSocial} · RUC ${cliente.ruc} · Detalle SIRE ${libro} (${tipo})`]).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  archivos["00-RESUMEN.xlsx"] = new Uint8Array(await wb.xlsx.writeBuffer());

  const zip = zipSync(archivos, { level: 6 });
  return new NextResponse(Buffer.from(zip) as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="detalle-sire-${tipo}-${slug(cliente.razonSocial)}-${periodos[0]}-${periodos[periodos.length - 1]}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}
