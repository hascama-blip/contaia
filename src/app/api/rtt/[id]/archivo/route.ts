import { bloqueoModulo } from "@/lib/acceso";
import { NextRequest, NextResponse } from "next/server";
import { requireUser, studioId, esSupremo } from "@/lib/auth";
import { getSolicitudRTT, leerArchivoRTT, getUserById } from "@/lib/db";

export const runtime = "nodejs";

// GET ?tipo=pdf|xml → descarga el archivo del RTT (cuando está "listo").
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const _bloqueo = await bloqueoModulo("rtt"); if (_bloqueo) return _bloqueo;
  const user = await requireUser();
  const { searchParams } = new URL(req.url);
  const tipo = (searchParams.get("tipo") ?? "pdf") === "xml" ? "xml" : "pdf";
  const sol = await getSolicitudRTT(params.id);
  if (!sol) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  // Solo el estudio que lo solicitó (o el supremo) puede descargarlo.
  if (!esSupremo(user)) {
    const solicitante = sol.solicitadoPor ? await getUserById(sol.solicitadoPor) : null;
    if (!solicitante || studioId(solicitante) !== studioId(user)) {
      return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    }
  }
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
