import { NextRequest, NextResponse } from "next/server";
import { getClienteAutorizado, getCurrentUser, esAdmin } from "@/lib/auth";
import { setBuzon } from "@/lib/db";
import { consultarBuzon } from "@/lib/buzon";
import { logAccion } from "@/lib/auditoria";
import { chequearUso, registrarUso } from "@/lib/usos";

export const runtime = "nodejs";
export const maxDuration = 120;

// Cooldown del buzón: 1 vez por SEMANA (ahorra memoria/CPU y evita saturar
// SUNAT). El admin puede forzar. Los datos guardados se muestran mientras tanto.
const UNA_SEMANA = 7 * 24 * 60 * 60 * 1000;

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

  // Límite de 1 consulta por semana. Solo el admin puede forzar.
  const ultima = cliente.buzon?.consultadoAt ? new Date(cliente.buzon.consultadoAt).getTime() : 0;
  const dentroDelPlazo = ultima && Date.now() - ultima < UNA_SEMANA;
  if (dentroDelPlazo && !body.diagnostico) {
    const usuario = await getCurrentUser();
    const puedeForzar = body.forzar === true && esAdmin(usuario);
    if (!puedeForzar) {
      const dias = Math.ceil((UNA_SEMANA - (Date.now() - ultima)) / (24 * 60 * 60 * 1000));
      return NextResponse.json({
        razonSocial: cliente.razonSocial,
        ruc: cliente.ruc,
        mensajes: mensajesGuardados(cliente),
        consultadoAt: cliente.buzon?.consultadoAt ?? null,
        limitado: true,
        mensaje: `El buzón se actualiza 1 vez por semana (última: ${new Date(cliente.buzon!.consultadoAt).toLocaleString("es-PE")}). Mostrando lo guardado. Podrás actualizar en ~${dias} día(s).`,
      });
    }
  }

  const solUser =
    (typeof body.solUser === "string" && body.solUser) || cliente.credSire?.solUser || "";
  const solPass = typeof body.solPass === "string" ? body.solPass : "";
  if (!solUser || !solPass) {
    return NextResponse.json({ error: "Ingresa el Usuario y la Clave SOL." }, { status: 400 });
  }

  // Cupo del módulo gratis: 3 consultas cada 7 días (salvo diagnóstico).
  const uso = await chequearUso();
  if (!uso.ok && !body.diagnostico) {
    return NextResponse.json({ error: uso.mensaje, sinUsos: true, renuevaAt: uso.renuevaAt }, { status: 429 });
  }

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
    // Persistir (salvo en modo diagnóstico) para que sobreviva al refresco.
    if (!r.diag) {
      await setBuzon(cliente.id, {
        peligrosos: r.peligrosos,
        urgentes: r.urgentes,
        mensajes: r.mensajes,
        totalMensajes: r.mensajes.length,
        consultadoAt: new Date().toISOString(),
      }).catch(() => {});
      await logAccion({
        area: "Buzón",
        accion: "Consultó el buzón electrónico",
        clienteId: cliente.id,
        clienteNombre: cliente.razonSocial,
        detalle: `${r.mensajes.length} mensaje(s)`,
      });
      // Consumir 1 uso del cupo gratis SOLO tras una extracción exitosa.
      if (uso.ok) await registrarUso(uso.adminId, uso.ilimitado);
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
