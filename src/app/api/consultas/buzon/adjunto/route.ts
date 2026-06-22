import { NextRequest, NextResponse } from "next/server";
import { getClienteAutorizado } from "@/lib/auth";
import { getBuzonAdjunto, setBuzonAdjunto } from "@/lib/db";
import { descargarAdjuntoBuzon } from "@/lib/buzon";

export const runtime = "nodejs";
export const maxDuration = 120;

function pdfResponse(buf: Buffer, nombre: string, cacheado: boolean) {
  return new NextResponse(buf as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${nombre || "adjunto.pdf"}"`,
      "Cache-Control": "no-store",
      "X-Desde-Cache": cacheado ? "1" : "0",
    },
  });
}

// Descarga el PDF adjunto de UN mensaje del buzón (por codMensaje).
// Cache-first: si ya se descargó antes, se sirve guardado SIN re-loguear en SOL.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const cliente = await getClienteAutorizado(String(body?.clienteId ?? ""));
  if (!cliente) return NextResponse.json({ error: "Empresa no encontrada." }, { status: 404 });

  const codMensaje = String(body?.codMensaje ?? "");
  const forzar = body?.forzar === true;
  const diagnostico = body?.diagnostico === true;

  // 1) Caché: si ya está guardado y no se fuerza, devolver al instante (sin clave).
  if (!forzar && !diagnostico && codMensaje) {
    const cache = await getBuzonAdjunto(cliente.id, codMensaje);
    if (cache) return pdfResponse(cache.pdf, cache.nombre, true);
  }

  // 2) Descarga en vivo (requiere Clave SOL).
  const solUser =
    (typeof body.solUser === "string" && body.solUser) || cliente.credSire?.solUser || "";
  const solPass = typeof body.solPass === "string" ? body.solPass : "";
  if (!solUser || !solPass) {
    return NextResponse.json(
      { error: "Este documento aún no está guardado. Ingresa la Clave SOL para descargarlo la primera vez." },
      { status: 400 }
    );
  }

  const r = await descargarAdjuntoBuzon({
    ruc: cliente.ruc,
    solUser,
    solPass,
    codMensaje,
    asunto: typeof body.asunto === "string" ? body.asunto : "",
    diagnostico,
  });

  if (diagnostico || !r.ok || !r.pdfBase64) {
    return NextResponse.json(
      { error: r.error ?? "No se pudo descargar el adjunto.", diag: r.diag },
      { status: r.ok ? 200 : 400 }
    );
  }

  const buf = Buffer.from(r.pdfBase64, "base64");
  // Guardar en caché para próximas veces (no re-loguear).
  await setBuzonAdjunto(cliente.id, codMensaje, buf, r.filename ?? `mensaje-${codMensaje}.pdf`).catch(() => {});
  return pdfResponse(buf, r.filename ?? "adjunto.pdf", false);
}
