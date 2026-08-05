import { NextRequest, NextResponse } from "next/server";
import { getClienteAutorizado } from "@/lib/auth";
import { consultarDetalleSire } from "@/lib/sire";
import { setSireDetalleCache } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 120;

// Extrae el DETALLE SIRE (propuesta comprobante por comprobante) de un periodo.
// Usa las credenciales de la app SIRE guardadas del cliente (credSire) y recibe
// la Clave SOL solo para esta llamada (NO se persiste).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const cliente = await getClienteAutorizado(params.id);
  if (!cliente) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body.periodo !== "string") {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }

  const cred = cliente.credSire;
  const solUser = (typeof body.solUser === "string" && body.solUser) || cred?.solUser || "";
  const clientId = (typeof body.clientId === "string" && body.clientId) || cred?.clientId || "";
  const clientSecret = (typeof body.clientSecret === "string" && body.clientSecret) || cred?.clientSecret || "";

  const periodo = String(body.periodo);
  const incluirVentas = body.incluirVentas !== false;
  const incluirCompras = body.incluirCompras !== false;
  const tipo: "ventas" | "compras" = incluirVentas ? "ventas" : "compras";
  const refrescar = body.refrescar === true;

  // CACHÉ: si ya se extrajo este cliente+periodo+tipo y no se pide refrescar,
  // se devuelve lo guardado (sin reconsultar SUNAT → evita el 429).
  if (!body.diagnostico && !refrescar) {
    const cache = cliente.sireDetalle?.[`${tipo}-${periodo}`];
    if (cache) {
      const bloque = { columnas: cache.columnas, filas: cache.filas, comprobantes: cache.comprobantes };
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
    if (body.diagnostico) return NextResponse.json({ diag: r.diag });
    // Guarda en caché el bloque obtenido (para no reconsultar la próxima vez).
    const bloque = tipo === "ventas" ? r.ventas : r.compras;
    if (bloque) await setSireDetalleCache(cliente.id, tipo, periodo, bloque);
    return NextResponse.json({ periodo: r.periodo, ventas: r.ventas, compras: r.compras, diag: r.diag });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Error consultando el detalle SIRE" }, { status: 400 });
  }
}
