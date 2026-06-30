import { NextRequest, NextResponse } from "next/server";
import { requireUser, esAdmin, studioId } from "@/lib/auth";
import { listClientes, setSunatInfo, updateCliente } from "@/lib/db";
import { consultarSunat } from "@/lib/sunat";
import { logAccion } from "@/lib/auditoria";

export const runtime = "nodejs";
export const maxDuration = 120;

const CAP = 80;        // máximo por llamada (el frontend repite si quedan más).
const CONCURRENCIA = 4; // consultas a SUNAT en paralelo.

// Verifica en SUNAT los clientes "por verificar" (sin datos SUNAT) del estudio:
// rellena estado/condición/razón social. Procesa hasta CAP y devuelve cuántos
// quedan, para que el frontend repita hasta terminar.
export async function POST(_req: NextRequest) {
  const user = await requireUser();
  if (!esAdmin(user)) {
    return NextResponse.json({ error: "Solo el administrador puede verificar." }, { status: 403 });
  }

  const todos = await listClientes(studioId(user));
  const pendientes = todos.filter((c) => !c.sunat);
  const total = pendientes.length;
  const lote = pendientes.slice(0, CAP);

  let verificados = 0;
  let errores = 0;
  let idx = 0;

  async function worker() {
    while (idx < lote.length) {
      const c = lote[idx++];
      try {
        const info = await consultarSunat(c.ruc);
        await setSunatInfo(c.id, info);
        if (info.razonSocial && /por verificar/i.test(c.razonSocial)) {
          await updateCliente(c.id, { razonSocial: info.razonSocial });
        }
        verificados++;
      } catch {
        errores++;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCIA, lote.length) }, () => worker()));

  if (verificados > 0) {
    await logAccion({
      area: "Cliente",
      accion: "Verificó empresas en SUNAT (tras carga masiva)",
      detalle: `${verificados} verificada(s)`,
    });
  }

  return NextResponse.json({
    total,
    verificados,
    errores,
    restantes: Math.max(0, total - lote.length),
  });
}

// GET: cuántos clientes quedan por verificar (para el contador del botón).
export async function GET() {
  const user = await requireUser();
  if (!esAdmin(user)) return NextResponse.json({ pendientes: 0 });
  const todos = await listClientes(studioId(user));
  return NextResponse.json({ pendientes: todos.filter((c) => !c.sunat).length });
}
