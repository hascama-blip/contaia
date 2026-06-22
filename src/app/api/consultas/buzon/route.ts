import { NextRequest, NextResponse } from "next/server";
import { getClienteAutorizado } from "@/lib/auth";
import { consultarBuzon } from "@/lib/buzon";

export const runtime = "nodejs";
export const maxDuration = 120;

// GET: devuelve los mensajes YA GUARDADOS del buzón (sin clave), y marca cuáles
// tienen su PDF en caché. Para abrir rápido sin re-extraer.
export async function GET(req: NextRequest) {
  const clienteId = req.nextUrl.searchParams.get("clienteId") ?? "";
  const cliente = await getClienteAutorizado(clienteId);
  if (!cliente) return NextResponse.json({ error: "Empresa no encontrada." }, { status: 404 });
  const buzon = cliente.buzon;
  const mensajes =
    buzon?.mensajes?.length ? buzon.mensajes : [...(buzon?.peligrosos ?? []), ...(buzon?.urgentes ?? [])];
  const cacheados = Object.keys(cliente.buzonAdjuntos ?? {});
  return NextResponse.json({
    razonSocial: cliente.razonSocial,
    ruc: cliente.ruc,
    mensajes,
    consultadoAt: buzon?.consultadoAt ?? null,
    cacheados,
  });
}

// Extrae los mensajes del buzón (asuntos) de una empresa del usuario.
// La Clave SOL se usa solo para esta llamada y NO se guarda.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const cliente = await getClienteAutorizado(String(body?.clienteId ?? ""));
  if (!cliente) return NextResponse.json({ error: "Empresa no encontrada." }, { status: 404 });

  const solUser =
    (typeof body.solUser === "string" && body.solUser) || cliente.credSire?.solUser || "";
  const solPass = typeof body.solPass === "string" ? body.solPass : "";
  if (!solUser || !solPass) {
    return NextResponse.json({ error: "Ingresa el Usuario y la Clave SOL." }, { status: 400 });
  }

  try {
    const r = await consultarBuzon({
      ruc: cliente.ruc,
      solUser,
      solPass,
      dias: typeof body.dias === "number" ? body.dias : 30,
      diagnostico: body.diagnostico === true,
    });
    return NextResponse.json({
      razonSocial: cliente.razonSocial,
      ruc: cliente.ruc,
      mensajes: r.mensajes,
      peligrosos: r.peligrosos,
      urgentes: r.urgentes,
      diag: r.diag,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Error consultando buzón." }, { status: 400 });
  }
}
