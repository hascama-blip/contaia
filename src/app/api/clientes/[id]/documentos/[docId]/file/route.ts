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
    // Solo PDF e imágenes se muestran en el navegador; cualquier otro tipo se
    // descarga (evita que un archivo HTML subido se ejecute dentro de la web).
    const seguro = /^(application\/pdf|image\/(png|jpeg|webp|gif))$/i.test(doc.mimeType || "");
    return new NextResponse(data, {
      headers: {
        "Content-Type": seguro ? doc.mimeType : "application/octet-stream",
        "Content-Disposition": `${seguro ? "inline" : "attachment"}; filename="${encodeURIComponent(doc.originalName)}"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "Archivo no disponible" }, { status: 404 });
  }
}
