import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { parseExtractoBcp, parseLibroBanco, parseCajaVirtual, conciliar, excelConciliacion } from "@/lib/conciliacion";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_SIZE = 20 * 1024 * 1024; // 20 MB

// Conciliación bancaria: POST multipart con
//   - extracto (PDF del banco, obligatorio)
//   - libro (Excel del libro banco contable, obligatorio)
//   - caja (Excel de la caja virtual, opcional — enriquece con el comprobante)
// Devuelve el resumen + el Excel conciliado en base64 (no persiste nada).
export async function POST(req: NextRequest) {
  await requireUser();
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Formulario inválido." }, { status: 400 });

  const getFile = (k: string): File | null => {
    const v = form.get(k);
    return v instanceof File && v.size > 0 ? v : null;
  };
  const fExtracto = getFile("extracto");
  const fLibro = getFile("libro");
  const fCaja = getFile("caja");

  if (!fExtracto) return NextResponse.json({ error: "Adjunta el extracto bancario (PDF)." }, { status: 400 });
  if (!fLibro) return NextResponse.json({ error: "Adjunta el libro banco (Excel)." }, { status: 400 });
  for (const f of [fExtracto, fLibro, fCaja]) {
    if (f && f.size > MAX_SIZE) return NextResponse.json({ error: `"${f.name}" supera 20 MB.` }, { status: 400 });
  }

  try {
    const bufExtracto = Buffer.from(await fExtracto.arrayBuffer());
    const { desde, hasta, movs } = await parseExtractoBcp(bufExtracto);
    if (!movs.length) {
      return NextResponse.json(
        { error: "No se pudieron leer movimientos del PDF. Debe ser un extracto con capa de texto (no escaneado). Por ahora está calibrado para el formato BCP." },
        { status: 422 }
      );
    }
    const libro = await parseLibroBanco(Buffer.from(await fLibro.arrayBuffer()));
    if (!libro.length) {
      return NextResponse.json(
        { error: "No se pudieron leer registros del libro banco. Debe tener columnas Fecha / Nro. Doc. / Glosa / Ingreso / Egreso." },
        { status: 422 }
      );
    }
    const caja = fCaja ? await parseCajaVirtual(Buffer.from(await fCaja.arrayBuffer())) : [];

    const r = conciliar({ desde, hasta }, movs, libro, caja);
    const excel = await excelConciliacion(r);

    return NextResponse.json({
      ok: true,
      resumen: r.resumen,
      periodo: r.periodo,
      // Muestras para la vista previa (el detalle completo va en el Excel).
      muestraBancoSinLibro: r.bancoSinLibro.slice(0, 15),
      muestraLibroSinBanco: r.libroSinBanco.slice(0, 15),
      excelBase64: excel.toString("base64"),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "No se pudo conciliar." }, { status: 500 });
  }
}
