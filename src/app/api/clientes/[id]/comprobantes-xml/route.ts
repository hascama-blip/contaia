import { NextRequest, NextResponse } from "next/server";
import { getClienteAutorizado } from "@/lib/auth";
import { extraerComprobantesXml } from "@/lib/comprobantesXml";
import { chequearUso, registrarUso } from "@/lib/usos";
import { guardarComprobanteExtraido, listarComprobantesExtraidos } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 240;

// GET → recupera los comprobantes YA extraídos de un periodo (para no rehacerlos
// si se cae el internet / se recarga la página).
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const cliente = await getClienteAutorizado(params.id);
  if (!cliente) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  const periodo = new URL(req.url).searchParams.get("periodo") ?? "";
  const facturas = await listarComprobantesExtraidos(params.id, periodo);
  return NextResponse.json({ facturas });
}

// Descarga los XML de comprobantes RECIBIDOS (compras) del periodo desde SUNAT
// SOL (scraping). La Clave SOL viaja en el body y NO se persiste. Consume 1 uso
// del cupo gratis solo si el login fue correcto (clave errada NO consume).
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
  // Se acepta una relación (lista de comprobantes) o un periodo AAAAMM.
  if (!relacion.length && !/^\d{6}$/.test(periodo)) {
    return NextResponse.json({ error: "Sube una relación de comprobantes o indica un periodo (AAAAMM)." }, { status: 400 });
  }

  // Una relación grande se procesa en TANDAS (el frontend parte la lista y llama
  // varias veces). Toda la operación cuenta como UN solo uso: solo la primera
  // tanda (parte 0 o sin parte) chequea/consume el cupo; las siguientes no.
  const esPrimeraParte = !body.parte;
  const uso = esPrimeraParte ? await chequearUso() : { ok: true, adminId: "", ilimitado: true } as any;
  if (esPrimeraParte && !uso.ok && !body.diagnostico) {
    return NextResponse.json({ error: uso.mensaje, sinUsos: true, renuevaAt: uso.renuevaAt }, { status: 429 });
  }

  const r = await extraerComprobantesXml({
    ruc: cliente.ruc,
    solUser,
    solPass,
    periodo,
    relacion,
    diagnostico: body.diagnostico === true,
  });

  // Clave SOL errada / bloqueo → NO consume uso.
  if (r.loginError) {
    return NextResponse.json({ error: r.error, loginError: true, diag: r.diag }, { status: 401 });
  }
  // SUNAT caído (Error del Servidor) → NO consume uso y el frontend corta la
  // descarga de las demás tandas (no tiene sentido seguir).
  if (r.sunatCaido && !r.descargados) {
    return NextResponse.json({ error: r.error, sunatCaido: true, fallidos: r.fallidos ?? [], diag: r.diag }, { status: 503 });
  }
  if (esPrimeraParte && !body.diagnostico && uso.ok) await registrarUso(uso.adminId, uso.ilimitado);

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
    diag: r.diag,
  });
}
