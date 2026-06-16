import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { addDocumento, getCliente, newId, UPLOADS_DIR } from "@/lib/db";
import { ejecutarOcr, extraerDatos } from "@/lib/ocr";
import type { Documento } from "@/lib/types";

export const runtime = "nodejs";
// El OCR de imágenes grandes puede tardar; ampliamos el límite.
export const maxDuration = 60;

const MAX_SIZE = 15 * 1024 * 1024; // 15 MB
const ALLOWED = ["image/png", "image/jpeg", "image/jpg", "image/webp", "application/pdf"];

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const cliente = await getCliente(params.id);
  if (!cliente) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Formulario inválido" }, { status: 400 });

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Archivo requerido" }, { status: 400 });
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "El archivo supera 15 MB" }, { status: 400 });
  }
  if (file.type && !ALLOWED.includes(file.type)) {
    return NextResponse.json(
      { error: "Formato no soportado (use PNG, JPG, WEBP o PDF)" },
      { status: 400 }
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const docId = newId();
  const ext = path.extname(file.name) || guessExt(file.type);
  const storedName = `${docId}${ext}`;
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
  await fs.writeFile(path.join(UPLOADS_DIR, storedName), buffer);

  // OCR + extracción (las imágenes se procesan; los PDF se guardan sin OCR en este MVP).
  const ocrText = await ejecutarOcr(buffer, file.type);
  const extraccion = extraerDatos(ocrText);

  const doc: Documento = {
    id: docId,
    clienteId: cliente.id,
    originalName: file.name,
    storedName,
    mimeType: file.type || "application/octet-stream",
    size: file.size,
    uploadedAt: new Date().toISOString(),
    ocrText,
    ocrStatus: file.type.startsWith("image/")
      ? ocrText
        ? "procesado"
        : "error"
      : "pendiente",
    extraccion,
  };

  await addDocumento(cliente.id, doc);
  return NextResponse.json({ documento: doc }, { status: 201 });
}

function guessExt(mime: string): string {
  switch (mime) {
    case "image/png":
      return ".png";
    case "image/jpeg":
    case "image/jpg":
      return ".jpg";
    case "image/webp":
      return ".webp";
    case "application/pdf":
      return ".pdf";
    default:
      return "";
  }
}
