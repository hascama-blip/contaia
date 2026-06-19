import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { UPLOADS_DIR } from "@/lib/db";
import { getClienteAutorizado } from "@/lib/auth";

export const runtime = "nodejs";

// Sirve el archivo original almacenado (para vista previa/descarga).
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string; docId: string } }
) {
  const cliente = await getClienteAutorizado(params.id);
  if (!cliente) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  const doc = cliente.documentos.find((d) => d.id === params.docId);
  if (!doc) return NextResponse.json({ error: "Documento no encontrado" }, { status: 404 });

  try {
    const data = await fs.readFile(path.join(UPLOADS_DIR, doc.storedName));
    return new NextResponse(data, {
      headers: {
        "Content-Type": doc.mimeType,
        "Content-Disposition": `inline; filename="${encodeURIComponent(doc.originalName)}"`,
      },
    });
  } catch {
    return NextResponse.json({ error: "Archivo no disponible" }, { status: 404 });
  }
}
