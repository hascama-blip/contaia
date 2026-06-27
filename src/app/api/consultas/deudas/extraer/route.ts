import { NextRequest, NextResponse } from "next/server";
import { getClienteAutorizado } from "@/lib/auth";
import { extraerDeudasF36 } from "@/lib/fraccionamiento";
import { setDeudasF36 } from "@/lib/db";
import { logAccion } from "@/lib/auditoria";

export const runtime = "nodejs";
export const maxDuration = 300;

// Periodo de prueba: límite desactivado (0). Para reactivarlo, usar 3*24*60*60*1000.
const COOLDOWN_MS = 0;

function diasRestantes(at: string) {
  return Math.ceil((COOLDOWN_MS - (Date.now() - new Date(at).getTime())) / (24 * 60 * 60 * 1000));
}

// FASE 2: extrae las deudas (4 pestañas). Cache de 3 días: dentro de ese plazo
// muestra lo guardado sin tocar SUNAT. Después, la nueva extracción reemplaza.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const cliente = await getClienteAutorizado(String(body?.clienteId ?? ""));
  if (!cliente) return NextResponse.json({ error: "Empresa no encontrada." }, { status: 404 });

  const guardado = cliente.deudasF36;
  if (!body.forzar && !body.diagnostico && guardado?.at && Date.now() - new Date(guardado.at).getTime() < COOLDOWN_MS) {
    return NextResponse.json({
      ok: true,
      desdeCache: true,
      tablas: guardado.tablas,
      at: guardado.at,
      nota: guardado.nota ?? null,
      mensaje: `Mostrando lo guardado (${new Date(guardado.at).toLocaleString("es-PE")}). Para no saturar SUNAT, podrás actualizar en ~${diasRestantes(guardado.at)} día(s).`,
    });
  }

  const solUser = (typeof body.solUser === "string" && body.solUser) || cliente.credSire?.solUser || "";
  const solPass = typeof body.solPass === "string" ? body.solPass : "";
  if (!solUser || !solPass) return NextResponse.json({ error: "Ingresa el Usuario y la Clave SOL." }, { status: 400 });

  const r = await extraerDeudasF36({ ruc: cliente.ruc, solUser, solPass, diagnostico: body.diagnostico === true });
  if (r.ok && r.tablas && !body.diagnostico) {
    await setDeudasF36(cliente.id, r.tablas, r.nota).catch(() => {}); // reemplaza lo anterior
    const total = r.tablas.reduce((a, t) => a + (t.filas?.length ?? 0), 0);
    await logAccion({
      area: "Fraccionamiento F36",
      accion: "Extrajo las deudas (pestañas)",
      clienteId: cliente.id,
      clienteNombre: cliente.razonSocial,
      detalle: `${total} deuda(s)`,
    });
  }
  return NextResponse.json(r, { status: r.ok || body.diagnostico ? 200 : 400 });
}

// GET: deudas guardadas (sin clave) + si ya se puede actualizar (pasaron 3 días).
export async function GET(req: NextRequest) {
  const cliente = await getClienteAutorizado(req.nextUrl.searchParams.get("clienteId") ?? "");
  if (!cliente) return NextResponse.json({ error: "Empresa no encontrada." }, { status: 404 });
  const g = cliente.deudasF36;
  const puedeActualizar = !g?.at || Date.now() - new Date(g.at).getTime() >= COOLDOWN_MS;
  return NextResponse.json({
    tablas: g?.tablas ?? [],
    at: g?.at ?? null,
    nota: g?.nota ?? null,
    puedeActualizar,
    diasParaActualizar: g?.at && !puedeActualizar ? diasRestantes(g.at) : 0,
  });
}
