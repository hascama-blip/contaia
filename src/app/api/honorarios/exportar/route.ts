import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { excelDeAsientos, txtDeAsientos, AsientoHonorario } from "@/lib/honorarios";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST → arma el archivo de importación (Excel o TXT StarSoft) a partir de los
// asientos YA EDITADOS por el contador (con las cuentas llenadas en la tabla).
// No vuelve a consultar SUNAT.
export async function POST(req: NextRequest) {
  await requireUser();
  const body = await req.json().catch(() => ({}));
  const asientos = Array.isArray(body.asientos) ? (body.asientos as AsientoHonorario[]) : [];
  const formato = body.formato === "txt" ? "txt" : "xlsx";
  // Nombre base SIN extensión previa (para no arrastrar .xls/.xlsx/.txt).
  const baseNombre = String(body.nombre || "Honorarios").replace(/\.(xlsx|xls|txt)$/i, "").replace(/[^\w.-]+/g, "_") || "Honorarios";
  if (!asientos.length) return NextResponse.json({ error: "No hay asientos para exportar." }, { status: 400 });

  try {
    if (formato === "txt") {
      const txt = txtDeAsientos(asientos);
      // ANSI (Windows-1252 ~ latin1): la mayoría del contenido es ASCII; los
      // acentos se mapean a latin1. StarSoft pide ANSI, sin BOM.
      const buf = Buffer.from(txt, "latin1");
      // El nombre del archivo TXT debe empezar con "H" (requisito StarSoft).
      const nombre = `H_${baseNombre}.txt`.replace(/^H_H_/, "H_");
      return NextResponse.json({ archivo: buf.toString("base64"), nombre, mime: "text/plain" });
    }
    const buf = await excelDeAsientos(asientos);
    return NextResponse.json({
      archivo: buf.toString("base64"),
      nombre: `${baseNombre}.xlsx`,
      mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "No se pudo exportar." }, { status: 500 });
  }
}
