import { NextRequest, NextResponse } from "next/server";
import { getClienteAutorizado } from "@/lib/auth";
import { getSolicitudRentas, leerPdfRentas } from "@/lib/db";

export const runtime = "nodejs";

// Descarga el PDF del reporte de rentas de este cliente (el que envió SUNAT).
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const cliente = await getClienteAutorizado(params.id);
  if (!cliente) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  const sol = await getSolicitudRentas(params.id);
  if (!sol?.rutaPdf) return NextResponse.json({ error: "No hay PDF disponible." }, { status: 404 });
  const buf = await leerPdfRentas(sol.rutaPdf);
  if (!buf) return NextResponse.json({ error: "No se encontró el archivo." }, { status: 404 });
  return new NextResponse(buf as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="reporte-rentas-${cliente.ruc}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
