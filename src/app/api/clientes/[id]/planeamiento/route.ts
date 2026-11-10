import { NextRequest, NextResponse } from "next/server";
import { setPlaneamiento } from "@/lib/db";
import { getClienteAutorizado } from "@/lib/auth";
import type { PlaneamientoEntradas } from "@/lib/types";

export const runtime = "nodejs";

const REGIMENES = ["general", "mype", "especial", "rus", "ninguno"] as const;
const num = (v: unknown) => {
  const n = Number(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? Math.max(0, Math.round(n * 100) / 100) : 0;
};

// Planeamiento tributario: guarda los datos MANUALES de un periodo (saldo a favor
// del mes anterior, percepciones, retenciones, régimen, coeficiente). El cálculo
// se hace en el navegador con lib/planeamiento.ts sobre el SIRE ya extraído.
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const cliente = await getClienteAutorizado(id);
  if (!cliente) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  return NextResponse.json({ planeamiento: cliente.planeamiento ?? {} });
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const cliente = await getClienteAutorizado(id);
  if (!cliente) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const periodo = String(body?.periodo ?? "");
  if (!/^\d{4}(0[1-9]|1[0-2])$/.test(periodo)) return NextResponse.json({ error: "Periodo inválido (AAAAMM)." }, { status: 400 });
  const regimen = REGIMENES.includes(body?.regimen) ? body.regimen : "general";
  const coef = body?.coeficiente === null || body?.coeficiente === "" || body?.coeficiente === undefined ? null : num(body.coeficiente);
  const entradas: PlaneamientoEntradas = {
    regimen,
    coeficiente: coef && coef > 0 && coef < 100 ? coef : null,
    saldoFavorIgv: num(body?.saldoFavorIgv),
    percepciones: num(body?.percepciones),
    retenciones: num(body?.retenciones),
    saldoFavorRenta: num(body?.saldoFavorRenta),
    at: new Date().toISOString(),
  };
  const act = await setPlaneamiento(cliente.id, periodo, entradas);
  return NextResponse.json({ ok: true, planeamiento: act?.planeamiento ?? {} });
}
