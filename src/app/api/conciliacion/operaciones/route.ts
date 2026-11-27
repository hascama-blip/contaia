import { NextRequest, NextResponse } from "next/server";
import { bloqueoModulo } from "@/lib/acceso";
import { requireUser } from "@/lib/auth";
import { descomprimirSeguro } from "@/lib/zip";
import { analizarCarpetaCaja, crearLector, excelOperaciones, type ResultadoOperaciones } from "@/lib/cajaOperaciones";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_ZIP = 80 * 1024 * 1024;

// Relación N° DE OPERACIÓN ↔ COMPROBANTES a partir de los ZIP del utilitario "Caja virtual".
//   POST multipart { zip }            → { sede: ResultadoOperaciones }  (UN ZIP = una sede; lee los vouchers con OCR)
//   POST JSON      { sedes: [...] }   → Excel con la relación de todas las sedes
export async function POST(req: NextRequest) {
  const _b = await bloqueoModulo("conciliacion"); if (_b) return _b;
  await requireUser();
  const tipo = req.headers.get("content-type") ?? "";
  try {
    if (tipo.includes("application/json")) {
      const body = await req.json().catch(() => null);
      const sedes: ResultadoOperaciones[] = (Array.isArray(body?.sedes) ? body.sedes : []).filter((s: any) => s && Array.isArray(s.operaciones)).slice(0, 40)
        .map((s: any) => ({ ...s, sinOperacion: Array.isArray(s.sinOperacion) ? s.sinOperacion : [], otros: Array.isArray(s.otros) ? s.otros : [], avisos: Array.isArray(s.avisos) ? s.avisos : [] }));
      if (!sedes.length) return NextResponse.json({ error: "No hay operaciones que exportar." }, { status: 400 });
      const buf = await excelOperaciones(sedes);
      return new NextResponse(buf as unknown as BodyInit, {
        headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": 'attachment; filename="relacion-operaciones-comprobantes.xlsx"', "Cache-Control": "no-store" },
      });
    }
    const form = await req.formData().catch(() => null);
    const zip = form?.get("zip");
    if (!(zip instanceof File) || !zip.size) return NextResponse.json({ error: "Sube el ZIP de la sede (el que descarga el utilitario Caja virtual)." }, { status: 400 });
    if (zip.size > MAX_ZIP) return NextResponse.json({ error: "El ZIP supera 80 MB." }, { status: 400 });
    let archivos: Record<string, Uint8Array>;
    try { archivos = descomprimirSeguro(Buffer.from(await zip.arrayBuffer())); } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "No se pudo abrir el ZIP." }, { status: 400 }); }
    const lector = await crearLector();
    try {
      return NextResponse.json({ sede: await analizarCarpetaCaja(archivos, lector) });
    } finally {
      await lector.cerrar();
    }
  } catch (e) {
    console.error("[conciliacion/operaciones]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "No se pudo analizar." }, { status: 500 });
  }
}
