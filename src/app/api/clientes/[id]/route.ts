import { ocultarCliente, ocultarCred, resolverSecreto } from "@/lib/secretos";
import { NextRequest, NextResponse } from "next/server";
import { deleteCliente, updateCliente, liberarRucGlobal, registrarRucGlobal, getClienteByRuc, duenoDeRuc } from "@/lib/db";
import { getClienteAutorizado, getCurrentUser, esAdmin, esSupremo, studioId } from "@/lib/auth";
import { logAccion } from "@/lib/auditoria";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const cliente = await getClienteAutorizado(params.id);
  if (!cliente) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  return NextResponse.json({ cliente: ocultarCliente(cliente) });
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  // Verifica que la empresa sea del usuario antes de modificarla.
  const propio = await getClienteAutorizado(params.id);
  if (!propio) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const user = (await getCurrentUser())!;
  const cambios: Record<string, string> = {};
  for (const k of ["razonSocial", "email", "telefono", "negocio"] as const) if (typeof body?.[k] === "string") cambios[k] = body[k];
  if (cambios.razonSocial !== undefined && !cambios.razonSocial.trim()) {
    return NextResponse.json({ error: "La razón social no puede quedar vacía." }, { status: 400 });
  }

  // Corrección de RUC (empresa registrada por error): mismas reglas que el alta.
  const nuevoRuc = typeof body?.ruc === "string" ? body.ruc.replace(/\D/g, "") : "";
  const cambiaRuc = Boolean(nuevoRuc) && nuevoRuc !== propio.ruc;
  if (cambiaRuc) {
    if (!esAdmin(user)) return NextResponse.json({ error: "Solo el administrador puede cambiar el RUC." }, { status: 403 });
    if (!/^\d{11}$/.test(nuevoRuc)) return NextResponse.json({ error: "El RUC debe tener 11 dígitos." }, { status: 400 });
    const repetido = await getClienteByRuc(nuevoRuc, studioId(user));
    if (repetido && repetido.id !== propio.id) {
      return NextResponse.json({ error: `Ya tienes registrada la empresa con RUC ${nuevoRuc} (${repetido.razonSocial}).` }, { status: 409 });
    }
    const dueno = await duenoDeRuc(nuevoRuc);
    if (dueno && dueno.studioId !== studioId(user) && !esSupremo(user)) {
      return NextResponse.json({ error: `El RUC ${nuevoRuc} ya está registrado en la plataforma por otro usuario.` }, { status: 409 });
    }
    cambios.ruc = nuevoRuc;
  }

  const cliente = await updateCliente(params.id, cambios);
  if (!cliente) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  if (cambiaRuc) {
    await liberarRucGlobal(propio.ruc, propio.id).catch(() => {});
    if (!esSupremo(user)) await registrarRucGlobal(nuevoRuc, studioId(user), propio.id, user.nombre).catch(() => {});
  }
  if (cambiaRuc || (cambios.razonSocial && cambios.razonSocial.trim() !== propio.razonSocial)) {
    await logAccion({
      area: "Cliente",
      accion: "Editó una empresa",
      clienteId: propio.id,
      clienteNombre: cliente.razonSocial,
      detalle: [cambiaRuc ? `RUC ${propio.ruc} → ${nuevoRuc}` : "", cambios.razonSocial && cambios.razonSocial.trim() !== propio.razonSocial ? `Razón social "${propio.razonSocial}" → "${cliente.razonSocial}"` : ""].filter(Boolean).join(" · "),
    });
  }
  return NextResponse.json({ cliente: ocultarCliente(cliente) });
}

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const propio = await getClienteAutorizado(params.id);
  if (!propio) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  // Eliminar empresa es solo del admin del estudio (los operadores no pueden).
  if (!esAdmin(await getCurrentUser())) {
    return NextResponse.json({ error: "Solo el administrador del estudio puede eliminar empresas." }, { status: 403 });
  }
  const ok = await deleteCliente(params.id);
  if (!ok) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  await liberarRucGlobal(propio.ruc, propio.id).catch(() => {}); // el RUC vuelve a estar libre (si era el dueño)
  await logAccion({
    area: "Cliente",
    accion: "Eliminó una empresa",
    clienteId: propio.id,
    clienteNombre: propio.razonSocial,
    detalle: `RUC ${propio.ruc}`,
  });
  return NextResponse.json({ ok: true });
}
