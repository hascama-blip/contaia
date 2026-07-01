import { NextRequest, NextResponse } from "next/server";
import { getClienteAutorizado } from "@/lib/auth";
import { setDeudaGenerado } from "@/lib/db";
import { generarPedidoDeuda } from "@/lib/fraccionamiento";
import { logAccion } from "@/lib/auditoria";
import { chequearUso, registrarUso } from "@/lib/usos";

export const runtime = "nodejs";
export const maxDuration = 300;

// Fraccionamiento: 1 generación cada 3 días (ahorra memoria y evita bloqueos SUNAT).
const COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000;

// FASE 1: genera el pedido de deuda (Art. 36, Tesoro). Máx. 1 vez cada 3 días.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const cliente = await getClienteAutorizado(String(body?.clienteId ?? ""));
  if (!cliente) return NextResponse.json({ error: "Empresa no encontrada." }, { status: 404 });

  // Límite de 3 días para no provocar bloqueo por "spam" en SUNAT.
  const genAt = cliente.deudasF36?.generadoAt;
  if (!body.forzar && genAt) {
    const restante = COOLDOWN_MS - (Date.now() - new Date(genAt).getTime());
    if (restante > 0) {
      const dias = Math.ceil(restante / (24 * 60 * 60 * 1000));
      return NextResponse.json({
        ok: true,
        bloqueado: true,
        mensaje: `Ya generaste un pedido hace poco (${new Date(genAt).toLocaleString("es-PE")}). Podrás generar otro en ~${dias} día(s).`,
      });
    }
  }

  const solUser = (typeof body.solUser === "string" && body.solUser) || cliente.credSire?.solUser || "";
  const solPass = typeof body.solPass === "string" ? body.solPass : "";
  if (!solUser || !solPass) return NextResponse.json({ error: "Ingresa el Usuario y la Clave SOL." }, { status: 400 });

  // Cupo del módulo gratis.
  const uso = await chequearUso();
  if (!uso.ok && !body.diagnostico) {
    return NextResponse.json({ error: uso.mensaje, sinUsos: true, renuevaAt: uso.renuevaAt }, { status: 429 });
  }

  const r = await generarPedidoDeuda({ ruc: cliente.ruc, solUser, solPass, diagnostico: body.diagnostico === true });
  if (r.ok && !body.diagnostico) {
    await setDeudaGenerado(cliente.id, { numPedido: r.numPedido, fechaPedido: r.fechaPedido }).catch(() => {});
    if (uso.ok) await registrarUso(uso.adminId, uso.ilimitado);
    await logAccion({
      area: "Fraccionamiento F36",
      accion: "Generó un pedido de deuda",
      clienteId: cliente.id,
      clienteNombre: cliente.razonSocial,
      detalle: r.numPedido ? `N° ${r.numPedido}` : undefined,
    });
  }
  return NextResponse.json(r, { status: r.ok || body.diagnostico ? 200 : 400 });
}
