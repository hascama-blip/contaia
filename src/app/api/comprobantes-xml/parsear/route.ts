import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { parseRelacionXlsx } from "@/lib/relacionComprobantes";

export const runtime = "nodejs";
export const maxDuration = 30;

// Lee el Excel de la relación subida y devuelve la lista de comprobantes.
export async function POST(req: NextRequest) {
  if (!(await getCurrentUser())) {
    return NextResponse.json({ error: "Sesión no válida." }, { status: 401 });
  }
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "Adjunta la plantilla llena (.xlsx)." }, { status: 400 });
  }
  try {
    const items = await parseRelacionXlsx(Buffer.from(await file.arrayBuffer()));
    if (!items.length) {
      return NextResponse.json({ error: "La relación está vacía o no tiene el formato de la plantilla." }, { status: 400 });
    }
    return NextResponse.json({ ok: true, items, total: items.length });
  } catch {
    return NextResponse.json({ error: "No se pudo leer el Excel. Usa la plantilla descargada." }, { status: 400 });
  }
}
