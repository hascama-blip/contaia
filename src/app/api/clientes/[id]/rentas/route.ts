import { NextRequest, NextResponse } from "next/server";
import { getClienteAutorizado, requireUser } from "@/lib/auth";
import { esPersonaNatural } from "@/lib/types";
import { getRttConfig, upsertSolicitudRentas, setEstadoRentas, getSolicitudRentas, getWebhookLogRTT, leerPdfRentas } from "@/lib/db";
import { generarReporteRentas } from "@/lib/reporteRentasBot";

export const runtime = "nodejs";
export const maxDuration = 200;

// GET → estado + detalle del reporte de rentas de este cliente.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const cliente = await getClienteAutorizado(params.id);
  if (!cliente) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  let sol = await getSolicitudRentas(params.id);
  // Auto-corrección: si el reporte fue parseado con una versión antigua (renta y
  // retención cruzadas → sin `totalRenta4ta`), re-parseamos el PDF ya guardado
  // sin volver a SUNAT. Es una sola vez (luego ya trae el campo nuevo).
  if (sol?.rutaPdf && sol.reporte && (sol.reporte as any).totalRenta4ta === undefined) {
    const buf = await leerPdfRentas(sol.rutaPdf);
    if (buf) {
      try {
        const { textoDePdf, parseReporteRentas } = await import("@/lib/reporteRentas");
        const reporte = parseReporteRentas(await textoDePdf(buf));
        sol = (await setEstadoRentas(params.id, sol.estado, { reporte })) ?? sol;
      } catch { /* si falla el re-parseo, se queda el reporte previo */ }
    }
  }
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

  // ⚠️ El formulario de rentas de SUNAT EXIGE que el correo tenga menos de 40
  // caracteres (a diferencia del RTT). Rentas es solo para persona natural
  // (RUC 10 o 15, ambos empiezan con "1"), así que usamos el RUC SIN el primer
  // dígito "1" (10 dígitos) como parte local → `0727195594@dominio` = 39 chars.
  // El webhook reconstruye el RUC anteponiendo "1" (sirve para 10 y 15).
  const parteLocal = esPersonaNatural(cliente.ruc) ? cliente.ruc.slice(1) : cliente.ruc;
  const emailDestino = `${parteLocal}@${dominio}`;

  if (body.diagnostico === true) {
    const r = await generarReporteRentas({ ruc: cliente.ruc, solUser, solPass, emailDestino, ejercicio, diagnostico: true });
    return NextResponse.json({ diag: r.diag });
  }

  const sol = await upsertSolicitudRentas({ clienteId: params.id, ruc: cliente.ruc, emailDestino, solicitadoPor: user.id });
  const r = await generarReporteRentas({ ruc: cliente.ruc, solUser, solPass, emailDestino, ejercicio });
  if (!r.ok) {
    await setEstadoRentas(params.id, "error", { error: r.error });
    return NextResponse.json({ error: r.error ?? "No se pudo generar el reporte.", diag: r.diag }, { status: r.loginError ? 401 : 502 });
  }
  // Devolvemos también la traza de la generación (modal/confirmado/éxito) para
  // poder verificar que SUNAT aceptó el envío, sin activar el modo diagnóstico.
  return NextResponse.json({ solicitud: sol, diag: r.diag });
}
