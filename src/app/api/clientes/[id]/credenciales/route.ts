import { NextRequest, NextResponse } from "next/server";
import { getClienteAutorizado, getCurrentUser, esAdmin } from "@/lib/auth";
import { setCredSire } from "@/lib/db";

export const runtime = "nodejs";

// Guarda (y "bloquea") las credenciales del cliente: Usuario SOL + API
// (client_id/client_secret). La Clave SOL NUNCA se guarda aquí.
// Se usa para colocar el API "en campo" y habilitar la extracción del SIRE.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const cliente = await getClienteAutorizado(params.id);
  if (!cliente) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const solUser =
    (typeof body.solUser === "string" && body.solUser.trim()) ||
    cliente.credSire?.solUser ||
    "";
  // El API (client_id/secret) se PRESERVA si no viene en el body, para que
  // guardar solo el usuario (AccesosSol) no borre el API ya configurado.
  const traeApi = typeof body.clientId === "string" || typeof body.clientSecret === "string";
  const clientId = typeof body.clientId === "string" ? body.clientId.trim() : (cliente.credSire?.clientId ?? "");
  const clientSecret = typeof body.clientSecret === "string" ? body.clientSecret.trim() : (cliente.credSire?.clientSecret ?? "");

  if (!solUser) return NextResponse.json({ error: "Falta el Usuario SOL." }, { status: 400 });

  // Editar/borrar el API (client_id/secret) es solo del admin del estudio.
  const cambiaApi = traeApi && (clientId !== (cliente.credSire?.clientId ?? "") || clientSecret !== (cliente.credSire?.clientSecret ?? ""));
  if (cambiaApi) {
    const u = await getCurrentUser();
    if (!esAdmin(u)) {
      return NextResponse.json({ error: "Solo el administrador del estudio puede editar el API (client_id/secret)." }, { status: 403 });
    }
  }

  const actualizado = await setCredSire(cliente.id, {
    solUser,
    clientId,
    clientSecret,
    guardadoAt: new Date().toISOString(),
  });
  return NextResponse.json({ cliente: actualizado, credSire: actualizado?.credSire ?? null });
}
