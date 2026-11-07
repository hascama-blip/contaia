import { limpiarDiagnostico } from "@/lib/acceso";
import { NextRequest, NextResponse } from "next/server";
import { getClienteAutorizado, getCurrentUser, esAdmin } from "@/lib/auth";
import { mergeBuzon } from "@/lib/db";
import { consultarBuzon } from "@/lib/buzon";
import { logAccion } from "@/lib/auditoria";
import { verificarCupo, consumirCupo, cupoAgotado } from "@/lib/cupos";

export const runtime = "nodejs";
export const maxDuration = 120;

// Pausa mínima entre consultas del buzón de una misma empresa (evita saturar
// SUNAT y el bloqueo por muchos ingresos). El cupo del plan (generaciones por
// empresa al mes) es el límite real; esta pausa solo frena los reintentos
// seguidos de una consulta que YA salió bien. El admin puede forzar.
const PAUSA = Math.max(0, Number(process.env.BUZON_PAUSA_MIN ?? "60") || 0) * 60 * 1000;

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
  await limpiarDiagnostico(body);
  const cliente = await getClienteAutorizado(String(body?.clienteId ?? ""));
  if (!cliente) return NextResponse.json({ error: "Empresa no encontrada." }, { status: 404 });

  // Pausa mínima entre consultas exitosas. Solo el admin puede forzar.
  const ultima = cliente.buzon?.consultadoAt ? new Date(cliente.buzon.consultadoAt).getTime() : 0;
  const dentroDelPlazo = ultima && Date.now() - ultima < PAUSA;
  if (dentroDelPlazo && !body.diagnostico) {
    const usuario = await getCurrentUser();
    const puedeForzar = body.forzar === true && esAdmin(usuario);
    if (!puedeForzar) {
      const min = Math.ceil((PAUSA - (Date.now() - ultima)) / 60000);
      return NextResponse.json({
        razonSocial: cliente.razonSocial,
        ruc: cliente.ruc,
        mensajes: mensajesGuardados(cliente),
        consultadoAt: cliente.buzon?.consultadoAt ?? null,
        limitado: true,
        mensaje: `El buzón se acaba de consultar (${new Date(cliente.buzon!.consultadoAt).toLocaleString("es-PE")}). Mostrando lo guardado. Podrás actualizar en ~${min} min.`,
      });
    }
  }

  const solUser =
    (typeof body.solUser === "string" && body.solUser) || cliente.credSire?.solUser || "";
  const solPass = typeof body.solPass === "string" ? body.solPass : "";
  if (!solUser || !solPass) {
    return NextResponse.json({ error: "Ingresa el Usuario y la Clave SOL." }, { status: 400 });
  }

  // Cupo del plan: generaciones de este paso por empresa al mes (salvo diagnóstico).
  const cupo = await verificarCupo(cliente.ruc, "buzon");
  if (!cupo.ok && !body.diagnostico) return NextResponse.json(cupoAgotado(cupo), { status: 429 });

  try {
    const r = await consultarBuzon({
      ruc: cliente.ruc,
      solUser,
      solPass,
      dias: typeof body.dias === "number" ? body.dias : 30,
      diagnostico: body.diagnostico === true,
    });
    // Clave/usuario SOL incorrectos: avisar y NO consumir uso (no persistir).
    if (r.loginError) {
      return NextResponse.json({ error: r.error ?? "Usuario o Clave SOL incorrectos." }, { status: 401 });
    }
    // Persistir (salvo en modo diagnóstico): el buzón es un HISTORIAL, cada
    // actualización AGREGA los mensajes nuevos a los ya guardados.
    let mensajes = r.mensajes;
    let nuevos: string[] = [];
    let estadoCupo: Awaited<ReturnType<typeof consumirCupo>> | null = null;
    if (!r.diag) {
      const fus = await mergeBuzon(cliente.id, r.mensajes).catch(() => null);
      if (fus) { mensajes = fus.mensajes; nuevos = fus.nuevos.map((m) => m.id); }
      await logAccion({
        area: "Buzón",
        accion: "Consultó el buzón electrónico",
        clienteId: cliente.id,
        clienteNombre: cliente.razonSocial,
        detalle: `${r.mensajes.length} mensaje(s) leído(s) · ${nuevos.length} nuevo(s) · ${mensajes.length} en historial`,
      });
      // Consumir 1 generación SOLO tras una extracción exitosa.
      if (cupo.ok) estadoCupo = await consumirCupo(cupo.ticket);
    }
    return NextResponse.json({
      razonSocial: cliente.razonSocial,
      ruc: cliente.ruc,
      mensajes,
      nuevos,
      leidos: r.mensajes.length,
      peligrosos: r.peligrosos,
      urgentes: r.urgentes,
      cacheados: Object.keys(cliente.buzonAdjuntos ?? {}),
      cupo: estadoCupo,
      diag: r.diag,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Error consultando buzón." }, { status: 400 });
  }
}
