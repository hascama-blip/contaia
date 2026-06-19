import { NextRequest, NextResponse } from "next/server";
import { leerFilas } from "@/lib/xlsxIO";
import { esZipContenedor, extraerDeZip } from "@/lib/zip";
import { analizarSireExcel } from "@/lib/sireExcel";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_SIZE = 15 * 1024 * 1024;
// Cuenta de ventas por defecto (reclasificable en pantalla).
const CUENTA_VENTAS_DEFECTO = "70121";

// POST multipart (sireVentas = Excel/ZIP del SIRE RVIE) -> comprobantes de venta
// con su cuenta por defecto (reclasificable).
export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Formulario inválido" }, { status: 400 });
  const file = form.get("sireVentas");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "Adjunta el Excel del SIRE de ventas (RVIE)." }, { status: 400 });
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "El archivo supera 15 MB." }, { status: 400 });
  }

  let comps: any[] = [];
  let motivo: string | undefined;
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    if (esZipContenedor(buf, file.name)) {
      for (const it of extraerDeZip(buf, [".xlsx", ".xls"])) {
        try {
          const r = analizarSireExcel(await leerFilas(it.data));
          comps.push(...r.comps);
          if (r.motivo) motivo = r.motivo;
        } catch {
          /* archivo del zip que no es el detalle */
        }
      }
    } else {
      const r = analizarSireExcel(await leerFilas(buf));
      comps = r.comps;
      motivo = r.motivo;
    }
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "No se pudo leer el archivo." },
      { status: 400 }
    );
  }
  if (comps.length === 0) {
    return NextResponse.json(
      { error: motivo ?? "No se encontraron comprobantes de venta." },
      { status: 400 }
    );
  }

  const comprobantes = comps.map((c) => ({
    serie: c.serie,
    numero: c.numero,
    fecha: c.fecha,
    ruc: c.rucContraparte,
    razonSocial: c.razonSocial,
    base: c.baseGravada,
    igv: c.igv,
    total: c.total,
    cuenta: CUENTA_VENTAS_DEFECTO,
    glosa: "",
  }));

  return NextResponse.json({ comprobantes, cuentaDefecto: CUENTA_VENTAS_DEFECTO, total: comprobantes.length });
}
