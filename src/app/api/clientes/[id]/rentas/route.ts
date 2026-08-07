import { NextRequest, NextResponse } from "next/server";
import { getClienteAutorizado, requireUser } from "@/lib/auth";
import { getRttConfig, upsertSolicitudRentas, setEstadoRentas, getSolicitudRentas, getWebhookLogRTT } from "@/lib/db";
import { generarReporteRentas } from "@/lib/reporteRentasBot";

export const runtime = "nodejs";
export const maxDuration = 200;

// GET → estado + detalle del reporte de rentas de este cliente.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const cliente = await getClienteAutorizado(params.id);
  if (!cliente) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  const sol = await getSolicitudRentas(params.id);
  const { dominio } = await getRttConfig();
  // Bitácora de la nube (últimos correos recibidos por el webhook) filtrada a
  // este RUC → para ver si el correo del reporte ya llegó y qué pasó con él.
  const log = (await getWebhookLogRTT()) ?? [];
  const bitacora = log.filter((e) => e.ruc === cliente.ruc).slice(0, 6);
  return NextResponse.json({ solicitud: sol, dominioOk: !!dominio, bitacora });
}

// POST → dispara el bot: login → menú → Reporte de Rentas → Generar. SUNAT lo
// envía por correo (nube) y el webhook lo captura y parsea. La Clave SOL NO se
// persiste.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  const cliente = await getClienteAutorizado(params.id);
  if (!cliente) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const solUser = (typeof body.solUser === "string" && body.solUser) || cliente.credSire?.solUser || "";
  const solPass = typeof body.solPass === "string" ? body.solPass : "";
  const ejercicio = typeof body.ejercicio === "string" ? body.ejercicio : undefined;
  if (!solUser || !solPass) return NextResponse.json({ error: "Ingresa el Usuario SOL y la Clave SOL." }, { status: 400 });

  const { dominio } = await getRttConfig();
  if (!dominio) return NextResponse.json({ error: "Falta configurar el dominio del webhook (RTT_DOMINIO)." }, { status: 400 });

  const emailDestino = `reportes+RENTAS${cliente.ruc}@${dominio}`;

  if (body.diagnostico === true) {
    const r = await generarReporteRentas({ ruc: cliente.ruc, solUser, solPass, emailDestino, ejercicio, diagnostico: true });
    return NextResponse.json({ diag: r.diag });
  }

  const sol = await upsertSolicitudRentas({ clienteId: params.id, ruc: cliente.ruc, emailDestino, solicitadoPor: user.id });
  const r = await generarReporteRentas({ ruc: cliente.ruc, solUser, solPass, emailDestino, ejercicio });
  if (!r.ok) {
    await setEstadoRentas(params.id, "error", { error: r.error });
    return NextResponse.json({ error: r.error ?? "No se pudo generar el reporte." }, { status: r.loginError ? 401 : 502 });
  }
  return NextResponse.json({ solicitud: sol });
}
