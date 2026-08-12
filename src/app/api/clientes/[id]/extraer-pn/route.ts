import { NextRequest, NextResponse } from "next/server";
import { getClienteAutorizado, requireUser } from "@/lib/auth";
import { esPersonaNatural } from "@/lib/types";
import { getRttConfig, upsertSolicitudRentas, setEstadoRentas, setItfReporte } from "@/lib/db";
import { generarReporteRentas } from "@/lib/reporteRentasBot";
import { consultarItf } from "@/lib/itf";

export const runtime = "nodejs";
export const maxDuration = 260;

// "Extraer todo (persona natural)": en UNA sola sesión SUNAT (el primer módulo
// inicia sesión y el segundo REUTILIZA las cookies vía caché) genera el Reporte
// de Rentas 4ta/5ta y consulta el ITF. Menos logins = menos captcha/bloqueo.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  const cliente = await getClienteAutorizado(params.id);
  if (!cliente) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  if (!esPersonaNatural(cliente.ruc)) {
    return NextResponse.json({ error: "Solo para persona natural (RUC 10/15)." }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const solUser = (typeof body.solUser === "string" && body.solUser) || cliente.credSire?.solUser || "";
  const solPass = typeof body.solPass === "string" ? body.solPass : "";
  const ejercicio = typeof body.ejercicio === "string" ? body.ejercicio : "2025";
  if (!solUser || !solPass) return NextResponse.json({ error: "Ingresa el Usuario SOL y la Clave SOL." }, { status: 400 });

  const { dominio } = await getRttConfig();
  const salida: any = { rentas: null, itf: null };

  // 1) Rentas 4ta/5ta (dispara el bot; llega por la nube). Inicia sesión.
  if (dominio) {
    const parteLocal = cliente.ruc.slice(1); // RUC 10/15 sin el "1" inicial → <40 chars
    const emailDestino = `${parteLocal}@${dominio}`;
    const sol = await upsertSolicitudRentas({ clienteId: params.id, ruc: cliente.ruc, emailDestino, solicitadoPor: user.id });
    try {
      const r = await generarReporteRentas({ ruc: cliente.ruc, solUser, solPass, emailDestino, ejercicio });
      if (r.loginError) {
        await setEstadoRentas(params.id, "error", { error: r.error });
        return NextResponse.json({ error: r.error ?? "SUNAT rechazó el login.", loginError: true }, { status: 401 });
      }
      if (!r.ok) { await setEstadoRentas(params.id, "error", { error: r.error }); salida.rentas = { ok: false, error: r.error }; }
      else salida.rentas = { ok: true, estado: sol.estado };
    } catch (e: any) { salida.rentas = { ok: false, error: e?.message ?? "Error en rentas." }; }
  } else {
    salida.rentas = { ok: false, error: "Falta configurar el dominio del webhook (RTT_DOMINIO)." };
  }

  // 2) ITF (en pantalla). REUTILIZA la sesión iniciada en el paso 1 (caché).
  try {
    const r = await consultarItf({ ruc: cliente.ruc, solUser, solPass, ejercicio });
    if (r.loginError) return NextResponse.json({ error: r.error ?? "SUNAT rechazó el login.", loginError: true, parcial: salida }, { status: 401 });
    if (r.ok && r.itf) { await setItfReporte(params.id, r.itf).catch(() => {}); salida.itf = { ok: true, registros: r.itf.filas.length, total: r.itf.total }; }
    else salida.itf = { ok: false, error: r.error };
  } catch (e: any) { salida.itf = { ok: false, error: e?.message ?? "Error en ITF." }; }

  return NextResponse.json({ ok: true, ...salida });
}
