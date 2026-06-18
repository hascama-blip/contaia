import { NextRequest, NextResponse } from "next/server";
import { addDeuda, deleteDeuda, getCliente, newId } from "@/lib/db";
import { ocrImagen, extraerDeuda } from "@/lib/ocr";
import type { Deuda } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_SIZE = 15 * 1024 * 1024; // 15 MB

// POST multipart (file = imagen): OCR de la foto de la deuda → devuelve un
//   BORRADOR con montos/tipo sugeridos (NO lo guarda; el usuario lo confirma).
// POST JSON { deuda }: guarda la deuda indicada.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const cliente = await getCliente(params.id);
  if (!cliente) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  const contentType = req.headers.get("content-type") ?? "";

  // ---- Guardar (JSON) ----
  if (contentType.includes("application/json")) {
    const body = await req.json().catch(() => null);
    const d = body?.deuda;
    if (!d || typeof d.tipo !== "string" || !d.tipo.trim()) {
      return NextResponse.json({ error: "Indica el tipo de deuda." }, { status: 400 });
    }
    const deuda: Deuda = {
      id: newId(),
      tipo: String(d.tipo).trim(),
      descripcion: typeof d.descripcion === "string" ? d.descripcion.trim() : "",
      monto: Number(d.monto) || 0,
      periodo: typeof d.periodo === "string" && d.periodo.trim() ? d.periodo.trim() : undefined,
      entidad: typeof d.entidad === "string" && d.entidad.trim() ? d.entidad.trim() : undefined,
      fuente: d.fuente === "ocr" ? "ocr" : "manual",
      ocrTexto: typeof d.ocrTexto === "string" ? d.ocrTexto.slice(0, 4000) : undefined,
      creadoAt: new Date().toISOString(),
    };
    const actualizado = await addDeuda(cliente.id, deuda);
    return NextResponse.json({ cliente: actualizado, deuda }, { status: 201 });
  }

  // ---- OCR de imagen (multipart) ----
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Formulario inválido" }, { status: 400 });
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Adjunta una foto de la deuda." }, { status: 400 });
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "El archivo supera 15 MB" }, { status: 400 });
  }
  if (file.type && !file.type.startsWith("image/")) {
    return NextResponse.json({ error: "Sube una imagen (foto o captura)." }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const texto = await ocrImagen(buffer, file.type || "image/jpeg");
  const ex = extraerDeuda(texto);

  return NextResponse.json({
    borrador: {
      tipo: ex.tipoSugerido ?? "",
      descripcion: ex.claves.join(", "),
      monto: ex.montos[0] ?? 0,
      periodo: ex.periodos[0] ?? "",
      entidad: "SUNAT",
      fuente: "ocr" as const,
      ocrTexto: texto,
    },
    montosDetectados: ex.montos,
    sinTexto: !texto.trim(),
  });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const cliente = await getCliente(params.id);
  if (!cliente) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  const deudaId = new URL(req.url).searchParams.get("deudaId");
  if (!deudaId) return NextResponse.json({ error: "Falta deudaId" }, { status: 400 });
  const actualizado = await deleteDeuda(cliente.id, deudaId);
  return NextResponse.json({ cliente: actualizado });
}
