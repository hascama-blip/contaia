import { NextRequest, NextResponse } from "next/server";
import { getCliente } from "@/lib/db";
import { leerFilas } from "@/lib/xlsxIO";
import {
  parseSireCompras,
  parseSireVentas,
  parseContasisCompras,
  parseContasisVentas,
  cruzarLibro,
  type ParseSalida,
  type ResultadoCruce,
} from "@/lib/cruceSire";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_SIZE = 15 * 1024 * 1024; // 15 MB

// POST multipart/form-data con hasta 4 Excel:
//   sireCompras, sireVentas (RCE/RVIE de SUNAT) · contableCompras, contableVentas (Contasis)
// Cruza comprobante por comprobante y devuelve el resultado (JSON). No persiste.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const cliente = await getCliente(params.id);
  if (!cliente) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Formulario inválido" }, { status: 400 });

  const getFile = (k: string): File | null => {
    const v = form.get(k);
    return v instanceof File && v.size > 0 ? v : null;
  };
  const fSC = getFile("sireCompras");
  const fSV = getFile("sireVentas");
  const fCC = getFile("contableCompras");
  const fCV = getFile("contableVentas");

  if (!fSC && !fSV && !fCC && !fCV) {
    return NextResponse.json(
      { error: "Adjunta al menos un archivo (SIRE o contable, compras o ventas)." },
      { status: 400 }
    );
  }

  async function filasDe(f: File | null): Promise<unknown[][] | null> {
    if (!f) return null;
    if (f.size > MAX_SIZE) throw new Error(`"${f.name}" supera 15 MB.`);
    return leerFilas(Buffer.from(await f.arrayBuffer()));
  }

  try {
    const [rSC, rSV, rCC, rCV] = await Promise.all([
      filasDe(fSC),
      filasDe(fSV),
      filasDe(fCC),
      filasDe(fCV),
    ]);

    const resultado: ResultadoCruce = { generadoAt: new Date().toISOString() };
    const capturar = (p: { periodo?: string; ruc?: string; razonSocial?: string }) => {
      if (!resultado.periodo && p.periodo) resultado.periodo = p.periodo;
      if (!resultado.ruc && p.ruc) resultado.ruc = p.ruc;
      if (!resultado.razonSocial && p.razonSocial) resultado.razonSocial = p.razonSocial;
    };
    const vacio: ParseSalida = { comprobantes: [] };

    if (rSC || rCC) {
      const sc = rSC ? parseSireCompras(rSC) : vacio;
      const cc = rCC ? parseContasisCompras(rCC) : vacio;
      capturar(sc);
      resultado.compras = cruzarLibro("compras", sc.comprobantes, cc.comprobantes);
    }
    if (rSV || rCV) {
      const sv = rSV ? parseSireVentas(rSV) : vacio;
      const cv = rCV ? parseContasisVentas(rCV) : vacio;
      capturar(sv);
      resultado.ventas = cruzarLibro("ventas", sv.comprobantes, cv.comprobantes);
    }

    // Si el SIRE no informó RUC/razón social, usar los del cliente.
    if (!resultado.ruc) resultado.ruc = cliente.ruc;
    if (!resultado.razonSocial) resultado.razonSocial = cliente.razonSocial;

    return NextResponse.json({ resultado });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "No se pudieron leer los Excel." },
      { status: 400 }
    );
  }
}
