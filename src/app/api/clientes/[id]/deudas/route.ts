import { NextRequest, NextResponse } from "next/server";
import { addDeuda, getCliente, deleteDeuda, newId } from "@/lib/db";
import { ocrVarias, parseFilasDeudaF36, detectarSeccionF36, extraerDeuda } from "@/lib/ocr";
import type { Deuda } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_SIZE = 15 * 1024 * 1024; // 15 MB

function aDeuda(d: any): Deuda {
  return {
    id: newId(),
    tipo: String(d.tipo ?? "").trim() || "Deuda",
    seccion: typeof d.seccion === "string" && d.seccion.trim() ? d.seccion.trim() : undefined,
    codigoTributo: typeof d.codigoTributo === "string" && d.codigoTributo.trim() ? d.codigoTributo.trim() : undefined,
    numero: typeof d.numero === "string" && d.numero.trim() ? d.numero.trim() : undefined,
    descripcion: typeof d.descripcion === "string" ? d.descripcion.trim() : "",
    monto: Number(d.monto) || 0,
    periodo: typeof d.periodo === "string" && d.periodo.trim() ? d.periodo.trim() : undefined,
    entidad: typeof d.entidad === "string" && d.entidad.trim() ? d.entidad.trim() : undefined,
    fuente: d.fuente === "ocr" ? "ocr" : "manual",
    ocrTexto: typeof d.ocrTexto === "string" ? d.ocrTexto.slice(0, 4000) : undefined,
    creadoAt: new Date().toISOString(),
  };
}

// POST multipart (uno o varios `file`): OCR de cada foto, detecta la sección
//   (pestaña del F36) y extrae las filas (periodo + monto) como borradores.
// POST JSON { deudas:[...] } o { deuda:{...} }: guarda las deudas confirmadas.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const cliente = await getCliente(params.id);
  if (!cliente) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  const contentType = req.headers.get("content-type") ?? "";

  // ---- Guardar (JSON) ----
  if (contentType.includes("application/json")) {
    const body = await req.json().catch(() => null);
    const lista: any[] = Array.isArray(body?.deudas) ? body.deudas : body?.deuda ? [body.deuda] : [];
    const validas = lista.filter((d) => d && (Number(d.monto) > 0 || String(d.tipo ?? "").trim()));
    if (validas.length === 0) {
      return NextResponse.json({ error: "No hay deudas para guardar." }, { status: 400 });
    }
    const guardadas: Deuda[] = [];
    for (const d of validas) {
      const deuda = aDeuda(d);
      await addDeuda(cliente.id, deuda);
      guardadas.push(deuda);
    }
    return NextResponse.json({ guardadas }, { status: 201 });
  }

  // ---- OCR de imágenes (multipart) ----
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Formulario inválido" }, { status: 400 });
  const files = form.getAll("file").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "Adjunta una o varias fotos." }, { status: 400 });
  }
  const validos = files.filter((f) => f.size <= MAX_SIZE && (!f.type || f.type.startsWith("image/")));
  if (validos.length === 0) {
    return NextResponse.json({ error: "Sube imágenes (foto o captura) de hasta 15 MB." }, { status: 400 });
  }

  const buffers = await Promise.all(validos.map(async (f) => Buffer.from(await f.arrayBuffer())));
  const textos = await ocrVarias(buffers);

  const borradores: any[] = [];
  textos.forEach((texto, i) => {
    const filas = parseFilasDeudaF36(texto);
    if (filas.length > 0) {
      for (const fila of filas) {
        borradores.push({
          tipo: fila.tipo,
          seccion: fila.seccion,
          codigoTributo: fila.codigoTributo,
          numero: fila.numero,
          descripcion: "",
          periodo: fila.periodo ?? "",
          monto: fila.monto,
          entidad: "SUNAT",
          fuente: "ocr",
          archivo: validos[i].name,
        });
      }
    } else {
      // No es una tabla F36: deja un borrador genérico de la foto.
      const ex = extraerDeuda(texto);
      borradores.push({
        tipo: ex.tipoSugerido ?? "",
        seccion: detectarSeccionF36(texto) || "",
        descripcion: ex.claves.join(", "),
        periodo: ex.periodos[0] ?? "",
        monto: ex.montos[0] ?? 0,
        entidad: "SUNAT",
        fuente: "ocr",
        archivo: validos[i].name,
        vacio: !texto.trim(),
      });
    }
  });

  return NextResponse.json({
    borradores,
    detectados: borradores.length,
    sinTexto: textos.every((t) => !t.trim()),
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
