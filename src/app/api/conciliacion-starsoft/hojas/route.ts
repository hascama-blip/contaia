import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { listarHojasBanco } from "@/lib/conciliacionStarsoft";

export const runtime = "nodejs";

// Devuelve los nombres de las hojas (cuentas) del FORMATO BANCO STARSOFT subido,
// para que el usuario elija con cuál conciliar.
export async function POST(req: NextRequest) {
  await requireUser();
  const form = await req.formData().catch(() => null);
  const files = (form?.getAll("banco") ?? []).filter((v): v is File => v instanceof File && v.size > 0);
  if (!files.length) {
    return NextResponse.json({ error: "Adjunta el/los Excel del banco." }, { status: 400 });
  }
  try {
    // Unión de las hojas (cuentas) de todos los archivos, preservando el orden.
    const vistas = new Set<string>();
    const hojas: string[] = [];
    for (const f of files) {
      for (const h of listarHojasBanco(Buffer.from(await f.arrayBuffer()))) {
        if (!vistas.has(h)) { vistas.add(h); hojas.push(h); }
      }
    }
    return NextResponse.json({ hojas });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "No se pudo leer el Excel." }, { status: 500 });
  }
}
