import { NextRequest, NextResponse } from "next/server";
import { getClienteAutorizado } from "@/lib/auth";
import { extraerComprobantesPdf } from "@/lib/comprobantesXml";
import { chequearUso, registrarUso } from "@/lib/usos";

export const runtime = "nodejs";
export const maxDuration = 240;

// MÓDULO PDF MASIVO: baja el PDF OFICIAL de SUNAT de los comprobantes RECIBIDOS.
// Híbrido: API-first (endpoint interno /01, en paralelo) + scraping de respaldo
// (ícono PDF del modal, el método de la versión anterior). En Modo diagnóstico
// devuelve las llamadas de red internas (apiCalls) para calibrar el endpoint.
// La Clave SOL viaja en el body y NO se persiste. Consume 1 uso solo si el login
// fue correcto (primera parte).
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
  if (!relacion.length) {
    return NextResponse.json({ error: "Sube una relación de comprobantes o cárgala del SIRE." }, { status: 400 });
  }

  // Toda la operación cuenta como UN uso; solo la primera tanda consume cupo.
  const esPrimeraParte = !body.parte;
  const uso = esPrimeraParte ? await chequearUso() : { ok: true, adminId: "", ilimitado: true } as any;
  if (esPrimeraParte && !uso.ok && !body.diagnostico) {
    return NextResponse.json({ error: uso.mensaje, sinUsos: true, renuevaAt: uso.renuevaAt }, { status: 429 });
  }

  const r = await extraerComprobantesPdf({
    ruc: cliente.ruc,
    solUser,
    solPass,
    periodo,
    relacion,
    diagnostico: body.diagnostico === true,
    soloScraping: body.soloScraping === true,
  });

  if (r.loginError) {
    return NextResponse.json({ error: r.error, loginError: true, diag: r.diag }, { status: 401 });
  }
  if (r.sunatCaido && !r.descargados) {
    return NextResponse.json({ error: r.error, sunatCaido: true, fallidos: r.fallidos ?? [], diag: r.diag }, { status: 503 });
  }
  if (esPrimeraParte && !body.diagnostico && uso.ok) await registrarUso(uso.adminId, uso.ilimitado);

  return NextResponse.json({
    comprobantes: r.comprobantes ?? [],
    descargados: r.descargados ?? 0,
    fallidos: r.fallidos ?? [],
    sunatCaido: !!r.sunatCaido,
    error: r.error,
    diag: r.diag,
  });
}
