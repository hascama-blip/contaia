import { resolverSecreto } from "@/lib/secretos";
import { limpiarDiagnostico } from "@/lib/acceso";
import { NextRequest, NextResponse } from "next/server";
import { mergeBuzon } from "@/lib/db";
import { getClienteAutorizado, getCurrentUser, esAdmin } from "@/lib/auth";
import { consultarBuzon } from "@/lib/buzon";
import { verificarCupo, consumirCupo, cupoAgotado } from "@/lib/cupos";

export const runtime = "nodejs";
export const maxDuration = 120;

const UN_DIA = 24 * 60 * 60 * 1000;

// Consulta el buzón electrónico SUNAT. La Clave SOL se usa solo para esta
// llamada y NO se persiste. Límite: 1 consulta al día por empresa.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const cliente = await getClienteAutorizado(params.id);
  if (!cliente) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  const body = await req.json().catch(() => ({}));

  await limpiarDiagnostico(body);

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

  const cupo = await verificarCupo(cliente.ruc, "buzon");
  if (!cupo.ok && body.diagnostico !== true) return NextResponse.json(cupoAgotado(cupo), { status: 429 });

  try {
    const resultado = await consultarBuzon({
      ruc: cliente.ruc,
      solUser: typeof body.solUser === "string" ? body.solUser : "",
      solPass: typeof body.solPass === "string" ? body.solPass : "",
      clientId: typeof body.clientId === "string" ? body.clientId : undefined,
      clientSecret: typeof body.clientSecret === "string" ? resolverSecreto(body.clientSecret, cliente.credSire?.clientSecret) : undefined,
      dias: typeof body.dias === "number" ? body.dias : 15,
      diagnostico: body.diagnostico === true,
    });
    // Persistir (no en modo diagnóstico): el buzón es un HISTORIAL acumulado;
    // cada consulta agrega los mensajes nuevos a los ya guardados.
    if (!resultado.diag && !resultado.loginError) {
      if (cupo.ok) await consumirCupo(cupo.ticket);
      const fus = await mergeBuzon(cliente.id, resultado.mensajes).catch(() => null);
      if (fus) {
        return NextResponse.json({
          ...resultado,
          mensajes: fus.mensajes,
          peligrosos: fus.mensajes.filter((m) => m.nivel === "peligroso"),
          urgentes: fus.mensajes.filter((m) => m.nivel === "urgente"),
          nuevos: fus.nuevos.map((m) => m.id),
        });
      }
    }
    return NextResponse.json(resultado);
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Error consultando buzón" },
      { status: 400 }
    );
  }
}
