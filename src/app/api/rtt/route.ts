import { bloqueoModulo, limpiarDiagnostico, ocultarDiag } from "@/lib/acceso";
import { esRucDemo } from "@/lib/demo";
import { NextRequest, NextResponse } from "next/server";
import { requireUser, esSupremo, studioId } from "@/lib/auth";
import { getClienteByRuc, upsertSolicitudRTT, resolverFalloRTT, listarSolicitudesRTT, getRttConfig, limpiarRTT, getWebhookLogRTT } from "@/lib/db";
import { generarRTT } from "@/lib/rtt";

export const runtime = "nodejs";
export const maxDuration = 300;

// GET → lista las solicitudes RTT del usuario + bitácora del webhook + config.
export async function GET() {
  const _bloqueo = await bloqueoModulo("rtt"); if (_bloqueo) return _bloqueo;
  const user = await requireUser();
  await limpiarRTT(30); // quita casillas en error / atascadas (nunca deja rojas)
  const solicitudes = await listarSolicitudesRTT(user.id);
  // La bitácora del correo trae RUC de todos los estudios: cada uno ve solo
  // las entradas de los RUC que él solicitó (el supremo ve todo).
  const rucsPropios = new Set(solicitudes.map((s) => s.ruc));
  const webhookLog = ((await getWebhookLogRTT()) ?? []).filter((e: any) => esSupremo(user) || (e.ruc && rucsPropios.has(e.ruc)));
  const { dominio } = await getRttConfig();
  return NextResponse.json({ solicitudes, webhookLog, dominio, dominioOk: !!dominio });
}

// POST → crea una solicitud de RTT y dispara el bot en SOL (pasos 1→3).
export async function POST(req: NextRequest) {
  const _bloqueo = await bloqueoModulo("rtt"); if (_bloqueo) return _bloqueo;
  const user = await requireUser();
  const body = await req.json().catch(() => ({}));
  await limpiarDiagnostico(body);
  // ruc = el tercero que se reporta (asunto del RTT). rucLogin = la cuenta SOL
  // que inicia sesión (por defecto, el mismo).
  const ruc = String(body.ruc ?? "").replace(/\D/g, "");
  const rucLogin = String(body.rucLogin ?? ruc).replace(/\D/g, "") || ruc;
  const solUser = typeof body.solUser === "string" ? body.solUser : "";
  const solPass = typeof body.solPass === "string" ? body.solPass : "";
  const razonSocial = typeof body.razonSocial === "string" ? body.razonSocial : undefined;

  if (!/^\d{11}$/.test(ruc)) return NextResponse.json({ error: "RUC a reportar inválido (11 dígitos)." }, { status: 400 });
  if (!/^\d{11}$/.test(rucLogin)) return NextResponse.json({ error: "RUC de acceso SOL inválido." }, { status: 400 });
  if (esRucDemo(ruc) || esRucDemo(rucLogin)) return NextResponse.json({ error: "Empresa de simulación: este módulo no consulta SUNAT con datos ficticios." }, { status: 400 });
  if (!solUser || !solPass) return NextResponse.json({ error: "Ingresa el Usuario SOL y la Clave SOL." }, { status: 400 });
  // El RTT se pide con una empresa PROPIA: el reporte llega por correo y se cruza por
  // RUC, así que pedirlo con el RUC de otro estudio podría recibir su reporte.
  if (!esSupremo(user)) {
    if (rucLogin !== ruc) return NextResponse.json({ error: "El RUC a reportar debe ser el de la empresa con la que inicias sesión en SOL." }, { status: 400 });
    if (!(await getClienteByRuc(ruc, studioId(user)))) return NextResponse.json({ error: "Esa empresa no está registrada en tu cuenta." }, { status: 404 });
  }

  const { dominio } = await getRttConfig();
  if (!dominio) {
    return NextResponse.json({ error: "Falta configurar el dominio del webhook (RTT_DOMINIO). Configúralo en el panel Supremo." }, { status: 400 });
  }

  // Correo destino CORTO (SUNAT trunca la dirección a ~40 caracteres): solo el
  // RUC como parte local, sin el prefijo "reportes+RUC" ni el sub-address "+".
  // El webhook extrae el RUC de la corrida de 11 dígitos (catch-all del dominio),
  // igual que el flujo de rentas. Ej.: 20606054590@dominio
  const emailDestino = `${ruc}@${dominio}`;

  // Modo diagnóstico: NO crea solicitud (no consume ni ensucia la trazabilidad),
  // solo recorre el formulario en SOL y devuelve el volcado crudo.
  if (body.diagnostico === true) {
    const r = await generarRTT({ ruc: rucLogin, solUser, solPass, emailDestino, diagnostico: true });
    await ocultarDiag(r);
    return NextResponse.json({ diag: r.diag });
  }

  // UNA casilla por empresa: crea o ACTUALIZA la del RUC (no acumula). Queda
  // "en_proceso"; conserva el reporte anterior por si la regeneración fallara.
  const sol = await upsertSolicitudRTT({ ruc, razonSocial, emailDestino, solicitadoPor: user.id });

  // Dispara el bot en SOL. La Clave SOL NO se persiste.
  const r = await generarRTT({ ruc: rucLogin, solUser, solPass, emailDestino, diagnostico: false });
  await ocultarDiag(r);

  if (!r.ok) {
    // Sin casilla roja: si había reporte previo se conserva "listo"; si no, se
    // borra la casilla. El error se comunica solo como aviso transitorio.
    await resolverFalloRTT(sol.id);
    // Se incluye `diag` (la traza, con el paso "enviar" y la respuesta de SUNAT)
    // para poder ver por qué no salió, sin tener que usar el modo diagnóstico.
    return NextResponse.json({ error: r.error ?? "No se pudo generar el reporte.", diag: r.diag }, { status: r.loginError ? 401 : 502 });
  }
  // OK → queda "en_proceso" esperando el correo de SUNAT (lo captura el webhook).
  // Se devuelve también `diag` para ver el paso "enviar" (respuesta de SUNAT).
  return NextResponse.json({ solicitud: sol, diag: r.diag });
}
