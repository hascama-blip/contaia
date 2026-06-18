import { NextRequest, NextResponse } from "next/server";
import {
  addDeclaracionAnual,
  deleteDeclaracionAnual,
  getCliente,
  newId,
} from "@/lib/db";
import { extraerFilasPdf, parseAnual } from "@/lib/declaracionAnual";
import type { DeclaracionAnual } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_SIZE = 15 * 1024 * 1024; // 15 MB

// POST multipart: lee uno o varios PDF de DJ anual (Formulario 710), detecta el
// ejercicio y guarda cada uno (reemplaza el mismo año). Devuelve resultados +
// diagnóstico opcional.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const cliente = await getCliente(params.id);
  if (!cliente) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Formulario inválido" }, { status: 400 });
  const files = form.getAll("file").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "Adjunta el PDF de la DJ anual (710)." }, { status: 400 });
  }
  const diagnostico = form.get("diagnostico") === "true";

  const resultados: any[] = [];
  let primerDiag: any = null;

  for (const file of files) {
    if (file.size > MAX_SIZE) {
      resultados.push({ archivo: file.name, ok: false, motivo: "Supera 15 MB" });
      continue;
    }
    const filas = await extraerFilasPdf(Buffer.from(await file.arrayBuffer()));
    if (filas.length === 0) {
      resultados.push({
        archivo: file.name,
        ok: false,
        motivo: "PDF sin texto (escaneo).",
      });
      continue;
    }
    const parsed = parseAnual(filas);
    if (diagnostico && !primerDiag) {
      primerDiag = {
        archivo: file.name,
        ejercicio: parsed.ejercicio,
        ruc: parsed.ruc,
        valores: parsed.valores,
      };
    }
    if (!/^\d{4}$/.test(parsed.ejercicio)) {
      resultados.push({
        archivo: file.name,
        ok: false,
        motivo: "No se detectó el ejercicio (año) en el PDF.",
      });
      continue;
    }
    const decl: DeclaracionAnual = {
      id: newId(),
      ejercicio: parsed.ejercicio,
      ruc: parsed.ruc,
      razonSocial: parsed.razonSocial,
      formulario: parsed.formulario,
      valores: parsed.valores,
      fuente: "pdf",
      archivoNombre: file.name,
      cargadoAt: new Date().toISOString(),
    };
    const actualizado = await addDeclaracionAnual(cliente.id, decl);
    resultados.push({
      archivo: file.name,
      ok: true,
      declaracion: decl,
      // Aviso de posible cruce: RUC del PDF distinto al del cliente.
      rucCliente: cliente.ruc,
      cruce: Boolean(parsed.ruc) && parsed.ruc !== cliente.ruc,
    });
    void actualizado;
  }

  return NextResponse.json({
    resultados,
    guardadas: resultados.filter((r) => r.ok).length,
    ...(primerDiag ? { diag: primerDiag } : {}),
  });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const cliente = await getCliente(params.id);
  if (!cliente) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  const declId = new URL(req.url).searchParams.get("declId");
  if (!declId) return NextResponse.json({ error: "Falta declId" }, { status: 400 });
  const actualizado = await deleteDeclaracionAnual(cliente.id, declId);
  return NextResponse.json({ cliente: actualizado });
}
