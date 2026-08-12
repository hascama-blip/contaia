import { NextRequest, NextResponse } from "next/server";
import { getClienteAutorizado, requireUser } from "@/lib/auth";
import { esPersonaNatural } from "@/lib/types";
import { getRttConfig, upsertSolicitudRentas, setEstadoRentas, setItfReporte, setBuzon, setDeudaGenerado } from "@/lib/db";
import { generarReporteRentas } from "@/lib/reporteRentasBot";
import { consultarItf } from "@/lib/itf";
import { consultarBuzon } from "@/lib/buzon";
import { generarPedidoDeuda } from "@/lib/fraccionamiento";

export const runtime = "nodejs";
export const maxDuration = 300;

const UN_DIA = 24 * 60 * 60 * 1000;
const TRES_DIAS = 3 * 24 * 60 * 60 * 1000;

// "Extraer todo (persona natural)" — TODO en UNA sola sesión SUNAT: el primer
// módulo inicia sesión y los demás REUTILIZAN las cookies (caché en RAM). Corre:
//   buzón · fraccionamiento (genera pedido) · rentas 4ta/5ta · ITF.
// Respeta los límites de cada módulo (buzón 1/día, fraccionamiento cada 3 días).
// Cada módulo persiste su resultado apenas termina (una caída parcial no pierde
// lo ya extraído). La Clave SOL NO se persiste.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  const cliente = await getClienteAutorizado(params.id);
  if (!cliente) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  const personaNatural = esPersonaNatural(cliente.ruc);

  const body = await req.json().catch(() => ({}));
  const solUser = (typeof body.solUser === "string" && body.solUser) || cliente.credSire?.solUser || "";
  const solPass = typeof body.solPass === "string" ? body.solPass : "";
  const ejercicio = typeof body.ejercicio === "string" ? body.ejercicio : "2025";
  if (!solUser || !solPass) return NextResponse.json({ error: "Ingresa el Usuario SOL y la Clave SOL." }, { status: 400 });

  const salida: any = { buzon: null, fraccionamiento: null, rentas: null, itf: null };
  const errLogin = (e?: string) => NextResponse.json({ error: e ?? "SUNAT rechazó el login.", loginError: true, parcial: salida }, { status: 401 });

  // 1) BUZÓN — inicia sesión (1 vez al día). Establece la sesión para el resto.
  const ultimaBuzon = cliente.buzon?.consultadoAt ? new Date(cliente.buzon.consultadoAt).getTime() : 0;
  if (ultimaBuzon && Date.now() - ultimaBuzon < UN_DIA) {
    salida.buzon = { ok: true, omitido: true, nota: "Ya se consultó hoy" };
  } else {
    try {
      const b = await consultarBuzon({ ruc: cliente.ruc, solUser, solPass, dias: 15 });
      if (b.loginError) return errLogin(b.error);
      await setBuzon(cliente.id, {
        peligrosos: b.peligrosos, urgentes: b.urgentes, mensajes: b.mensajes,
        totalMensajes: b.mensajes.length, consultadoAt: new Date().toISOString(),
      });
      salida.buzon = { ok: true, mensajes: b.mensajes.length, peligrosos: b.peligrosos.length, urgentes: b.urgentes.length };
    } catch (e: any) { salida.buzon = { ok: false, error: e?.message ?? "Error en buzón." }; }
  }

  // 2) FRACCIONAMIENTO — genera el pedido (cada 3 días). Reutiliza la sesión.
  const genAt = cliente.deudasF36?.generadoAt;
  if (genAt && Date.now() - new Date(genAt).getTime() < TRES_DIAS) {
    salida.fraccionamiento = { ok: true, omitido: true, nota: "Pedido generado hace poco (usa Verificar/Extraer)" };
  } else {
    try {
      const f = await generarPedidoDeuda({ ruc: cliente.ruc, solUser, solPass });
      if ((f as any).loginError) return errLogin(f.error);
      if (f.ok) {
        await setDeudaGenerado(cliente.id, { numPedido: f.numPedido, fechaPedido: f.fechaPedido }).catch(() => {});
        salida.fraccionamiento = { ok: true, numPedido: f.numPedido };
      } else salida.fraccionamiento = { ok: false, error: f.error };
    } catch (e: any) { salida.fraccionamiento = { ok: false, error: e?.message ?? "Error en fraccionamiento." }; }
  }

  // 3) y 4) RENTAS 4ta/5ta + ITF — SOLO persona natural (RUC 10/15).
  if (personaNatural) {
    // Rentas: dispara el bot (llega por la nube). Reutiliza la sesión.
    const { dominio } = await getRttConfig();
    if (dominio) {
      const emailDestino = `${cliente.ruc.slice(1)}@${dominio}`;
      const sol = await upsertSolicitudRentas({ clienteId: params.id, ruc: cliente.ruc, emailDestino, solicitadoPor: user.id });
      try {
        const r = await generarReporteRentas({ ruc: cliente.ruc, solUser, solPass, emailDestino, ejercicio });
        if (r.loginError) { await setEstadoRentas(params.id, "error", { error: r.error }); return errLogin(r.error); }
        if (!r.ok) { await setEstadoRentas(params.id, "error", { error: r.error }); salida.rentas = { ok: false, error: r.error }; }
        else salida.rentas = { ok: true, estado: sol.estado };
      } catch (e: any) { salida.rentas = { ok: false, error: e?.message ?? "Error en rentas." }; }
    } else {
      salida.rentas = { ok: false, error: "Falta configurar el dominio del webhook (RTT_DOMINIO)." };
    }

    // ITF — en pantalla. Reutiliza la sesión.
    try {
      const r = await consultarItf({ ruc: cliente.ruc, solUser, solPass, ejercicio });
      if (r.loginError) return errLogin(r.error);
      if (r.ok && r.itf) { await setItfReporte(params.id, r.itf).catch(() => {}); salida.itf = { ok: true, registros: r.itf.filas.length, total: r.itf.total }; }
      else salida.itf = { ok: false, error: r.error };
    } catch (e: any) { salida.itf = { ok: false, error: e?.message ?? "Error en ITF." }; }
  }

  return NextResponse.json({ ok: true, personaNatural, ...salida });
}
