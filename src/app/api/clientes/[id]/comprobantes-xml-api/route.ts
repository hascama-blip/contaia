import { NextRequest, NextResponse } from "next/server";
import { getClienteAutorizado } from "@/lib/auth";
import { extraerComprobantesXmlApi } from "@/lib/comprobantesXml";
import { chequearUso, registrarUso } from "@/lib/usos";
import { guardarComprobanteExtraido } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 240;

// MODO API: extrae el XML de comprobantes RECIBIDOS (compras) SIN PDF. Reutiliza
// la sesión SOL, omite el PDF (más rápido) y, en Modo diagnóstico, devuelve las
// llamadas de red internas de SUNAT (apiCalls) para identificar el endpoint. Si
// se configura CPE_XML_API_URL, baja el XML por fetch directo (sin clics).
// La Clave SOL viaja en el body y NO se persiste. Consume 1 uso solo si el login
// fue correcto (clave errada NO consume).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const cliente = await getClienteAutorizado(params.id);
  if (!cliente) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const solUser =
    (typeof body.solUser === "string" && body.solUser) || cliente.credSire?.solUser || "";
  const solPass = typeof body.solPass === "string" ? body.solPass : "";
  const periodo = String(body.periodo ?? "");
  const relacion = Array.isArray(body.relacion) ? body.relacion : [];
  if (!solUser || !solPass) {
    return NextResponse.json({ error: "Ingresa el Usuario SOL y la Clave SOL." }, { status: 400 });
  }
  if (!relacion.length && !/^\d{6}$/.test(periodo)) {
    return NextResponse.json({ error: "Sube una relación de comprobantes o indica un periodo (AAAAMM)." }, { status: 400 });
  }

  // Igual que el modo scraping: toda la operación cuenta como UN uso; solo la
  // primera tanda (parte 0 o sin parte) chequea/consume el cupo.
  const esPrimeraParte = !body.parte;
  const uso = esPrimeraParte ? await chequearUso() : { ok: true, adminId: "", ilimitado: true } as any;
  if (esPrimeraParte && !uso.ok && !body.diagnostico) {
    return NextResponse.json({ error: uso.mensaje, sinUsos: true, renuevaAt: uso.renuevaAt }, { status: 429 });
  }

  const r = await extraerComprobantesXmlApi({
    ruc: cliente.ruc,
    solUser,
    solPass,
    periodo,
    relacion,
    diagnostico: body.diagnostico === true,
  });

  if (r.loginError) {
    return NextResponse.json({ error: r.error, loginError: true, diag: r.diag }, { status: 401 });
  }
  if (r.sunatCaido && !r.descargados) {
    return NextResponse.json({ error: r.error, sunatCaido: true, fallidos: r.fallidos ?? [], diag: r.diag }, { status: 503 });
  }
  if (esPrimeraParte && !body.diagnostico && uso.ok) await registrarUso(uso.adminId, uso.ilimitado);

  // Persistir lo extraído (por cliente+periodo) para poder recuperarlo luego.
  if (!body.diagnostico && /^\d{6}$/.test(periodo) && Array.isArray(r.facturas)) {
    for (const f of r.facturas) await guardarComprobanteExtraido(params.id, periodo, f).catch(() => {});
  }

  return NextResponse.json({
    facturas: r.facturas ?? [],
    descargados: r.descargados ?? 0,
    fallidos: r.fallidos ?? [],
    sunatCaido: !!r.sunatCaido,
    error: r.error,
    diag: r.diag,
  });
}
