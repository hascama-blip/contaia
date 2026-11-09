import { NextRequest, NextResponse } from "next/server";
import { esClienteDemo, demoNoDisponible, demoSunat, demoSire, demoSireEstado, demoSireDetalle, demoBuzon, demoItf } from "@/lib/demoRutas";
import { getClienteAutorizado, getCurrentUser, planDelEstudio } from "@/lib/auth";
import { planIncluye } from "@/lib/modulos";
import { cifrar } from "@/lib/cifrado";
import { setVigilancia } from "@/lib/db";
import { logAccion } from "@/lib/auditoria";

export const runtime = "nodejs";

const DIAS_VIGENCIA = 30;

function estadoDe(c: NonNullable<Awaited<ReturnType<typeof getClienteAutorizado>>>) {
  const v = c.vigilancia;
  if (!v?.activo) return { activo: false };
  return {
    activo: true, solUser: v.solUser, guardadaAt: v.guardadaAt, venceAt: v.venceAt,
    ultimoChequeo: v.ultimoChequeo ?? null, ultimoError: v.ultimoError ?? null, ultimaAlerta: v.ultimaAlerta ?? null,
    vistos: (v.vistos ?? []).length,
  };
}

// GET → estado de la vigilancia (nunca devuelve la clave).
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const c = await getClienteAutorizado(params.id);
  if (!c) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  const user = await getCurrentUser();
  { const d = demoNoDisponible(c); if (d) return d; }
  const plan = user ? await planDelEstudio(user) : "basico";
  return NextResponse.json({ ...estadoDe(c), permitido: planIncluye(plan, "premium"), plan });
}

// POST { solUser, solPass, acepto:true } → activa: guarda la Clave SOL CIFRADA
// con vigencia de 30 días. Solo Premium / Equipo y con consentimiento explícito.
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const c = await getClienteAutorizado(params.id);
  if (!c) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sesión requerida." }, { status: 401 });
  const plan = await planDelEstudio(user);
  if (!planIncluye(plan, "premium")) {
    return NextResponse.json({ error: "La vigilancia automática del buzón está disponible en los planes Premium y de Equipo." }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const solUser = String(body?.solUser ?? "").trim();
  const solPass = String(body?.solPass ?? "");
  if (body?.acepto !== true) return NextResponse.json({ error: "Debes aceptar el guardado cifrado de la Clave SOL." }, { status: 400 });
  if (!solUser || !solPass) return NextResponse.json({ error: "Ingresa el Usuario SOL y la Clave SOL." }, { status: 400 });

  const ahora = new Date();
  const vence = new Date(ahora.getTime() + DIAS_VIGENCIA * 86400000);
  // Mensajes ya conocidos: no se vuelven a avisar.
  const vistos = Array.from(new Set([...(c.vigilancia?.vistos ?? []), ...((c.buzon?.mensajes ?? []).map((m) => m.id).filter(Boolean))]));
  const upd = await setVigilancia(c.id, {
    activo: true, solUser, claveEnc: cifrar(solPass), guardadaAt: ahora.toISOString(), venceAt: vence.toISOString(),
    aceptadoPor: user.id, vistos, erroresSeguidos: 0,
  });
  await logAccion({ area: "vigilancia", accion: "Activó la vigilancia del buzón (Clave SOL cifrada, 30 días)", clienteId: c.id, clienteNombre: c.razonSocial }).catch(() => {});
  return NextResponse.json({ ok: true, ...estadoDe(upd!), permitido: true, plan });
}

// DELETE → desactiva y BORRA la clave guardada.
export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const c = await getClienteAutorizado(params.id);
  if (!c) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  await setVigilancia(c.id, null);
  await logAccion({ area: "vigilancia", accion: "Desactivó la vigilancia del buzón y borró la clave", clienteId: c.id, clienteNombre: c.razonSocial }).catch(() => {});
  return NextResponse.json({ ok: true, activo: false });
}
