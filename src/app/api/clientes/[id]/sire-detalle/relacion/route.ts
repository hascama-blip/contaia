import { NextRequest, NextResponse } from "next/server";
import { getClienteAutorizado } from "@/lib/auth";
import { relacionDesdeSireCompras } from "@/lib/relacionComprobantes";

export const runtime = "nodejs";

// GET ?periodo=AAAAMM&tipo=compras → relación de comprobantes (para descargar
// XML) armada desde el DETALLE SIRE guardado (caché) de ese cliente/periodo.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const cliente = await getClienteAutorizado(params.id);
  if (!cliente) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  const { searchParams } = new URL(req.url);
  const periodo = String(searchParams.get("periodo") ?? "");
  const tipo = (searchParams.get("tipo") ?? "compras") === "ventas" ? "ventas" : "compras";
  if (!/^\d{6}$/.test(periodo)) {
    return NextResponse.json({ error: "Periodo inválido (AAAAMM)." }, { status: 400 });
  }

  const cache = cliente.sireDetalle?.[`${tipo}-${periodo}`];
  if (!cache) {
    return NextResponse.json(
      { error: `No hay detalle SIRE de ${tipo} guardado para ${periodo}. Extráelo primero en “Detalle SIRE”.` },
      { status: 404 }
    );
  }

  const items = relacionDesdeSireCompras(cache.columnas, cache.filas);
  return NextResponse.json({ periodo, tipo, items, total: items.length });
}
