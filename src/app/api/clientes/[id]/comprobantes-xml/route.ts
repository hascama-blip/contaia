import { bloqueoModulo, limpiarDiagnostico, ocultarDiag } from "@/lib/acceso";
import { esClienteDemo, demoNoDisponible, demoSunat, demoSire, demoSireEstado, demoSireDetalle, demoBuzon, demoItf } from "@/lib/demoRutas";
import { NextRequest, NextResponse } from "next/server";
import { getClienteAutorizado } from "@/lib/auth";
import { extraerComprobantesXml } from "@/lib/comprobantesXml";
import { comprobantesDisponibles, sumarComprobantes, mensajeTopeComprobantes } from "@/lib/cupos";
import { guardarComprobanteExtraido, listarComprobantesExtraidos } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 240;

// GET → recupera los comprobantes YA extraídos de un periodo (para no rehacerlos
// si se cae el internet / se recarga la página).
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const _bloqueo = await bloqueoModulo("comprobantes-xml");if (_bloqueo) return _bloqueo;
  const cliente = await getClienteAutorizado(params.id);
  if (!cliente) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  const periodo = new URL(req.url).searchParams.get("periodo") ?? "";
  const facturas = await listarComprobantesExtraidos(params.id, periodo);
  return NextResponse.json({ facturas });
}

// Descarga los XML de comprobantes RECIBIDOS (compras) del periodo desde SUNAT
// SOL (scraping). La Clave SOL viaja en el body y NO se persiste. Consume 1 uso
// del cupo gratis solo si el login fue correcto (clave errada NO consume).
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
  // Se acepta una relación (lista de comprobantes) o un periodo AAAAMM.
  if (!relacion.length && !/^\d{6}$/.test(periodo)) {
    return NextResponse.json({ error: "Sube una relación de comprobantes o indica un periodo (AAAAMM)." }, { status: 400 });
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

  const r = await extraerComprobantesXml({
    ruc: cliente.ruc,
    solUser,
    solPass,
    periodo,
    relacion: relacionTope,
    diagnostico: body.diagnostico === true,
  });
  await ocultarDiag(r);

  // Clave SOL errada / bloqueo → NO consume uso.
  if (r.loginError) {
    return NextResponse.json({ error: r.error, loginError: true, diag: r.diag }, { status: 401 });
  }
  // SUNAT caído (Error del Servidor) → NO consume uso y el frontend corta la
  // descarga de las demás tandas (no tiene sentido seguir).
  if (r.sunatCaido && !r.descargados) {
    return NextResponse.json({ error: r.error, sunatCaido: true, fallidos: r.fallidos ?? [], diag: r.diag }, { status: 503 });
  }
  let usadosMes = tope?.usados ?? 0;
  if (tope) usadosMes = await sumarComprobantes(tope.adminId, Number(r.descargados) || 0);
  const avisoTope = tope?.tope != null && recortados > 0
    ? `Se procesaron solo ${relacionTope.length} comprobante(s): llegaste al máximo de ${tope.tope} del mes (${recortados} quedaron fuera).`
    : undefined;

  // Persistir lo extraído (por cliente+periodo) para poder recuperarlo si se cae
  // el internet o se recarga la página. Se guarda en disco, no en el store.json.
  if (!body.diagnostico && /^\d{6}$/.test(periodo) && Array.isArray(r.facturas)) {
    for (const f of r.facturas) await guardarComprobanteExtraido(params.id, periodo, f).catch(() => {});
  }

  return NextResponse.json({
    facturas: r.facturas ?? [],
    descargados: r.descargados ?? 0,
    fallidos: r.fallidos ?? [],
    sunatCaido: !!r.sunatCaido,
    error: r.error,
    tope: tope ? { usados: usadosMes, tope: tope.tope, recortados } : null,
    avisoTope,
    diag: r.diag,
  });
}
