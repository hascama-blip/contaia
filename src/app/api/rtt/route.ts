import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { crearSolicitudRTT, setEstadoRTT, listarSolicitudesRTT, contarRTTHoy, getRttConfig, marcarRTTAtascados } from "@/lib/db";
import { generarRTT } from "@/lib/rtt";

export const runtime = "nodejs";
export const maxDuration = 240;

// GET → lista las solicitudes RTT del usuario (con su trazabilidad).
export async function GET() {
  const user = await requireUser();
  await marcarRTTAtascados(60); // marca error los atascados >60 min
  const solicitudes = await listarSolicitudesRTT(user.id);
  return NextResponse.json({ solicitudes });
}

// POST → crea una solicitud de RTT y dispara el bot en SOL (pasos 1→3).
export async function POST(req: NextRequest) {
  const user = await requireUser();
  const body = await req.json().catch(() => ({}));
  // ruc = el tercero que se reporta (asunto del RTT). rucLogin = la cuenta SOL
  // que inicia sesión (por defecto, el mismo).
  const ruc = String(body.ruc ?? "").replace(/\D/g, "");
  const rucLogin = String(body.rucLogin ?? ruc).replace(/\D/g, "") || ruc;
  const solUser = typeof body.solUser === "string" ? body.solUser : "";
  const solPass = typeof body.solPass === "string" ? body.solPass : "";
  const razonSocial = typeof body.razonSocial === "string" ? body.razonSocial : undefined;

  if (!/^\d{11}$/.test(ruc)) return NextResponse.json({ error: "RUC a reportar inválido (11 dígitos)." }, { status: 400 });
  if (!/^\d{11}$/.test(rucLogin)) return NextResponse.json({ error: "RUC de acceso SOL inválido." }, { status: 400 });
  if (!solUser || !solPass) return NextResponse.json({ error: "Ingresa el Usuario SOL y la Clave SOL." }, { status: 400 });

  const { dominio } = await getRttConfig();
  if (!dominio) {
    return NextResponse.json({ error: "Falta configurar el dominio del webhook (RTT_DOMINIO). Configúralo en el panel Supremo." }, { status: 400 });
  }

  // Límite SUNAT: 3 reportes por día por RUC.
  if ((await contarRTTHoy(ruc)) >= 3) {
    return NextResponse.json({ error: "SUNAT permite máximo 3 reportes RTT por día por RUC. Intenta mañana." }, { status: 429 });
  }

  // Sub-address con el RUC embebido (match determinístico en el webhook).
  const emailDestino = `reportes+RUC${ruc}@${dominio}`;
  const sol = await crearSolicitudRTT({ ruc, razonSocial, emailDestino, solicitadoPor: user.id });
  await setEstadoRTT(sol.id, "pendiente", "encolado");

  // Dispara el bot en SOL (paso 3). Login con rucLogin; el correo lleva el RUC
  // del tercero para el match. La Clave SOL NO se persiste.
  const r = await generarRTT({ ruc: rucLogin, solUser, solPass, emailDestino, diagnostico: body.diagnostico === true });

  if (body.diagnostico) {
    return NextResponse.json({ solicitud: sol, diag: r.diag });
  }
  if (r.loginError) {
    const s = await setEstadoRTT(sol.id, "error", "login SOL falló", { error: r.error });
    return NextResponse.json({ solicitud: s, error: r.error }, { status: 401 });
  }
  if (!r.ok) {
    const s = await setEstadoRTT(sol.id, "error", "el bot no pudo generar el RTT", { error: r.error });
    return NextResponse.json({ solicitud: s, error: r.error }, { status: 502 });
  }
  const s = await setEstadoRTT(sol.id, "en_proceso", "solicitud enviada en SOL; esperando el correo de SUNAT");
  return NextResponse.json({ solicitud: s });
}
