import { NextRequest, NextResponse } from "next/server";
import { setBuzon } from "@/lib/db";
import { getClienteAutorizado, getCurrentUser, esAdmin } from "@/lib/auth";
import { consultarBuzon } from "@/lib/buzon";

export const runtime = "nodejs";
export const maxDuration = 120;

const UN_DIA = 24 * 60 * 60 * 1000;

// Consulta el buzón electrónico SUNAT. La Clave SOL se usa solo para esta
// llamada y NO se persiste. Límite: 1 consulta al día por empresa.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const cliente = await getClienteAutorizado(params.id);
  if (!cliente) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  const body = await req.json().catch(() => ({}));

  // Límite de 1 consulta al día (solo el admin puede forzar).
  const ultima = cliente.buzon?.consultadoAt ? new Date(cliente.buzon.consultadoAt).getTime() : 0;
  if (ultima && Date.now() - ultima < UN_DIA && body.diagnostico !== true) {
    const usuario = await getCurrentUser();
    if (!(body.forzar === true && esAdmin(usuario))) {
      const horas = Math.ceil((UN_DIA - (Date.now() - ultima)) / (60 * 60 * 1000));
      return NextResponse.json({
        mensajes: cliente.buzon?.mensajes ?? [],
        peligrosos: cliente.buzon?.peligrosos ?? [],
        urgentes: cliente.buzon?.urgentes ?? [],
        limitado: true,
        mensaje: `El buzón ya se consultó hoy. Se permite 1 vez al día (para no saturar SUNAT). Vuelve en ~${horas} h.`,
      });
    }
  }

  try {
    const resultado = await consultarBuzon({
      ruc: cliente.ruc,
      solUser: typeof body.solUser === "string" ? body.solUser : "",
      solPass: typeof body.solPass === "string" ? body.solPass : "",
      clientId: typeof body.clientId === "string" ? body.clientId : undefined,
      clientSecret: typeof body.clientSecret === "string" ? body.clientSecret : undefined,
      dias: typeof body.dias === "number" ? body.dias : 15,
      diagnostico: body.diagnostico === true,
    });
    // Persistir los urgentes para el informe (no en modo diagnóstico).
    if (!resultado.diag) {
      await setBuzon(cliente.id, {
        peligrosos: resultado.peligrosos,
        urgentes: resultado.urgentes,
        mensajes: resultado.mensajes,
        totalMensajes: resultado.mensajes.length,
        consultadoAt: new Date().toISOString(),
      });
    }
    return NextResponse.json(resultado);
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Error consultando buzón" },
      { status: 400 }
    );
  }
}
