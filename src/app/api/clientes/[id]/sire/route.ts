import { ocultarCliente, ocultarCred, resolverSecreto } from "@/lib/secretos";
import { esClienteDemo, demoNoDisponible, demoSunat, demoSire, demoSireEstado, demoSireDetalle, demoBuzon, demoItf } from "@/lib/demoRutas";
import { limpiarDiagnostico } from "@/lib/acceso";
import { NextRequest, NextResponse } from "next/server";
import { clearSire, setSireResumen, setCredSire } from "@/lib/db";
import { getClienteAutorizado } from "@/lib/auth";
import { consultarResumenSire } from "@/lib/sire";
import { verificarCupo, consumirCupo, cupoAgotado } from "@/lib/cupos";

export const runtime = "nodejs";
export const maxDuration = 120;

// Limpia (borra) todos los resúmenes SIRE guardados del cliente, para volver a
// descargar otro rango/periodo desde cero.
export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const cliente = await getClienteAutorizado(params.id);
  if (!cliente) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  const actualizado = await clearSire(cliente.id);
  return NextResponse.json({ cliente: ocultarCliente(actualizado) });
}

// Consulta el resumen SIRE (compras/ventas) de un periodo.
// Recibe la Clave SOL del cliente SOLO para esta llamada; NO se persiste.
// Se guardan únicamente los totales resultantes.
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const cliente = await getClienteAutorizado(params.id);
  if (!cliente) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  const body = await req.json().catch(() => null);

  await limpiarDiagnostico(body);
  if (!body || typeof body.periodo !== "string") {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  if (esClienteDemo(cliente)) return demoSire(cliente, body.periodo);

  // Cupo del plan. Una corrida de VARIOS periodos ("Extraer todo" o un rango)
  // manda el mismo `lote` en cada llamada → cuenta como UNA sola generación.
  // El modo simulado (datos de ejemplo) y el diagnóstico no consumen cupo.
  const esDiag = body.diagnostico === true || body.real !== true;
  const lote = typeof body.lote === "string" && body.lote ? body.lote : undefined;
  const cupo = await verificarCupo(cliente.ruc, "sire", lote);
  if (!cupo.ok && !esDiag) return NextResponse.json(cupoAgotado(cupo), { status: 429 });

  // El navegador recibe el client_secret oculto: si lo devuelve así, se usa el guardado.
  if (typeof body.clientSecret === "string") body.clientSecret = resolverSecreto(body.clientSecret, cliente.credSire?.clientSecret);
  try {
    const resultado = await consultarResumenSire({
      ruc: cliente.ruc,
      periodo: body.periodo,
      solUser: typeof body.solUser === "string" ? body.solUser : "",
      solPass: typeof body.solPass === "string" ? body.solPass : "",
      clientId: typeof body.clientId === "string" ? body.clientId : undefined,
      clientSecret:
        typeof body.clientSecret === "string" ? body.clientSecret : undefined,
      real: body.real === true,
      diagnostico: body.diagnostico === true,
    });
    // Guarda las credenciales de la API (sin la Clave SOL) para reutilizarlas.
    if (
      body.real === true &&
      typeof body.clientId === "string" && body.clientId.trim() &&
      typeof body.clientSecret === "string" && body.clientSecret.trim()
    ) {
      await setCredSire(cliente.id, {
        solUser: typeof body.solUser === "string" ? body.solUser.trim() : "",
        clientId: body.clientId.trim(),
        clientSecret: body.clientSecret.trim(),
        guardadoAt: new Date().toISOString(),
      });
    }
    // Modo diagnóstico: devuelve la traza cruda, sin persistir.
    if (!resultado.resumen) {
      return NextResponse.json({ diag: resultado.diag });
    }
    const actualizado = await setSireResumen(cliente.id, resultado.resumen);
    if (cupo.ok && !esDiag) await consumirCupo(cupo.ticket);
    return NextResponse.json({
      resumen: resultado.resumen,
      cliente: ocultarCliente(actualizado),
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Error consultando SIRE" },
      { status: 400 }
    );
  }
}
