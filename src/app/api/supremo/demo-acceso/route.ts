import { NextRequest, NextResponse } from "next/server";
import { bloqueoSupremo } from "@/lib/acceso";
import { setPermisoDemo, listPermisosDemo } from "@/lib/db";
import { logAccion } from "@/lib/auditoria";

export const runtime = "nodejs";

// Solo supremo: habilita / quita el MODO SIMULACIÓN a otra cuenta por su correo.
// Habilitar también le asigna el plan Empresas (todos los módulos, sin utilitarios).
export async function GET() {
  const b = await bloqueoSupremo(); if (b) return b;
  return NextResponse.json({ cuentas: await listPermisosDemo() });
}

export async function POST(req: NextRequest) {
  const b = await bloqueoSupremo(); if (b) return b;
  const body = await req.json().catch(() => ({}));
  const email = String(body?.email ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return NextResponse.json({ error: "Correo inválido." }, { status: 400 });
  const activar = body?.activar !== false;
  const u = await setPermisoDemo(email, activar);
  if (!u) return NextResponse.json({ error: "No existe una cuenta con ese correo. Pídele que se registre primero en la web y vuelve a intentarlo." }, { status: 404 });
  await logAccion({ area: "Supremo", accion: activar ? "Habilitó el modo simulación" : "Quitó el modo simulación", detalle: `${u.nombre} <${u.email}>${activar ? " · plan Empresas" : ""}` }).catch(() => {});
  return NextResponse.json({ ok: true, cuenta: { id: u.id, nombre: u.nombre, email: u.email, plan: u.plan, permisoDemo: Boolean(u.permisoDemo) }, cuentas: await listPermisosDemo() });
}
