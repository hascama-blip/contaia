import { bloqueoModulo } from "@/lib/acceso";
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { conciliarArchivos, excelConciliacionTresVias } from "@/lib/conciliacionCaja";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_SIZE = 20 * 1024 * 1024;
const MAX_ARCHIVOS = 12;

// Conciliación bancaria de 3 vías. multipart/form-data:
//   - contabilidad : Registro de Ventas y/o Libro Diario de ventas (Excel; uno o los dos)
//   - caja         : caja virtual / tramas de cobranza (Excel)
//   - bancos       : uno o varios extractos (Excel; una cuenta por hoja o por archivo)
// Cada hoja se reconoce por su contenido, así que un solo Excel con todas las pestañas también
// sirve (en cualquier casilla). Devuelve el resumen, las filas y el Excel en base64. No persiste.
export async function POST(req: NextRequest) {
  const _bloqueo = await bloqueoModulo("conciliacion"); if (_bloqueo) return _bloqueo;
  await requireUser();
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Formulario inválido." }, { status: 400 });

  const files: File[] = [];
  for (const k of ["contabilidad", "caja", "bancos"]) for (const v of form.getAll(k)) if (v instanceof File && v.size > 0) files.push(v);
  if (!files.length) return NextResponse.json({ error: "Adjunta los Excel de contabilidad, caja virtual y bancos." }, { status: 400 });
  if (files.length > MAX_ARCHIVOS) return NextResponse.json({ error: `Máximo ${MAX_ARCHIVOS} archivos por conciliación.` }, { status: 400 });
  for (const f of files) {
    if (f.size > MAX_SIZE) return NextResponse.json({ error: `"${f.name}" supera 20 MB.` }, { status: 400 });
    if (!/\.xlsx$/i.test(f.name)) return NextResponse.json({ error: `"${f.name}" no es un Excel .xlsx. Si es .xls, ábrelo y guárdalo como .xlsx.` }, { status: 400 });
  }
  try {
    // Un mismo archivo subido en dos casillas se lee una sola vez.
    const vistos = new Set<string>();
    const archivos: { nombre: string; buf: Buffer }[] = [];
    for (const f of files) {
      const k = `${f.name}|${f.size}`;
      if (vistos.has(k)) continue;
      vistos.add(k);
      archivos.push({ nombre: f.name, buf: Buffer.from(await f.arrayBuffer()) });
    }
    const r = await conciliarArchivos(archivos);
    const excel = await excelConciliacionTresVias(r);
    return NextResponse.json({ resumen: r.resumen, unificada: r.unificada, bancos: r.bancos, porFecha: r.porFecha, avisos: r.avisos, excelBase64: excel.toString("base64") });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "No se pudo conciliar." }, { status: 400 });
  }
}
