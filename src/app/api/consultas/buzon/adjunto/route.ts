import { NextRequest, NextResponse } from "next/server";
import { getClienteAutorizado, getCurrentUser } from "@/lib/auth";
import { getBuzonAdjunto, setBuzonAdjunto, registrarDescargaBuzon } from "@/lib/db";
import { descargarAdjuntoBuzon } from "@/lib/buzon";
import { logAccion } from "@/lib/auditoria";

export const runtime = "nodejs";
export const maxDuration = 120;

function pdfResponse(
  buf: Buffer,
  nombre: string,
  cacheado: boolean,
  descarga?: { at: string; por?: string } | null
) {
  const headers: Record<string, string> = {
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="${nombre || "adjunto.pdf"}"`,
    "Cache-Control": "no-store",
    "X-Desde-Cache": cacheado ? "1" : "0",
  };
  if (descarga?.at) headers["X-Descarga-At"] = descarga.at;
  if (descarga?.por) headers["X-Descarga-Por"] = encodeURIComponent(descarga.por);
  return new NextResponse(buf as unknown as BodyInit, { headers });
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
  const actual = await getCurrentUser();
  const quien = actual ? { id: actual.id, nombre: actual.nombre } : undefined;

  // 1) Caché: si ya está guardado y no se fuerza, devolver al instante (sin clave).
  if (!forzar && !diagnostico && codMensaje) {
    const cache = await getBuzonAdjunto(cliente.id, codMensaje);
    if (cache) {
      // Aun sirviéndolo desde caché, registramos quién lo abrió y cuándo.
      const reg = await registrarDescargaBuzon(cliente.id, codMensaje, quien).catch(() => null);
      await logAccion({
        area: "Buzón",
        accion: "Abrió un PDF del buzón (guardado)",
        clienteId: cliente.id,
        clienteNombre: cliente.razonSocial,
        detalle: body?.asunto ? String(body.asunto).slice(0, 80) : `Mensaje ${codMensaje}`,
      });
      return pdfResponse(cache.pdf, cache.nombre, true, reg ? { at: reg.descargadaAt, por: reg.descargadoPorNombre } : null);
    }
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
    fecha: typeof body.fecha === "string" ? body.fecha : "",
    origen: body.origen === "mensajes" ? "mensajes" : body.origen === "notificaciones" ? "notificaciones" : undefined,
    adjuntos: typeof body.adjuntos === "number" ? body.adjuntos : undefined,
    diagnostico,
  });

  if (diagnostico || !r.ok || !r.pdfBase64) {
    return NextResponse.json(
      { error: r.error ?? "No se pudo descargar el adjunto.", diag: r.diag },
      { status: r.ok ? 200 : 400 }
    );
  }

  const buf = Buffer.from(r.pdfBase64, "base64");
  // Guardar en caché para próximas veces (no re-loguear) + registrar la descarga.
  await setBuzonAdjunto(cliente.id, codMensaje, buf, r.filename ?? `mensaje-${codMensaje}.pdf`, quien).catch(() => {});
  await logAccion({
    area: "Buzón",
    accion: "Descargó un PDF del buzón (desde SUNAT)",
    clienteId: cliente.id,
    clienteNombre: cliente.razonSocial,
    detalle: body?.asunto ? String(body.asunto).slice(0, 80) : `Mensaje ${codMensaje}`,
  });
  return pdfResponse(buf, r.filename ?? "adjunto.pdf", false, quien ? { at: new Date().toISOString(), por: quien.nombre } : null);
}
