import { bloqueoModulo, limpiarDiagnostico, ocultarDiag } from "@/lib/acceso";
import { esClienteDemo, demoNoDisponible, demoSunat, demoSire, demoSireEstado, demoSireDetalle, demoBuzon, demoItf } from "@/lib/demoRutas";
import { NextRequest, NextResponse } from "next/server";
import { getClienteAutorizado } from "@/lib/auth";
import { extraerComprobantesPdf } from "@/lib/comprobantesXml";
import { comprobantesDisponibles, sumarComprobantes, mensajeTopeComprobantes } from "@/lib/cupos";

export const runtime = "nodejs";
export const maxDuration = 240;

// MÓDULO PDF MASIVO: baja el PDF OFICIAL de SUNAT de los comprobantes RECIBIDOS.
// Híbrido: API-first (endpoint interno /01, en paralelo) + scraping de respaldo
// (ícono PDF del modal, el método de la versión anterior). En Modo diagnóstico
// devuelve las llamadas de red internas (apiCalls) para calibrar el endpoint.
// La Clave SOL viaja en el body y NO se persiste. Consume 1 uso solo si el login
// fue correcto (primera parte).
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const _bloqueo = await bloqueoModulo("comprobantes-xml");if (_bloqueo) return _bloqueo;
  const cliente = await getClienteAutorizado(params.id);
  if (!cliente) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  { const d = demoNoDisponible(cliente); if (d) return d; }

  const body = await req.json().catch(() => ({}));

  await limpiarDiagnostico(body);
  const solUser =
    (typeof body.solUser === "string" && body.solUser) || cliente.credSire?.solUser || "";
  const solPass = typeof body.solPass === "string" ? body.solPass : "";
  const periodo = String(body.periodo ?? "");
  const relacion = Array.isArray(body.relacion) ? body.relacion : [];
  if (!solUser || !solPass) {
    return NextResponse.json({ error: "Ingresa el Usuario SOL y la Clave SOL." }, { status: 400 });
  }
  if (!relacion.length) {
    return NextResponse.json({ error: "Sube una relación de comprobantes o cárgala del SIRE." }, { status: 400 });
  }

  // Tope del plan: comprobantes de la Descarga masiva por MES (solo cuentan los
  // descargados con éxito). Si la relación pasa lo disponible, se recorta.
  const esDiag = body.diagnostico === true;
  const tope = esDiag ? null : await comprobantesDisponibles();
  let relacionTope = relacion;
  let recortados = 0;
  if (tope && tope.disponibles !== null) {
    if (tope.disponibles <= 0) {
      return NextResponse.json({ error: mensajeTopeComprobantes(tope.tope!), sinCupo: true, tope: { usados: tope.usados, tope: tope.tope } }, { status: 429 });
    }
    if (relacion.length > tope.disponibles) {
      recortados = relacion.length - tope.disponibles;
      relacionTope = relacion.slice(0, tope.disponibles);
    }
  }

  const r = await extraerComprobantesPdf({
    ruc: cliente.ruc,
    solUser,
    solPass,
    periodo,
    relacion: relacionTope,
    diagnostico: body.diagnostico === true,
    soloScraping: body.soloScraping === true,
  });
  await ocultarDiag(r);

  if (r.loginError) {
    return NextResponse.json({ error: r.error, loginError: true, diag: r.diag }, { status: 401 });
  }
  if (r.sunatCaido && !r.descargados) {
    return NextResponse.json({ error: r.error, sunatCaido: true, fallidos: r.fallidos ?? [], diag: r.diag }, { status: 503 });
  }
  let usadosMes = tope?.usados ?? 0;
  if (tope) usadosMes = await sumarComprobantes(tope.adminId, Number(r.descargados) || 0);
  const avisoTope = tope?.tope != null && recortados > 0
    ? `Se procesaron solo ${relacionTope.length} comprobante(s): llegaste al máximo de ${tope.tope} del mes (${recortados} quedaron fuera).`
    : undefined;

  return NextResponse.json({
    comprobantes: r.comprobantes ?? [],
    descargados: r.descargados ?? 0,
    fallidos: r.fallidos ?? [],
    sunatCaido: !!r.sunatCaido,
    error: r.error,
    tope: tope ? { usados: usadosMes, tope: tope.tope, recortados } : null,
    avisoTope,
    diag: r.diag,
  });
}
