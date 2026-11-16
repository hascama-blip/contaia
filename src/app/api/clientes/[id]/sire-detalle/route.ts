import { ocultarCliente, ocultarCred, resolverSecreto } from "@/lib/secretos";
import { esClienteDemo, demoNoDisponible, demoSunat, demoSire, demoSireEstado, demoSireDetalle, demoSireNoIncluidos, demoBuzon, demoItf } from "@/lib/demoRutas";
import { bloqueoModulo, limpiarDiagnostico, ocultarDiag } from "@/lib/acceso";
import { NextRequest, NextResponse } from "next/server";
import { getClienteAutorizado } from "@/lib/auth";
import { consultarDetalleSire, consultarNoIncluidosSire } from "@/lib/sire";
import { setSireDetalleCache, setSireDetalleNoIncluidos } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 120;

// Extrae el DETALLE SIRE (propuesta comprobante por comprobante) de un periodo.
// Usa las credenciales de la app SIRE guardadas del cliente (credSire) y recibe
// la Clave SOL solo para esta llamada (NO se persiste).
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const _bloqueo = await bloqueoModulo("detalle-sire");if (_bloqueo) return _bloqueo;
  const cliente = await getClienteAutorizado(params.id);
  if (!cliente) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  const body = await req.json().catch(() => null);

  await limpiarDiagnostico(body);
  if (!body || typeof body.periodo !== "string") {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  // Empresas de simulación: los "no incluidos" también son ficticios.
  if (esClienteDemo(cliente) && body.soloNoIncluidos === true) {
    return demoSireNoIncluidos(cliente, String(body.periodo), body.incluirVentas !== false ? "ventas" : "compras");
  }
  if (esClienteDemo(cliente) && (body.refrescar === true || !cliente.sireDetalle?.[`${body.incluirVentas !== false ? "ventas" : "compras"}-${body.periodo}`])) {
    return demoSireDetalle(cliente, String(body.periodo), body.incluirVentas !== false ? "ventas" : "compras");
  }

  const cred = cliente.credSire;
  const solUser = (typeof body.solUser === "string" && body.solUser) || cred?.solUser || "";
  const clientId = (typeof body.clientId === "string" && body.clientId) || cred?.clientId || "";
  const clientSecret = resolverSecreto(body.clientSecret, cred?.clientSecret);

  const periodo = String(body.periodo);
  const incluirVentas = body.incluirVentas !== false;
  const incluirCompras = body.incluirCompras !== false;
  const tipo: "ventas" | "compras" = incluirVentas ? "ventas" : "compras";
  const refrescar = body.refrescar === true;

  // ---- 2.ª consulta: NO INCLUIDOS de la propuesta (ventas: rechazados y otros que SUNAT
  // dejó fuera; compras: excluidos). Se guardan junto al detalle y van en otra hoja del
  // mismo Excel. Nunca se mezclan con el detalle (no cuentan en conciliaciones). ----
  if (body.soloNoIncluidos === true) {
    const guardado = cliente.sireDetalle?.[`${tipo}-${periodo}`]?.noIncluidos;
    if (guardado && !body.diagnostico && !refrescar) return NextResponse.json({ periodo, noIncluidos: guardado, desdeCache: true });
    try {
      const r = await consultarNoIncluidosSire({
        ruc: cliente.ruc, periodo, solUser,
        solPass: typeof body.solPass === "string" ? body.solPass : "",
        clientId, clientSecret, tipo,
        diagnostico: body.diagnostico === true,
      });
      await ocultarDiag(r);
      if (body.diagnostico) return NextResponse.json({ diag: r.diag });
      if (r.pendiente) return NextResponse.json({ periodo, pendiente: true });
      if (!r.bloque) {
        // SUNAT no entregó la lista: no se guarda (se podrá volver a intentar).
        return NextResponse.json({ periodo, noDisponible: true, noIncluidos: { columnas: [], filas: [], comprobantes: 0, nota: r.noDisponible ?? "SUNAT no entregó esta lista." } });
      }
      await setSireDetalleNoIncluidos(cliente.id, tipo, periodo, r.bloque);
      return NextResponse.json({ periodo, noIncluidos: { ...r.bloque, at: new Date().toISOString() } });
    } catch (err: any) {
      return NextResponse.json({ error: err?.message ?? "Error consultando los no incluidos del SIRE" }, { status: 400 });
    }
  }

  // CACHÉ: si ya se extrajo este cliente+periodo+tipo y no se pide refrescar,
  // se devuelve lo guardado (sin reconsultar SUNAT → evita el 429).
  if (!body.diagnostico && !refrescar) {
    const cache = cliente.sireDetalle?.[`${tipo}-${periodo}`];
    if (cache) {
      const bloque = { columnas: cache.columnas, filas: cache.filas, comprobantes: cache.comprobantes, noIncluidos: cache.noIncluidos };
      return NextResponse.json({
        periodo,
        ventas: tipo === "ventas" ? bloque : undefined,
        compras: tipo === "compras" ? bloque : undefined,
        desdeCache: true,
        cacheAt: cache.at,
      });
    }
  }

  try {
    const r = await consultarDetalleSire({
      ruc: cliente.ruc,
      periodo,
      solUser,
      solPass: typeof body.solPass === "string" ? body.solPass : "",
      clientId,
      clientSecret,
      incluirVentas,
      incluirCompras,
      diagnostico: body.diagnostico === true,
    });
    await ocultarDiag(r);
    if (body.diagnostico) return NextResponse.json({ diag: r.diag });
    // SUNAT aún genera el reporte: no es error ni se cachea; el front reintenta.
    if (r.pendiente) {
      return NextResponse.json({ periodo: r.periodo, pendiente: true });
    }
    // Guarda en caché el bloque obtenido (para no reconsultar la próxima vez).
    const bloque = tipo === "ventas" ? r.ventas : r.compras;
    if (bloque) await setSireDetalleCache(cliente.id, tipo, periodo, bloque);
    // En modo normal NO se devuelve la traza (diag): solo los datos.
    return NextResponse.json({ periodo: r.periodo, ventas: r.ventas, compras: r.compras });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Error consultando el detalle SIRE" }, { status: 400 });
  }
}
