import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { extraerHonorarios } from "@/lib/honorarios";
import { getCuentasHonorarios } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 300;

// POST → extrae los Recibos por Honorarios (Consulta Receptor) del rango de meses.
export async function POST(req: NextRequest) {
  await requireUser();
  const body = await req.json().catch(() => ({}));
  const rucLogin = String(body.rucLogin ?? body.ruc ?? "").replace(/\D/g, "");
  const solUser = typeof body.solUser === "string" ? body.solUser : "";
  const solPass = typeof body.solPass === "string" ? body.solPass : "";
  const desde = typeof body.desde === "string" ? body.desde : undefined; // "YYYYMM"
  const hasta = typeof body.hasta === "string" ? body.hasta : undefined;
  const diagnostico = body.diagnostico === true;

  if (!/^\d{11}$/.test(rucLogin)) return NextResponse.json({ error: "RUC de acceso SOL inválido (11 dígitos)." }, { status: 400 });
  if (!solUser || !solPass) return NextResponse.json({ error: "Ingresa el Usuario SOL y la Clave SOL." }, { status: 400 });

  // Memoria del mes anterior (emisor+concepto → cuentas) para heredar cuentas.
  const mapaCuentas = await getCuentasHonorarios().catch(() => ({}));
  const r = await extraerHonorarios({ ruc: rucLogin, solUser, solPass, desde, hasta, diagnostico, mapaCuentas });
  if (!r.ok) return NextResponse.json({ error: r.error, diag: r.diag }, { status: r.loginError ? 401 : 502 });
  return NextResponse.json({
    total: r.total ?? (r.recibos ?? []).length,
    recibos: r.recibos ?? [],
    archivo: r.archivoBase64,
    nombre: r.nombreArchivo,
    diag: r.diag,
  });
}
