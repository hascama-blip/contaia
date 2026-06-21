import { NextRequest, NextResponse } from "next/server";
import { getClienteAutorizado } from "@/lib/auth";
import { descargarAdjuntoBuzon } from "@/lib/buzon";

export const runtime = "nodejs";
export const maxDuration = 120;

// Descarga el PDF adjunto de UN mensaje del buzón (por codMensaje).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const cliente = await getClienteAutorizado(String(body?.clienteId ?? ""));
  if (!cliente) return NextResponse.json({ error: "Empresa no encontrada." }, { status: 404 });

  const solUser =
    (typeof body.solUser === "string" && body.solUser) || cliente.credSire?.solUser || "";
  const solPass = typeof body.solPass === "string" ? body.solPass : "";
  const codMensaje = String(body?.codMensaje ?? "");
  if (!solUser || !solPass) {
    return NextResponse.json({ error: "Ingresa el Usuario y la Clave SOL." }, { status: 400 });
  }

  const r = await descargarAdjuntoBuzon({
    ruc: cliente.ruc,
    solUser,
    solPass,
    codMensaje,
    diagnostico: body.diagnostico === true,
  });

  if (body.diagnostico === true || !r.ok || !r.pdfBase64) {
    return NextResponse.json(
      { error: r.error ?? "No se pudo descargar el adjunto.", diag: r.diag },
      { status: r.ok ? 200 : 400 }
    );
  }

  const buf = Buffer.from(r.pdfBase64, "base64");
  return new NextResponse(buf as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${r.filename ?? "adjunto.pdf"}"`,
      "Cache-Control": "no-store",
    },
  });
}
