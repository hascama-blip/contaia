import { NextRequest, NextResponse } from "next/server";
import { getClienteAutorizado, requireUser } from "@/lib/auth";
import { estadoCuposEmpresa, comprobantesDisponibles } from "@/lib/cupos";

export const runtime = "nodejs";

// GET ?clienteId= → cupos del mes de esa empresa (generaciones por paso) y los
// comprobantes de la Descarga masiva del estudio. Sin clienteId: solo comprobantes.
export async function GET(req: NextRequest) {
  await requireUser();
  const clienteId = req.nextUrl.searchParams.get("clienteId") ?? "";
  const comp = await comprobantesDisponibles();
  const comprobantes = comp ? { usados: comp.usados, tope: comp.tope } : null;
  if (!clienteId) return NextResponse.json({ comprobantes });
  const cliente = await getClienteAutorizado(clienteId);
  if (!cliente) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  const est = await estadoCuposEmpresa(cliente.ruc);
  return NextResponse.json({ ...est, comprobantes });
}
