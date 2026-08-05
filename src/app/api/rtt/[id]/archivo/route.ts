import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getSolicitudRTT, leerArchivoRTT } from "@/lib/db";

export const runtime = "nodejs";

// GET ?tipo=pdf|xml → descarga el archivo del RTT (cuando está "listo").
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  await requireUser();
  const { searchParams } = new URL(req.url);
  const tipo = (searchParams.get("tipo") ?? "pdf") === "xml" ? "xml" : "pdf";
  const sol = await getSolicitudRTT(params.id);
  if (!sol) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  const nombre = tipo === "xml" ? sol.rutaXml : sol.rutaPdf;
  if (!nombre) return NextResponse.json({ error: `El RTT no tiene ${tipo.toUpperCase()} disponible aún.` }, { status: 404 });
  const buf = await leerArchivoRTT(nombre);
  if (!buf) return NextResponse.json({ error: "Archivo no disponible." }, { status: 404 });
  return new NextResponse(buf, {
    headers: {
      "Content-Type": tipo === "xml" ? "application/xml" : "application/pdf",
      "Content-Disposition": `attachment; filename="RTT-${sol.ruc}.${tipo}"`,
      "Cache-Control": "no-store",
    },
  });
}
