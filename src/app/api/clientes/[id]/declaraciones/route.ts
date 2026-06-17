import { NextRequest, NextResponse } from "next/server";
import { addDeclaracion, deleteDeclaracion, getCliente, newId } from "@/lib/db";
import { extraerTextoPdf, parseDeclaracion } from "@/lib/declaracion";
import type { DeclaracionMensual } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_SIZE = 15 * 1024 * 1024; // 15 MB

// POST con multipart/form-data (campo `file` = PDF):
//   -> lee el PDF y devuelve un BORRADOR parseado (NO lo guarda todavía).
//      Con `diagnostico=true` incluye el texto crudo y las casillas detectadas.
// POST con JSON { declaracion }:
//   -> guarda/actualiza la declaración del periodo.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const cliente = await getCliente(params.id);
  if (!cliente) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  const contentType = req.headers.get("content-type") ?? "";

  // ---- Guardar (JSON) ------------------------------------------------------
  if (contentType.includes("application/json")) {
    const body = await req.json().catch(() => null);
    const d = body?.declaracion;
    if (!d || typeof d.periodo !== "string" || !/^\d{6}$/.test(d.periodo)) {
      return NextResponse.json(
        { error: "Indica un periodo válido (YYYYMM)." },
        { status: 400 }
      );
    }
    const decl: DeclaracionMensual = {
      id: newId(),
      periodo: d.periodo,
      ruc: typeof d.ruc === "string" ? d.ruc : undefined,
      formulario: typeof d.formulario === "string" ? d.formulario : undefined,
      ventasBase: Number(d.ventasBase) || 0,
      ventasIgv: Number(d.ventasIgv) || 0,
      comprasBase: Number(d.comprasBase) || 0,
      comprasIgv: Number(d.comprasIgv) || 0,
      casillas: Array.isArray(d.casillas) ? d.casillas : [],
      fuente: d.fuente === "manual" ? "manual" : "pdf",
      archivoNombre: typeof d.archivoNombre === "string" ? d.archivoNombre : undefined,
      cargadoAt: new Date().toISOString(),
    };
    const actualizado = await addDeclaracion(cliente.id, decl);
    return NextResponse.json({ cliente: actualizado, declaracion: decl }, { status: 201 });
  }

  // ---- Leer PDF (multipart) -> borrador ------------------------------------
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Formulario inválido" }, { status: 400 });
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Adjunta el PDF de la declaración." }, { status: 400 });
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "El archivo supera 15 MB" }, { status: 400 });
  }
  const diagnostico = form.get("diagnostico") === "true";

  const buffer = Buffer.from(await file.arrayBuffer());
  const texto = await extraerTextoPdf(buffer);
  if (!texto.trim()) {
    return NextResponse.json({
      borrador: vacio(file.name),
      sinTexto: true,
      mensaje:
        "El PDF no tiene capa de texto (parece un escaneo/imagen). Ingresa los montos a mano.",
    });
  }

  const parsed = parseDeclaracion(texto);
  const borrador = { ...parsed, fuente: "pdf" as const, archivoNombre: file.name };

  return NextResponse.json({
    borrador,
    ...(diagnostico
      ? { diag: { texto: texto.slice(0, 8000), casillas: parsed.casillas } }
      : {}),
  });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const cliente = await getCliente(params.id);
  if (!cliente) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  const declId = new URL(req.url).searchParams.get("declId");
  if (!declId) return NextResponse.json({ error: "Falta declId" }, { status: 400 });
  const actualizado = await deleteDeclaracion(cliente.id, declId);
  return NextResponse.json({ cliente: actualizado });
}

function vacio(nombre: string) {
  return {
    periodo: "",
    ruc: undefined,
    formulario: undefined,
    ventasBase: 0,
    ventasIgv: 0,
    comprasBase: 0,
    comprasIgv: 0,
    casillas: [],
    fuente: "manual" as const,
    archivoNombre: nombre,
  };
}
