import { bloqueoModulo } from "@/lib/acceso";
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { conciliarArchivos, excelConciliacionTresVias, type EntradasExtra } from "@/lib/conciliacionCaja";
import { cobrosDeCajaZip, movsDePdf, movsDeWord, sanearSedes } from "@/lib/conciliacionEntradas";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_SIZE = 20 * 1024 * 1024;
const MAX_ARCHIVOS = 30;

// Conciliación bancaria de 3 vías. multipart/form-data:
//   - contabilidad : Registro de Ventas y/o Libro Diario de ventas (Excel; uno o los dos)
//   - caja         : caja virtual / tramas de cobranza (Excel)
//   - cajaZip      : JSON con las sedes de la caja virtual YA analizadas (los ZIP por sede pasan antes
//                    por /api/conciliacion/operaciones, que lee el reporte de cada día y los vouchers)
//   - bancos       : uno o varios extractos en Excel (.xlsx), PDF (con texto) o Word (.docx)
// Cada hoja de Excel se reconoce por su contenido, así que un solo Excel con todas las pestañas también
// sirve (en cualquier casilla). Devuelve el resumen, las filas y el Excel en base64. No persiste.
export async function POST(req: NextRequest) {
  const _bloqueo = await bloqueoModulo("conciliacion"); if (_bloqueo) return _bloqueo;
  await requireUser();
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Formulario inválido." }, { status: 400 });

  const files: File[] = [];
  for (const k of ["contabilidad", "caja", "bancos"]) for (const v of form.getAll(k)) if (v instanceof File && v.size > 0) files.push(v);
  const cajaZip = form.get("cajaZip");
  let sedes: ReturnType<typeof sanearSedes> = [];
  if (typeof cajaZip === "string" && cajaZip.length) {
    if (cajaZip.length > 8 * 1024 * 1024) return NextResponse.json({ error: "La caja virtual analizada es demasiado grande." }, { status: 400 });
    try { sedes = sanearSedes(JSON.parse(cajaZip)); } catch { return NextResponse.json({ error: "No se pudo leer la caja virtual analizada." }, { status: 400 }); }
  }
  if (!files.length && !sedes.length) return NextResponse.json({ error: "Adjunta la contabilidad, la caja virtual y los bancos." }, { status: 400 });
  if (files.length > MAX_ARCHIVOS) return NextResponse.json({ error: `Máximo ${MAX_ARCHIVOS} archivos por conciliación.` }, { status: 400 });
  for (const f of files) {
    if (f.size > MAX_SIZE) return NextResponse.json({ error: `"${f.name}" supera 20 MB.` }, { status: 400 });
    if (/\.doc$/i.test(f.name)) return NextResponse.json({ error: `"${f.name}" es un Word antiguo (.doc): ábrelo y guárdalo como .docx.` }, { status: 400 });
    if (/\.xls$/i.test(f.name)) return NextResponse.json({ error: `"${f.name}" es un Excel antiguo (.xls): ábrelo y guárdalo como .xlsx.` }, { status: 400 });
    if (!/\.(xlsx|pdf|docx)$/i.test(f.name)) return NextResponse.json({ error: `"${f.name}": se aceptan Excel (.xlsx) y, para los bancos, también PDF y Word (.docx).` }, { status: 400 });
  }
  try {
    // Un mismo archivo subido en dos casillas se lee una sola vez.
    const vistos = new Set<string>();
    const archivos: { nombre: string; buf: Buffer }[] = [];
    const extra: EntradasExtra = { movs: [], avisos: [] };
    for (const f of files) {
      const k = `${f.name}|${f.size}`;
      if (vistos.has(k)) continue;
      vistos.add(k);
      const buf = Buffer.from(await f.arrayBuffer());
      if (/\.pdf$/i.test(f.name)) {
        const r = await movsDePdf(buf, f.name);
        extra.movs!.push(...r.movs); if (r.aviso) extra.avisos!.push(r.aviso);
      } else if (/\.docx$/i.test(f.name)) {
        const r = movsDeWord(buf, f.name);
        extra.movs!.push(...r.movs); if (r.aviso) extra.avisos!.push(r.aviso);
      } else archivos.push({ nombre: f.name, buf });
    }
    if (sedes.length) {
      const c = cobrosDeCajaZip(sedes);
      extra.cobros = c.cobros; extra.notasSinCobro = c.notasSinCobro; extra.avisos!.push(...c.avisos);
    }
    const r = await conciliarArchivos(archivos, extra);
    const excel = await excelConciliacionTresVias(r);
    return NextResponse.json({ resumen: r.resumen, unificada: r.unificada, bancos: r.bancos, porFecha: r.porFecha, avisos: r.avisos, excelBase64: excel.toString("base64") });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "No se pudo conciliar." }, { status: 400 });
  }
}
