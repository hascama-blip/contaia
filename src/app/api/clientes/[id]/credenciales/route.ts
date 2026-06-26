import { NextRequest, NextResponse } from "next/server";
import { getClienteAutorizado } from "@/lib/auth";
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
  const clientId = typeof body.clientId === "string" ? body.clientId.trim() : "";
  const clientSecret = typeof body.clientSecret === "string" ? body.clientSecret.trim() : "";

  if (!solUser) return NextResponse.json({ error: "Falta el Usuario SOL." }, { status: 400 });

  const actualizado = await setCredSire(cliente.id, {
    solUser,
    clientId,
    clientSecret,
    guardadoAt: new Date().toISOString(),
  });
  return NextResponse.json({ cliente: actualizado, credSire: actualizado?.credSire ?? null });
}
