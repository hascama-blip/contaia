import { NextRequest, NextResponse } from "next/server";
import { getClienteAutorizado, getCurrentUser, esAdmin } from "@/lib/auth";
import { setBuzon } from "@/lib/db";
import { consultarBuzon } from "@/lib/buzon";

export const runtime = "nodejs";
export const maxDuration = 120;

const UN_DIA = 24 * 60 * 60 * 1000;

function mensajesGuardados(cliente: { buzon?: { mensajes?: any[]; peligrosos?: any[]; urgentes?: any[] } | null }) {
  const b = cliente.buzon;
  return b?.mensajes?.length ? b.mensajes : [...(b?.peligrosos ?? []), ...(b?.urgentes ?? [])];
}

// GET: devuelve los mensajes YA GUARDADOS del buzón (sin clave), y marca cuáles
// tienen su PDF en caché. Para abrir rápido sin re-extraer.
export async function GET(req: NextRequest) {
  const clienteId = req.nextUrl.searchParams.get("clienteId") ?? "";
  const cliente = await getClienteAutorizado(clienteId);
  if (!cliente) return NextResponse.json({ error: "Empresa no encontrada." }, { status: 404 });
  const adj = cliente.buzonAdjuntos ?? {};
  const cacheados = Object.keys(adj);
  // Por mensaje: fecha/hora de la última descarga + quién la hizo.
  const descargas: Record<string, { at: string; por?: string }> = {};
  for (const [cod, m] of Object.entries(adj)) {
    descargas[cod] = { at: m.descargadaAt ?? m.at, por: m.descargadoPorNombre };
  }
  return NextResponse.json({
    razonSocial: cliente.razonSocial,
    ruc: cliente.ruc,
    mensajes: mensajesGuardados(cliente),
    consultadoAt: cliente.buzon?.consultadoAt ?? null,
    cacheados,
    descargas,
  });
}

// Extrae los mensajes del buzón (asuntos) de una empresa del usuario. Se GUARDAN
// para que no se pierdan al refrescar. La Clave SOL NO se guarda. Límite: 1 vez
// al día por empresa (evita el bloqueo de SUNAT por demasiados ingresos).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const cliente = await getClienteAutorizado(String(body?.clienteId ?? ""));
  if (!cliente) return NextResponse.json({ error: "Empresa no encontrada." }, { status: 404 });

  // Límite de 1 consulta al día. Solo el admin puede forzar.
  const ultima = cliente.buzon?.consultadoAt ? new Date(cliente.buzon.consultadoAt).getTime() : 0;
  const dentroDelDia = ultima && Date.now() - ultima < UN_DIA;
  if (dentroDelDia && !body.diagnostico) {
    const usuario = await getCurrentUser();
    const puedeForzar = body.forzar === true && esAdmin(usuario);
    if (!puedeForzar) {
      const horas = Math.ceil((UN_DIA - (Date.now() - ultima)) / (60 * 60 * 1000));
      return NextResponse.json({
        razonSocial: cliente.razonSocial,
        ruc: cliente.ruc,
        mensajes: mensajesGuardados(cliente),
        consultadoAt: cliente.buzon?.consultadoAt ?? null,
        limitado: true,
        mensaje: `El buzón ya se consultó hoy (${new Date(cliente.buzon!.consultadoAt).toLocaleString("es-PE")}). Para no saturar SUNAT, se puede consultar 1 vez al día. Vuelve en ~${horas} h.`,
      });
    }
  }

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
    // Persistir (salvo en modo diagnóstico) para que sobreviva al refresco.
    if (!r.diag) {
      await setBuzon(cliente.id, {
        peligrosos: r.peligrosos,
        urgentes: r.urgentes,
        mensajes: r.mensajes,
        totalMensajes: r.mensajes.length,
        consultadoAt: new Date().toISOString(),
      }).catch(() => {});
    }
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
